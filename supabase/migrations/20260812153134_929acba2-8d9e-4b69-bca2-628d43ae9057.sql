-- 1. Deletion markers ------------------------------------------------------
alter table public.profiles
  add column if not exists deleted_at timestamp with time zone,
  add column if not exists deleted_by uuid,
  add column if not exists deleted_reason text;

create index if not exists profiles_deleted_at_idx on public.profiles (deleted_at);

-- 2. Counters ---------------------------------------------------------------
-- A member's effective role is the highest one they hold, so a subreseller is
-- never also counted as a reseller or customer. Demo accounts are excluded
-- from every real shop; the demo preview shop still counts its own members.
create or replace function public.countable_members(_ecosystem_id uuid)
returns table(user_id uuid, role app_role, status account_status)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         (select r.role
            from public.user_roles r
           where r.user_id = p.id and r.ecosystem_id = _ecosystem_id
           order by case r.role
                      when 'super_admin' then 0
                      when 'admin' then 1
                      when 'reseller' then 2
                      when 'subreseller' then 3
                      else 4 end
           limit 1),
         p.status
    from public.profiles p
   where p.ecosystem_id = _ecosystem_id
     and p.deleted_at is null
     and (
       not p.is_demo
       or exists (select 1 from public.ecosystems e
                   where e.id = _ecosystem_id and e.slug = 'demo-preview')
     )
$$;

