-- Ecosystem rows are no longer writable straight from the client.
drop policy if exists "Admins can update their ecosystem" on public.ecosystems;
revoke insert, update, delete on public.ecosystems from authenticated, anon;
drop policy if exists "Super admins manage ecosystems" on public.ecosystems;
drop policy if exists "Super admins delete ecosystems" on public.ecosystems;

create or replace function public.slugify(_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(_value,'')), '[^a-z0-9]+', '-', 'g'));
$$;
grant execute on function public.slugify(text) to authenticated;

create or replace function public.create_ecosystem(
  _name text,
  _slug text default null,
  _description text default null,
  _contact_email text default null,
  _contact_phone text default null,
  _plan_name text default 'Starter',
  _plan_price numeric default 0,
  _grace_period_days integer default 5,
  _signup_enabled boolean default true
)
returns public.ecosystems
language plpgsql
security definer
set search_path = public
as $$
declare
  _base text;
  _candidate text;
  _n integer := 1;
  _row public.ecosystems;
  _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can create ecosystems';
  end if;
  if coalesce(trim(_name),'') = '' then
    raise exception 'An ecosystem needs a name';
  end if;
  if _plan_price < 0 then raise exception 'Plan price cannot be negative'; end if;
  if _grace_period_days < 0 or _grace_period_days > 90 then
    raise exception 'Grace period must be between 0 and 90 days';
  end if;

  _base := public.slugify(coalesce(nullif(trim(_slug),''), _name));
  if _base = '' then _base := 'shop'; end if;
  _candidate := _base;
  while exists (select 1 from public.ecosystems where slug = _candidate) loop
    _n := _n + 1;
    _candidate := _base || '-' || _n;
  end loop;

  insert into public.ecosystems
    (name, slug, description, contact_email, contact_phone,
     plan_name, plan_price, grace_period_days, signup_enabled)
  values
    (trim(_name), _candidate, nullif(trim(_description),''),
     nullif(lower(trim(_contact_email)),''), nullif(trim(_contact_phone),''),
     coalesce(nullif(trim(_plan_name),''), 'Starter'), _plan_price,
     _grace_period_days, coalesce(_signup_enabled, true))
  returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.id, auth.uid(), coalesce(_actor,'Super admin'), 'Created ecosystem', _row.name,
          jsonb_build_object('slug', _row.slug, 'plan', _row.plan_name, 'price', _row.plan_price));
  return _row;
end;
$$;
revoke execute on function public.create_ecosystem(text,text,text,text,text,text,numeric,integer,boolean) from public, anon;
grant execute on function public.create_ecosystem(text,text,text,text,text,text,numeric,integer,boolean) to authenticated;

create or replace function public.update_ecosystem(
  _ecosystem_id uuid,
  _name text,
  _description text default null,
  _contact_email text default null,
  _contact_phone text default null,
  _signup_enabled boolean default null
)
returns public.ecosystems
language plpgsql
security definer
set search_path = public
as $$
declare _row public.ecosystems; _actor text; _prev public.ecosystems;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if coalesce(trim(_name),'') = '' then raise exception 'An ecosystem needs a name'; end if;

  select * into _prev from public.ecosystems where id = _ecosystem_id;
  if _prev.id is null then raise exception 'Ecosystem not found'; end if;

  update public.ecosystems
     set name = trim(_name),
         description = nullif(trim(_description),''),
         contact_email = nullif(lower(trim(_contact_email)),''),
         contact_phone = nullif(trim(_contact_phone),''),
         signup_enabled = coalesce(_signup_enabled, signup_enabled)
   where id = _ecosystem_id
  returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Updated ecosystem settings', _row.name,
          jsonb_build_object('signup_enabled_before', _prev.signup_enabled,
                             'signup_enabled_after', _row.signup_enabled));
  return _row;
end;
$$;
revoke execute on function public.update_ecosystem(uuid,text,text,text,text,boolean) from public, anon;
grant execute on function public.update_ecosystem(uuid,text,text,text,text,boolean) to authenticated;

