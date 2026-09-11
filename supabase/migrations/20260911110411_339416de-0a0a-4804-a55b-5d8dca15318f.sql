-- 1. Authoritative shop-type helper: only New Generation shops use approval.
create or replace function public.shop_requires_membership_approval(_ecosystem_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.shop_type(_ecosystem_id) = 'new_generation', false);
$$;

revoke all on function public.shop_requires_membership_approval(uuid) from public, anon;
grant execute on function public.shop_requires_membership_approval(uuid) to authenticated, service_role;

-- 2. Instant Universe membership: no application, no approval, keeps any
--    existing shop role (admin / reseller / subreseller) intact.
create or replace function public.ensure_universe_membership(_user_id uuid, _ecosystem_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public, pg_temp'
as $$
begin
  if _user_id is null or _ecosystem_id is null then return; end if;
  if public.shop_requires_membership_approval(_ecosystem_id) then
    raise exception 'This shop requires membership approval';
  end if;
  if public.is_super_admin(_user_id) then return; end if;

  insert into public.ecosystem_memberships
    (user_id, ecosystem_id, role, status, membership_state)
  values (_user_id, _ecosystem_id, 'customer', 'active', 'active')
  on conflict (user_id, ecosystem_id) do update
    set role = case
                 when public.ecosystem_memberships.role in ('admin','reseller','subreseller')
                   then public.ecosystem_memberships.role
                 else 'customer'
               end,
        membership_state = 'active',
        status = case when public.ecosystem_memberships.status = 'suspended'
                      then 'suspended' else 'active' end,
        updated_at = now();

  perform public.ensure_membership_wallets(_user_id, _ecosystem_id);
end;
$$;

revoke all on function public.ensure_universe_membership(uuid, uuid) from public, anon;
grant execute on function public.ensure_universe_membership(uuid, uuid) to authenticated, service_role;

-- 3. Joining: Universe is instant, New Generation keeps the application flow.
create or replace function public.request_join_ecosystem(_ecosystem_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public, pg_temp'
as $$
declare
  _uid uuid := auth.uid();
  _p public.profiles%rowtype;
  _id uuid;
begin
  if _uid is null then raise exception 'Not signed in'; end if;
  if public.acting_as() is not null then
    raise exception 'Cannot join a shop while acting as another member';
  end if;
  select * into _p from public.profiles where id = _uid;
  if _p.id is null or _p.deleted_at is not null then raise exception 'Account not available'; end if;
  if public.is_super_admin(_uid) then raise exception 'Platform owners do not join shops'; end if;
  if not exists (
    select 1 from public.ecosystems e
    where e.id = _ecosystem_id and e.signup_enabled and e.archived_at is null
      and e.subscription_state = 'active' and not coalesce(e.operations_frozen, false)
  ) then raise exception 'That shop is not accepting members right now'; end if;
  if exists (
    select 1 from public.ecosystem_memberships
    where user_id = _uid and ecosystem_id = _ecosystem_id and membership_state = 'active'
  ) then raise exception 'You are already a member of that shop'; end if;

  -- Universe shops have no membership requirement at all.
  if not public.shop_requires_membership_approval(_ecosystem_id) then
    perform public.ensure_universe_membership(_uid, _ecosystem_id);
    insert into public.audit_logs
      (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_ecosystem_id, _uid, coalesce(_p.full_name, _p.email), 'Joined Universe shop',
            lower(coalesce(_p.email,'')),
            jsonb_build_object('source', 'universe_open_access', 'approval_required', false));
    return null;
  end if;

  if exists (
    select 1 from public.membership_applications
    where user_id = _uid and ecosystem_id = _ecosystem_id and status = 'pending'
  ) then raise exception 'Your membership is already under review for that shop'; end if;

  insert into public.membership_applications
    (user_id, ecosystem_id, full_name, email, phone)
  values (_uid, _ecosystem_id, coalesce(_p.full_name,''), coalesce(_p.email,''), coalesce(_p.phone,''))
  returning id into _id;

  perform public.auto_process_membership_application(_id);
  return _id;
end;
$$;

-- 4. Any application that still lands on a Universe shop (signup link, legacy
--    callers) is settled immediately and never enters an approval queue.
create or replace function public.auto_process_membership_application(_application_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public, pg_temp'
as $$
declare
  _app public.membership_applications%rowtype;
  _balance numeric := 0;
  _has_active boolean;
  _has_other_active boolean;
  _actor_name text;
begin
  select * into _app
  from public.membership_applications
  where id = _application_id
  for update;
  if _app.id is null then raise exception 'Application not found'; end if;
  if _app.status <> 'pending' then return _app.status = 'approved'; end if;

  -- Universe shops: no approval, no pending state, no admin queue.
  if not public.shop_requires_membership_approval(_app.ecosystem_id) then
    perform public.ensure_universe_membership(_app.user_id, _app.ecosystem_id);

    if public.active_ecosystem(_app.user_id) is null then
      update public.profiles
         set ecosystem_id = _app.ecosystem_id,
             active_ecosystem_id = _app.ecosystem_id,
             updated_at = now()
       where id = _app.user_id;
      insert into public.user_roles (user_id, role, ecosystem_id)
      values (_app.user_id, 'customer', _app.ecosystem_id)
      on conflict (user_id, ecosystem_id, role) do nothing;
    end if;

    update public.membership_applications
       set status = 'approved',
           decision_reason = 'Universe shops do not require membership approval',
           decided_by = null,
           decider_name = 'System',
           decider_role = 'super_admin',
           decided_at = now(),
           updated_at = now()
     where id = _app.id;
    return true;
  end if;

  select coalesce(ca.balance, 0)
    into _balance
  from public.credit_accounts ca
  where ca.user_id = _app.user_id
    and ca.ecosystem_id = _app.ecosystem_id;

  if coalesce(_balance, 0) > 0 then
    update public.membership_applications
       set decision_reason = 'Manual review required because this member already has coins in this shop',
           decided_by = null,
           decider_name = null,
           decider_role = null,
           decided_at = null,
           updated_at = now()
     where id = _app.id;
    return false;
  end if;

  select exists (
    select 1 from public.ecosystem_memberships m
    where m.user_id = _app.user_id
      and m.ecosystem_id = _app.ecosystem_id
      and m.membership_state = 'active'
      and m.status = 'active'
  ) into _has_active;

  if not _has_active then
    insert into public.ecosystem_memberships
      (user_id, ecosystem_id, role, status, membership_state)
    values
      (_app.user_id, _app.ecosystem_id, 'customer', 'active', 'active')
    on conflict (user_id, ecosystem_id) do update
      set role = case
                   when public.ecosystem_memberships.role in ('admin','reseller','subreseller')
                     then public.ecosystem_memberships.role
                   else 'customer'
                 end,
          status = 'active',
          membership_state = 'active',
          updated_at = now();

    perform public.ensure_membership_wallets(_app.user_id, _app.ecosystem_id);

    select exists (
      select 1 from public.ecosystem_memberships m
      where m.user_id = _app.user_id
        and m.membership_state = 'active'
        and m.status = 'active'
        and m.ecosystem_id <> _app.ecosystem_id
    ) into _has_other_active;

    if not _has_other_active and public.active_ecosystem(_app.user_id) is null then
      update public.profiles
         set ecosystem_id = _app.ecosystem_id,
             active_ecosystem_id = _app.ecosystem_id,
             updated_at = now()
       where id = _app.user_id;

      insert into public.user_roles (user_id, role, ecosystem_id)
      values (_app.user_id, 'customer', _app.ecosystem_id)
      on conflict (user_id, ecosystem_id, role) do nothing;
    end if;
  end if;

  update public.membership_applications
     set decision_reason = 'Auto-approved — awaiting admin member review',
         decided_by = null,
         decider_name = 'System',
         decider_role = 'super_admin',
         decided_at = null,
         updated_at = now()
   where id = _app.id;

  select coalesce(full_name, email) into _actor_name
    from public.profiles where id = _app.user_id;

  insert into public.audit_logs
    (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values
    (_app.ecosystem_id, null, 'System', 'Auto-approved new shop member',
     lower(_app.email),
     jsonb_build_object(
       'application_id', _app.id,
       'user_id', _app.user_id,
       'source', 'automatic_membership_rule',
       'admin_review_required', true,
       'coin_balance_at_join', coalesce(_balance,0),
       'member_name', _actor_name
     ));

  perform public.notify_member(
    _app.user_id,
    _app.ecosystem_id,
    'membership_auto_approved',
    'You joined the shop',
    'Your membership was activated automatically. The shop admin may review and remove your membership if needed.',
    '/app'
  );

  return true;
end;
$$;

-- 5. Entering a Universe shop never depends on an approved membership.
create or replace function public.switch_ecosystem(_ecosystem_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE _uid uuid := auth.uid(); _m public.ecosystem_memberships%rowtype;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.acting_as() IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot switch shops while acting as another member';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ecosystems WHERE id = _ecosystem_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  -- Platform-level access: no membership, no role change, no wallet.
  IF public.is_super_admin(_uid) THEN
    UPDATE public.profiles SET active_ecosystem_id = _ecosystem_id, ecosystem_id = _ecosystem_id
     WHERE id = _uid;
    PERFORM public.log_operator_action(
      _uid, _ecosystem_id, 'switch_ecosystem', 'ecosystem', _ecosystem_id,
      jsonb_build_object('ecosystem_id', _ecosystem_id, 'platform_access', true)
    );
    RETURN _ecosystem_id;
  END IF;

  SELECT * INTO _m FROM public.ecosystem_memberships
  WHERE user_id = _uid AND ecosystem_id = _ecosystem_id AND membership_state = 'active';

  -- Universe shops: open access. A missing or never-approved membership is
  -- created on the spot instead of blocking the person.
  IF _m.id IS NULL AND NOT public.shop_requires_membership_approval(_ecosystem_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ecosystem_memberships
       WHERE user_id = _uid AND ecosystem_id = _ecosystem_id AND status = 'suspended'
    ) THEN
      PERFORM public.ensure_universe_membership(_uid, _ecosystem_id);
      SELECT * INTO _m FROM public.ecosystem_memberships
      WHERE user_id = _uid AND ecosystem_id = _ecosystem_id AND membership_state = 'active';
    END IF;
  END IF;

  IF _m.id IS NULL THEN RAISE EXCEPTION 'You do not have an approved membership in that shop'; END IF;
  IF _m.status <> 'active' THEN RAISE EXCEPTION 'Your membership in that shop is suspended'; END IF;

  IF NOT public.ecosystem_has_admin(_ecosystem_id) AND _m.role <> 'admin' THEN
    RAISE EXCEPTION 'This shop has no admin assigned yet and is not open';
  END IF;

  PERFORM public.ensure_membership_wallets(_uid, _ecosystem_id);

  -- Shop-scoped state only. handle / full_name are global and stay untouched.
  UPDATE public.profiles SET
    active_ecosystem_id = _ecosystem_id,
    ecosystem_id = _ecosystem_id,
    status = _m.status,
    reseller_id = _m.reseller_id,
    reseller_discount_percent = COALESCE(_m.reseller_discount_percent, 0),
    reseller_commission_percent = _m.reseller_commission_percent,
    sale_commission_percent = _m.sale_commission_percent
  WHERE id = _uid;

  DELETE FROM public.user_roles WHERE user_id = _uid AND role <> 'super_admin';
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_uid, _m.role, _ecosystem_id)
  ON CONFLICT (user_id, ecosystem_id, role) DO UPDATE SET ecosystem_id = excluded.ecosystem_id;

  PERFORM public.log_operator_action(
    _uid, _ecosystem_id, 'switch_ecosystem', 'ecosystem_membership', _m.id,
    jsonb_build_object('ecosystem_id', _ecosystem_id, 'role', _m.role)
  );

  RETURN _ecosystem_id;
END $$;

-- 6. Approving / rejecting is a New Generation action only.
create or replace function public.can_review_applications(_user_id uuid, _ecosystem_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public, pg_temp'
as $$
  SELECT public.shop_requires_membership_approval(_ecosystem_id)
     AND (
       public.is_super_admin(_user_id)
       OR EXISTS (
         SELECT 1 FROM public.ecosystem_memberships m
          WHERE m.user_id = _user_id
            AND m.ecosystem_id = _ecosystem_id
            AND m.membership_state = 'active'
            AND m.status = 'active'
            AND m.role IN ('admin','reseller','subreseller')
       )
     );
$$;

-- 7. Settle existing Universe records: nothing is deleted, nothing NG changes.
update public.ecosystem_memberships m
   set membership_state = 'active', updated_at = now()
 where m.membership_state = 'pending'
   and not public.shop_requires_membership_approval(m.ecosystem_id);

update public.membership_applications a
   set status = 'approved',
       decision_reason = 'Universe shops do not require membership approval',
       decider_name = coalesce(a.decider_name, 'System'),
       decider_role = coalesce(a.decider_role, 'super_admin'),
       decided_at = coalesce(a.decided_at, now()),
       updated_at = now()
 where a.status = 'pending'
   and not public.shop_requires_membership_approval(a.ecosystem_id);