drop function if exists public.ecosystem_dashboard(uuid);
create function public.ecosystem_dashboard(_ecosystem_id uuid)
returns table(
  member_count bigint,
  customer_count bigint,
  reseller_count bigint,
  subreseller_count bigint,
  admin_count bigint,
  suspended_count bigint,
  suspended_customer_count bigint,
  credits_outstanding numeric,
  points_outstanding bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to read this ecosystem';
  end if;
  return query
    with m as (select * from public.countable_members(_ecosystem_id))
    select
      (select count(*) from m),
      (select count(*) from m where m.role = 'customer'),
      (select count(*) from m where m.role = 'reseller'),
      (select count(*) from m where m.role = 'subreseller'),
      (select count(*) from m where m.role in ('admin','super_admin')),
      (select count(*) from m where m.status = 'suspended'),
      (select count(*) from m where m.status = 'suspended' and m.role = 'customer'),
      (select coalesce(sum(a.balance),0) from public.credit_accounts a
        where a.ecosystem_id = _ecosystem_id
          and exists (select 1 from m where m.user_id = a.user_id)),
      (select coalesce(sum(a.balance),0)::bigint from public.points_accounts a
        where a.ecosystem_id = _ecosystem_id
          and exists (select 1 from m where m.user_id = a.user_id));
end;
$$;

drop function if exists public.platform_overview();
create function public.platform_overview()
returns table(
  id uuid, name text, slug text, description text, contact_email text, contact_phone text,
  signup_enabled boolean, signup_token text, plan_name text, plan_price numeric,
  subscription_state subscription_state, grace_period_days integer,
  current_period_end timestamp with time zone, payment_reference text,
  submitted_at timestamp with time zone, reviewed_at timestamp with time zone,
  created_at timestamp with time zone, admin_count bigint, member_count bigint,
  reseller_count bigint, subreseller_count bigint, customer_count bigint,
  suspended_customer_count bigint, operations_frozen boolean, frozen_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can read the platform overview';
  end if;
  return query
    select e.id, e.name, e.slug, e.description, e.contact_email, e.contact_phone,
           e.signup_enabled, e.signup_token, e.plan_name, e.plan_price,
           e.subscription_state, e.grace_period_days, e.current_period_end,
           e.payment_reference, e.submitted_at, e.reviewed_at, e.created_at,
           (select count(*) from public.countable_members(e.id) m where m.role in ('admin','super_admin')),
           (select count(*) from public.countable_members(e.id) m),
           (select count(*) from public.countable_members(e.id) m where m.role = 'reseller'),
           (select count(*) from public.countable_members(e.id) m where m.role = 'subreseller'),
           (select count(*) from public.countable_members(e.id) m where m.role = 'customer'),
           (select count(*) from public.countable_members(e.id) m
             where m.role = 'customer' and m.status = 'suspended'),
           e.operations_frozen, e.frozen_reason
    from public.ecosystems e
    order by e.created_at desc;
end;
$$;

-- 3. Customer deletion eligibility -----------------------------------------
create or replace function public.customer_deletion_check(_user_id uuid)
returns table(eligible boolean, blockers text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _eco uuid;
  _deleted timestamptz;
  _joined timestamptz;
  _blockers text[] := '{}';
  _credits numeric;
  _points integer;
  _held integer;
  _roles text[];
  _pending integer;
begin
  select p.ecosystem_id, p.deleted_at, p.joined_at
    into _eco, _deleted, _joined
  from public.profiles p where p.id = _user_id;
  if _eco is null then
    raise exception 'Member not found';
  end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  select array_agg(distinct r.role::text) into _roles
    from public.user_roles r where r.user_id = _user_id;
  _roles := coalesce(_roles, '{}');

  if _deleted is not null then
    _blockers := _blockers || 'This account has already been deleted.';
  end if;
  if not ('customer' = any(_roles)) or array_length(_roles, 1) <> 1 then
    _blockers := _blockers || 'Only plain customer accounts can be deleted here.';
  end if;
  if _joined > now() - interval '3 months' then
    _blockers := _blockers || 'The account is less than 3 months old.';
  end if;

  select coalesce(sum(a.balance),0) into _credits
    from public.credit_accounts a where a.user_id = _user_id;
  if _credits <> 0 then
    _blockers := _blockers || ('Credit balance is not zero (' || _credits::text || ').');
  end if;

  select coalesce(sum(a.balance),0), coalesce(sum(a.held),0) into _points, _held
    from public.points_accounts a where a.user_id = _user_id;
  if _points <> 0 then
    _blockers := _blockers || ('Points balance is not zero (' || _points::text || ').');
  end if;
  if _held <> 0 then
    _blockers := _blockers || ('There are points on hold (' || _held::text || ').');
  end if;

  select count(*) into _pending from public.reward_redemptions rr
   where rr.user_id = _user_id and rr.status in ('pending','approved');
  if _pending > 0 then
    _blockers := _blockers || ('There ' || case when _pending = 1 then 'is 1 reward order' else 'are ' || _pending::text || ' reward orders' end || ' still waiting.');
  end if;

  return query select array_length(_blockers, 1) is null, _blockers;
end;
$$;

-- 4. Safe deletion (anonymise identity, keep financial history) -------------
create or replace function public.delete_customer_account(_user_id uuid, _reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _eco uuid;
  _actor text;
  _target text;
  _check record;
begin
  select p.ecosystem_id, p.full_name || ' — ' || p.email
    into _eco, _target
  from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  select * into _check from public.customer_deletion_check(_user_id);
  if not _check.eligible then
    raise exception 'This account cannot be deleted: %', array_to_string(_check.blockers, ' ');
  end if;

  update public.profiles p
     set full_name = 'Deleted customer',
         email = 'deleted+' || _user_id::text || '@deleted.invalid',
         phone = '',
         status = 'suspended',
         reseller_id = null,
         deleted_at = now(),
         deleted_by = auth.uid(),
         deleted_reason = nullif(btrim(coalesce(_reason, '')), '')
   where p.id = _user_id;

  delete from public.user_roles r where r.user_id = _user_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor, 'Admin'),
          'Deleted customer account (anonymised)', coalesce(_target, ''),
          jsonb_build_object('user_id', _user_id, 'reason', _reason,
                             'history_preserved', true));
end;
$$;

revoke all on function public.delete_customer_account(uuid, text) from public;
grant execute on function public.delete_customer_account(uuid, text) to authenticated;
grant execute on function public.customer_deletion_check(uuid) to authenticated;
grant execute on function public.countable_members(uuid) to authenticated;