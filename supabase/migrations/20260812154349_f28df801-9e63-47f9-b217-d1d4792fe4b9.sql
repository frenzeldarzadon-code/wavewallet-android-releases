-- 1. Archive columns -------------------------------------------------------
ALTER TABLE public.ecosystems
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archived_reason text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- 2. Activity clock ---------------------------------------------------------
-- Derived from meaningful business events only. A sign-in never moves it.
CREATE OR REPLACE FUNCTION public.ecosystem_last_activity(_ecosystem_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select greatest(
    (select e.created_at from public.ecosystems e where e.id = _ecosystem_id),
    coalesce((select e.last_activity_at from public.ecosystems e where e.id = _ecosystem_id), '-infinity'),
    coalesce((select max(v.created_at) from public.voucher_sales v where v.ecosystem_id = _ecosystem_id), '-infinity'),
    coalesce((select max(v.created_at) from public.voucher_imports v where v.ecosystem_id = _ecosystem_id), '-infinity'),
    coalesce((select max(c.created_at) from public.credit_ledger c where c.ecosystem_id = _ecosystem_id), '-infinity'),
    coalesce((select max(p.created_at) from public.points_ledger p where p.ecosystem_id = _ecosystem_id), '-infinity'),
    coalesce((select max(greatest(r.created_at, r.updated_at)) from public.reward_redemptions r where r.ecosystem_id = _ecosystem_id), '-infinity'),
    coalesce((select max(a.created_at) from public.audit_logs a where a.ecosystem_id = _ecosystem_id), '-infinity'),
    coalesce((select max(greatest(pr.joined_at, pr.updated_at)) from public.profiles pr where pr.ecosystem_id = _ecosystem_id), '-infinity'),
    coalesce((select max(s.created_at) from public.subscription_requests s where s.ecosystem_id = _ecosystem_id), '-infinity'),
    coalesce((select max(i.created_at) from public.admin_invitations i where i.ecosystem_id = _ecosystem_id), '-infinity')
  );
$$;

-- 3. Cleanup eligibility ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecosystem_cleanup_check(_ecosystem_id uuid)
RETURNS TABLE(status text, eligible boolean, last_activity timestamptz, blockers text[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _e public.ecosystems;
  _blockers text[] := '{}';
  _last timestamptz;
  _inactive boolean;
  _num numeric;
  _int integer;
  _n bigint;
begin
  select * into _e from public.ecosystems where id = _ecosystem_id;
  if _e.id is null then
    raise exception 'Ecosystem not found';
  end if;
  if auth.uid() is not null and not public.is_super_admin(auth.uid())
     and not public.is_ecosystem_admin(auth.uid(), _ecosystem_id) then
    raise exception 'Not authorized to read this ecosystem';
  end if;

  _last := public.ecosystem_last_activity(_ecosystem_id);

  if _e.archived_at is not null then
    return query select 'archived'::text, false, _last, array['This shop is already archived.']::text[];
    return;
  end if;

  _inactive := _last <= now() - interval '12 months';
  if not _inactive then
    _blockers := array_append(_blockers, 'The shop has had business activity in the last 12 months.');
  end if;

  select coalesce(sum(a.balance), 0) into _num
    from public.credit_accounts a where a.ecosystem_id = _ecosystem_id;
  if _num <> 0 then
    _blockers := array_append(_blockers, 'Members still hold credits (' || _num::text || ').');
  end if;

  select coalesce(sum(a.balance), 0), coalesce(sum(a.held), 0) into _int, _n
    from public.points_accounts a where a.ecosystem_id = _ecosystem_id;
  if coalesce(_int, 0) <> 0 then
    _blockers := array_append(_blockers, 'Members still hold points (' || _int::text || ').');
  end if;
  if coalesce(_n, 0) <> 0 then
    _blockers := array_append(_blockers, 'There are points on hold (' || _n::text || ').');
  end if;

  select count(*) into _n from public.reward_redemptions r
   where r.ecosystem_id = _ecosystem_id and r.status in ('pending', 'approved');
  if _n > 0 then
    _blockers := array_append(_blockers, 'There are ' || _n::text || ' reward orders still waiting.');
  end if;

  select coalesce(sum(p.reserved), 0) into _n from public.reward_products p
   where p.ecosystem_id = _ecosystem_id;
  if coalesce(_n, 0) > 0 then
    _blockers := array_append(_blockers, 'Reward stock is still reserved for members.');
  end if;

  select count(*) into _n from public.voucher_codes c
   where c.ecosystem_id = _ecosystem_id and c.status <> 'sold';
  if _n > 0 then
    _blockers := array_append(_blockers, 'There are ' || _n::text || ' unsold voucher codes in inventory.');
  end if;

  select count(*) into _n from public.voucher_codes c
   where c.ecosystem_id = _ecosystem_id
     and c.status = 'sold'
     and coalesce(c.sold_at, c.created_at) > now() - interval '12 months';
  if _n > 0 then
    _blockers := array_append(_blockers, 'Sold vouchers from the last 12 months must still be retained.');
  end if;

  if _e.subscription_state in ('pending', 'awaiting_approval') then
    _blockers := array_append(_blockers, 'A subscription payment is still awaiting review.');
  end if;
  if _e.subscription_state = 'active'
     and (_e.current_period_end is null or _e.current_period_end > now()) then
    _blockers := array_append(_blockers, 'The subscription is still running.');
  end if;

  select count(*) into _n from public.subscription_requests s
   where s.ecosystem_id = _ecosystem_id and s.status = 'pending';
  if _n > 0 then
    _blockers := array_append(_blockers, 'There are unreviewed subscription payment requests.');
  end if;

  if coalesce(_e.operations_frozen, false) then
    _blockers := array_append(_blockers,
      'The shop is frozen by the platform owner and must be reviewed first.');
  end if;

  return query select
    case
      when array_length(_blockers, 1) is null then 'eligible'
      when not _inactive then 'active'
      else 'blocked'
    end::text,
    array_length(_blockers, 1) is null,
    _last,
    _blockers;
end;
$$;

-- 4. Archive action ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_ecosystem(_ecosystem_id uuid, _reason text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _chk record;
  _name text;
  _actor text;
  _now timestamptz := now();
begin
  -- Ecosystem deletion is platform-owner only; a tenant admin cannot remove
  -- their own shop. The maintenance job runs without a session (auth.uid() null).
  if auth.uid() is not null and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can delete an ecosystem';
  end if;

  select e.name into _name from public.ecosystems e where e.id = _ecosystem_id for update;
  if _name is null then
    raise exception 'Ecosystem not found';
  end if;

  select * into _chk from public.ecosystem_cleanup_check(_ecosystem_id);
  if not _chk.eligible then
    raise exception 'This shop cannot be deleted yet: %', array_to_string(_chk.blockers, ' ');
  end if;

  update public.ecosystems
     set archived_at = _now,
         archived_by = auth.uid(),
         archived_reason = nullif(trim(coalesce(_reason, '')), ''),
         signup_enabled = false,
         operations_frozen = true,
         frozen_reason = 'Shop archived',
         subscription_state = 'suspended',
         signup_token = encode(gen_random_bytes(12), 'hex'),
         updated_at = _now
   where id = _ecosystem_id;

  -- Members lose access: every profile in the shop is suspended.
  update public.profiles
     set status = 'suspended', updated_at = _now
   where ecosystem_id = _ecosystem_id and status <> 'suspended';

  select coalesce(p.full_name, 'Maintenance job') into _actor
    from public.profiles p where p.id = auth.uid();

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Maintenance job'),
          'Archived ecosystem', _name,
          jsonb_build_object('reason', _reason, 'last_activity', _chk.last_activity,
                             'automatic', auth.uid() is null));

  return _now;
end;
$$;

-- 5. Maintenance job --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_ecosystem_cleanup(_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _row record;
  _chk record;
  _archived jsonb := '[]'::jsonb;
  _eligible jsonb := '[]'::jsonb;
  _skipped int := 0;
begin
  if auth.uid() is not null and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can run the ecosystem cleanup';
  end if;

  for _row in
    select id, name from public.ecosystems where archived_at is null order by created_at
  loop
    select * into _chk from public.ecosystem_cleanup_check(_row.id);
    if _chk.eligible then
      _eligible := _eligible || jsonb_build_object('id', _row.id, 'name', _row.name,
                                                   'last_activity', _chk.last_activity);
      if not coalesce(_dry_run, false) then
        perform public.archive_ecosystem(_row.id, 'Automatic cleanup — no activity for 12 months');
        _archived := _archived || jsonb_build_object('id', _row.id, 'name', _row.name);
      end if;
    else
      _skipped := _skipped + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ran_at', now(),
    'dry_run', coalesce(_dry_run, false),
    'eligible', _eligible,
    'archived', _archived,
    'skipped', _skipped
  );
end;
$$;

REVOKE ALL ON FUNCTION public.run_ecosystem_cleanup(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.archive_ecosystem(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.ecosystem_cleanup_check(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ecosystem_last_activity(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.run_ecosystem_cleanup(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_ecosystem(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ecosystem_cleanup_check(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ecosystem_last_activity(uuid) TO authenticated, service_role;

-- 6. Archived shops are never operational and never publicly visible --------
CREATE OR REPLACE FUNCTION public.subscription_ok(_ecosystem_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select exists (
    select 1 from public.ecosystems e
    where e.id = _ecosystem_id
      and e.archived_at is null
      and e.subscription_state = 'active'
      and (e.current_period_end is null
           or e.current_period_end + make_interval(days => e.grace_period_days) > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.get_signup_ecosystem(_slug text)
RETURNS TABLE(id uuid, name text, slug text, description text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select e.id, e.name, e.slug, e.description
  from public.ecosystems e
  where lower(e.slug) = lower(_slug) and e.signup_enabled and e.archived_at is null;
$$;

CREATE OR REPLACE FUNCTION public.list_signup_ecosystems()
RETURNS TABLE(id uuid, name text, slug text, description text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select e.id, e.name, e.slug, e.description
  from public.ecosystems e
  where e.signup_enabled
    and e.archived_at is null
    and e.subscription_state = 'active'
    and not coalesce(e.operations_frozen, false)
  order by e.name
$$;

-- 7. Platform overview reports the lifecycle state --------------------------
DROP FUNCTION IF EXISTS public.platform_overview();
CREATE FUNCTION public.platform_overview()
RETURNS TABLE(id uuid, name text, slug text, description text, contact_email text,
              contact_phone text, signup_enabled boolean, signup_token text, plan_name text,
              plan_price numeric, subscription_state subscription_state, grace_period_days integer,
              current_period_end timestamp with time zone, payment_reference text,
              submitted_at timestamp with time zone, reviewed_at timestamp with time zone,
              created_at timestamp with time zone, admin_count bigint, member_count bigint,
              reseller_count bigint, subreseller_count bigint, customer_count bigint,
              suspended_customer_count bigint, operations_frozen boolean, frozen_reason text,
              archived_at timestamp with time zone, archived_reason text,
              last_activity_at timestamp with time zone, cleanup_status text,
              cleanup_blockers text[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
           e.operations_frozen, e.frozen_reason,
           e.archived_at, e.archived_reason,
           chk.last_activity, chk.status, chk.blockers
    from public.ecosystems e
    cross join lateral public.ecosystem_cleanup_check(e.id) chk
    order by e.created_at desc;
end;
$$;