create or replace function public.update_ecosystem_plan(
  _ecosystem_id uuid,
  _plan_name text,
  _plan_price numeric,
  _grace_period_days integer
)
returns public.ecosystems
language plpgsql
security definer
set search_path = public
as $$
declare _row public.ecosystems; _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can change plans';
  end if;
  if _plan_price < 0 then raise exception 'Plan price cannot be negative'; end if;
  if _grace_period_days < 0 or _grace_period_days > 90 then
    raise exception 'Grace period must be between 0 and 90 days';
  end if;
  update public.ecosystems
     set plan_name = coalesce(nullif(trim(_plan_name),''), plan_name),
         plan_price = _plan_price,
         grace_period_days = _grace_period_days
   where id = _ecosystem_id
  returning * into _row;
  if _row.id is null then raise exception 'Ecosystem not found'; end if;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Super admin'), 'Updated plan', _row.name,
          jsonb_build_object('plan', _row.plan_name, 'price', _row.plan_price,
                             'grace_period_days', _row.grace_period_days));
  return _row;
end;
$$;
revoke execute on function public.update_ecosystem_plan(uuid,text,numeric,integer) from public, anon;
grant execute on function public.update_ecosystem_plan(uuid,text,numeric,integer) to authenticated;

create or replace function public.set_member_status(_user_id uuid, _status public.account_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _eco uuid; _actor text; _prev public.account_status; _target text;
begin
  select ecosystem_id, status, full_name || ' — ' || email
    into _eco, _prev, _target
  from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if public.is_super_admin(_user_id) then
    raise exception 'Platform owners cannot be suspended here';
  end if;

  update public.profiles set status = _status where id = _user_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'),
          case when _status = 'suspended' then 'Suspended member' else 'Reactivated member' end,
          coalesce(_target,''), jsonb_build_object('previous', _prev, 'new', _status));
end;
$$;
revoke execute on function public.set_member_status(uuid, public.account_status) from public, anon;
grant execute on function public.set_member_status(uuid, public.account_status) to authenticated;

create or replace function public.platform_overview()
returns table (
  id uuid, name text, slug text, description text,
  contact_email text, contact_phone text,
  signup_enabled boolean, signup_token text,
  plan_name text, plan_price numeric,
  subscription_state public.subscription_state,
  grace_period_days integer, current_period_end timestamptz,
  payment_reference text, submitted_at timestamptz, reviewed_at timestamptz,
  created_at timestamptz,
  admin_count bigint, member_count bigint, reseller_count bigint
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
           (select count(*) from public.user_roles r where r.ecosystem_id = e.id and r.role = 'admin'),
           (select count(*) from public.profiles p where p.ecosystem_id = e.id),
           (select count(*) from public.user_roles r where r.ecosystem_id = e.id and r.role = 'reseller')
    from public.ecosystems e
    order by e.created_at desc;
end;
$$;
revoke execute on function public.platform_overview() from public, anon;
grant execute on function public.platform_overview() to authenticated;

create or replace function public.ecosystem_dashboard(_ecosystem_id uuid)
returns table (
  member_count bigint,
  customer_count bigint,
  reseller_count bigint,
  suspended_count bigint,
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
    select
      (select count(*) from public.profiles p where p.ecosystem_id = _ecosystem_id),
      (select count(*) from public.user_roles r where r.ecosystem_id = _ecosystem_id and r.role = 'customer'),
      (select count(*) from public.user_roles r where r.ecosystem_id = _ecosystem_id and r.role = 'reseller'),
      (select count(*) from public.profiles p where p.ecosystem_id = _ecosystem_id and p.status = 'suspended'),
      (select coalesce(sum(a.balance),0) from public.credit_accounts a where a.ecosystem_id = _ecosystem_id),
      (select coalesce(sum(a.balance),0)::bigint from public.points_accounts a where a.ecosystem_id = _ecosystem_id);
end;
$$;
revoke execute on function public.ecosystem_dashboard(uuid) from public, anon;
grant execute on function public.ecosystem_dashboard(uuid) to authenticated;