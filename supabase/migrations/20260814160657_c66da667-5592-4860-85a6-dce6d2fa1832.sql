-- 1. Shop admin authority is membership-based, so one person can administer
--    several shops independently.
CREATE OR REPLACE FUNCTION public.is_ecosystem_admin(_user_id uuid, _ecosystem_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select _ecosystem_id is not null and (
    exists (
      select 1 from public.ecosystem_memberships m
       where m.user_id = _user_id and m.ecosystem_id = _ecosystem_id
         and m.role = 'admin' and m.membership_state = 'active' and m.status = 'active'
    )
    or exists (
      select 1 from public.user_roles r
       where r.user_id = _user_id and r.role = 'admin' and r.ecosystem_id = _ecosystem_id
    )
  );
$function$;

-- 2. The platform owner never holds an ordinary shop credit wallet.
CREATE OR REPLACE FUNCTION public.ensure_membership_wallets(_user_id uuid, _ecosystem_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_super_admin(_user_id) THEN RETURN; END IF;
  INSERT INTO public.credit_accounts (user_id, ecosystem_id)
  VALUES (_user_id, _ecosystem_id)
  ON CONFLICT (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
  INSERT INTO public.points_accounts (user_id, ecosystem_id)
  VALUES (_user_id, _ecosystem_id)
  ON CONFLICT (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
END $function$;

-- 3. Entering a shop never moves money. The platform owner may enter any shop
--    without a membership; ordinary members still need an approved one.
CREATE OR REPLACE FUNCTION public.switch_ecosystem(_ecosystem_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF _m.id IS NULL THEN RAISE EXCEPTION 'You do not have an approved membership in that shop'; END IF;
  IF _m.status <> 'active' THEN RAISE EXCEPTION 'Your membership in that shop is suspended'; END IF;

  IF NOT public.ecosystem_has_admin(_ecosystem_id) AND _m.role <> 'admin' THEN
    RAISE EXCEPTION 'This shop has no admin assigned yet and is not open';
  END IF;

  PERFORM public.ensure_membership_wallets(_uid, _ecosystem_id);

  UPDATE public.profiles SET
    active_ecosystem_id = _ecosystem_id,
    ecosystem_id = _ecosystem_id,
    status = _m.status,
    reseller_id = _m.reseller_id,
    reseller_discount_percent = COALESCE(_m.reseller_discount_percent, 0),
    reseller_commission_percent = _m.reseller_commission_percent,
    sale_commission_percent = _m.sale_commission_percent,
    handle = _m.handle
  WHERE id = _uid;

  DELETE FROM public.user_roles WHERE user_id = _uid AND role <> 'super_admin';
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_uid, _m.role, _ecosystem_id)
  ON CONFLICT (user_id, role) DO UPDATE SET ecosystem_id = excluded.ecosystem_id;

  PERFORM public.log_operator_action(
    _uid, _ecosystem_id, 'switch_ecosystem', 'ecosystem_membership', _m.id,
    jsonb_build_object('ecosystem_id', _ecosystem_id, 'role', _m.role)
  );

  RETURN _ecosystem_id;
END $function$;

-- 4. Assignment IS the approval: immediate access, pending requests closed.
CREATE OR REPLACE FUNCTION public.assign_shop_admin(_ecosystem_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _shop text; _old uuid; _old_name text; _new_name text; _op text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can assign a shop admin';
  end if;
  select name into _shop from public.ecosystems where id = _ecosystem_id;
  if _shop is null then raise exception 'Shop not found'; end if;
  if not exists (select 1 from public.profiles where id = _user_id and deleted_at is null) then
    raise exception 'That account no longer exists';
  end if;
  if public.is_super_admin(_user_id) then
    raise exception 'The platform owner already manages every shop';
  end if;

  select m.user_id into _old from public.ecosystem_memberships m
   where m.ecosystem_id = _ecosystem_id and m.role = 'admin'
     and m.membership_state = 'active' limit 1;
  if _old is null then
    select ur.user_id into _old from public.user_roles ur
     where ur.ecosystem_id = _ecosystem_id and ur.role = 'admin' limit 1;
  end if;
  if _old = _user_id then
    raise exception 'That member already manages this shop';
  end if;

  -- Step the previous admin down to customer, keeping their membership + wallets.
  if _old is not null then
    update public.user_roles set role = 'customer'
      where user_id = _old and ecosystem_id = _ecosystem_id and role = 'admin';
    update public.ecosystem_memberships set role = 'customer'
      where user_id = _old and ecosystem_id = _ecosystem_id;
    select full_name into _old_name from public.profiles where id = _old;
  end if;

  -- Promote the new admin, creating the membership when they are new to the shop.
  insert into public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  values (_user_id, _ecosystem_id, 'admin', 'active')
  on conflict (user_id, ecosystem_id)
  do update set role = 'admin', membership_state = 'active';

  delete from public.user_roles
   where user_id = _user_id and ecosystem_id = _ecosystem_id;
  insert into public.user_roles (user_id, ecosystem_id, role)
  values (_user_id, _ecosystem_id, 'admin')
  on conflict (user_id, role) do nothing;

  -- The assignment itself is the approval: no second workflow.
  update public.membership_applications
     set status = 'approved', decision_reason = coalesce(decision_reason, 'Assigned as shop admin'),
         reviewed_at = now(), reviewed_by = auth.uid()
   where user_id = _user_id and ecosystem_id = _ecosystem_id and status = 'pending';
  update public.ecosystem_invitations
     set status = 'accepted', responded_at = now()
   where user_id = _user_id and ecosystem_id = _ecosystem_id and status = 'pending';

  perform public.ensure_membership_wallets(_user_id, _ecosystem_id);

  update public.ecosystems
     set admin_assigned_at = now(), admin_assigned_by = auth.uid()
   where id = _ecosystem_id;

  select full_name into _new_name from public.profiles where id = _user_id;
  select coalesce(full_name, 'Platform owner') into _op from public.profiles where id = auth.uid();

  perform public.notify_member(_user_id, _ecosystem_id, 'shop_admin_assigned',
    'You now manage ' || _shop,
    'The platform owner assigned you as the shop admin of ' || _shop || '. You can enter it right away.', '/admin');

  if _old is not null then
    perform public.notify_member(_old, _ecosystem_id, 'shop_admin_assigned',
      'Management of ' || _shop || ' was reassigned',
      'You remain a member of ' || _shop || '; your wallet and history are unchanged.', '/app');
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), _op,
          case when _old is null then 'Assigned shop admin' else 'Replaced shop admin' end,
          coalesce(_new_name, _user_id::text),
          jsonb_build_object('ecosystem_id', _ecosystem_id, 'shop', _shop,
                             'previous_admin_id', _old, 'previous_admin_name', _old_name,
                             'new_admin_id', _user_id, 'new_admin_name', _new_name,
                             'operator_id', auth.uid(), 'at', now()));
end $function$;

-- 5. Credit adjustments always hit the wallet of the shop in question.
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_user_id uuid, _amount numeric, _reason text, _reference text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _acct uuid; _tx text; _actor text; _target text; _dir text;
        _before numeric(14,2); _after numeric(14,2);
begin
  perform public.require_operational();
  select public.active_ecosystem(_user_id), p.full_name || ' — ' || p.email into _eco, _target
  from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _amount is null or _amount = 0 then raise exception 'Enter an amount'; end if;
  if _amount > 0 and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can create credits. Buy platform credits, then load them from your own wallet.';
  end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;

  select id, balance into _acct, _before from public.credit_accounts
   where user_id = _user_id and ecosystem_id is not distinct from _eco;
  if _acct is null then raise exception 'This member has no credit wallet in this shop yet'; end if;

  _tx := public.new_tx_id();
  _dir := case when _amount > 0 then 'credit' else 'debit' end;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, _dir, abs(_amount), 0, trim(_reason),
          nullif(trim(_reference),''), auth.uid(), _tx,
          case when _amount > 0 then 'credit_issue' else 'credit_revocation' end,
          abs(_amount), 0, 0)
  returning balance_after into _after;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'),
          case when _amount > 0 then 'Created credits' else 'Deducted credits' end,
          coalesce(_target,''),
          jsonb_build_object('amount', abs(_amount), 'reason', trim(_reason), 'reference', _reference,
                             'ecosystem_id', _eco, 'recipient_id', _user_id,
                             'balance_before', _before, 'balance_after', _after,
                             'operator_id', auth.uid(),
                             'action_type', case when _amount > 0 then 'manual_credit' else 'adjustment' end,
                             'commission_percent', 0, 'commission_amount', 0,
                             'total_received', abs(_amount), 'tx_id', _tx));
  return _tx;
end; $function$;

-- 6. Admin credit loads move money inside ONE shop only.
CREATE OR REPLACE FUNCTION public.admin_load_credits(_user_id uuid, _amount numeric, _reason text DEFAULT NULL::text, _reference text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text;
begin
  perform public.require_operational();
  perform public.assert_actor_active();
  select public.active_ecosystem(_user_id), p.full_name || ' — ' || p.email into _eco, _target
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _eco is null then raise exception 'Member not found'; end if;
  if not public.is_ecosystem_admin(auth.uid(), _eco) then
    raise exception 'Only the shop admin can load credits to shop members';
  end if;
  if _user_id = auth.uid() then raise exception 'Choose another member'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select id into _from from public.credit_accounts
   where user_id = auth.uid() and ecosystem_id is not distinct from _eco;
  select id into _to from public.credit_accounts
   where user_id = _user_id and ecosystem_id is not distinct from _eco;
  if _from is null or _to is null then raise exception 'Wallet not found in this shop'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _eco, 'debit', _amount, 0,
          coalesce(nullif(trim(_reason),''), 'Credit load to shop member'),
          nullif(trim(_reference),''), auth.uid(), _tx, _amount, 0, 0);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_to, _user_id, _eco, 'credit', _amount, 0,
          coalesce(nullif(trim(_reason),''), 'Credit load from shop admin'),
          nullif(trim(_reference),''), auth.uid(), _tx || '-R', _amount, 0, 0);

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Admin'), 'Loaded credits to shop member', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'tx_id', _tx, 'recipient_id', _user_id,
                             'ecosystem_id', _eco,
                             'reason', nullif(trim(_reason),''), 'reference', nullif(trim(_reference),'')));
  return _tx;
end; $function$;

-- 7. Platform credit issuance targets a chosen shop wallet.
DROP FUNCTION IF EXISTS public.superadmin_issue_credits(uuid, numeric, text, text, text, text);

CREATE OR REPLACE FUNCTION public.superadmin_issue_credits(
  _user_id uuid, _amount numeric, _reason text, _category text DEFAULT NULL::text,
  _reference text DEFAULT NULL::text, _request_key text DEFAULT NULL::text,
  _ecosystem_id uuid DEFAULT NULL::uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _eco uuid; _eco_name text; _acct uuid; _tx text; _key text;
  _actor text; _target text; _role app_role;
  _before numeric(14,2); _after numeric(14,2); _ledger uuid; _existing text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can issue credits';
  end if;
  if _amount is null or _amount <= 0 then
    raise exception 'Enter how many credits to issue';
  end if;
  if _amount <> trunc(_amount) then
    raise exception 'Credits must be a whole number';
  end if;
  if _amount > 10000000 then
    raise exception 'A single issuance is limited to 10,000,000 credits';
  end if;
  if coalesce(trim(_reason),'') = '' then
    raise exception 'A reason is required';
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);

  select tx_id into _existing from public.platform_credit_issuances where request_key = _key;
  if _existing is not null then
    return _existing;
  end if;

  select p.full_name || ' — ' || p.email into _target
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _target is null then raise exception 'Member not found'; end if;

  -- The platform owner keeps a single global wallet, never a shop wallet.
  if public.is_super_admin(_user_id) then
    _eco := null;
  else
    _eco := coalesce(_ecosystem_id, public.active_ecosystem(_user_id));
    if _eco is null then raise exception 'Choose the shop whose wallet receives the credits'; end if;
    if not exists (select 1 from public.ecosystem_memberships m
                    where m.user_id = _user_id and m.ecosystem_id = _eco
                      and m.membership_state = 'active') then
      raise exception 'That member is not an approved member of the selected shop';
    end if;
  end if;

  select name into _eco_name from public.ecosystems where id = _eco;
  _role := public.membership_role(_user_id, _eco);

  if _eco is null then
    _acct := public.ensure_global_wallet(_user_id);
  else
    _acct := public.ensure_credit_account(_user_id, _eco);
  end if;
  select balance into _before from public.credit_accounts where id = _acct;

  _tx := public.new_tx_id();

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, 'credit', _amount, 0, trim(_reason),
          nullif(trim(_reference),''), auth.uid(), _tx, 'superadmin_credit_issuance',
          _amount, 0, 0)
  returning id, balance_after into _ledger, _after;

  select full_name into _actor from public.profiles where id = auth.uid();

  insert into public.platform_credit_issuances (
    tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name,
    recipient_role, ecosystem_id, ecosystem_name, amount, balance_before, balance_after,
    reason, category, reference, ledger_id)
  values (_tx, _key, auth.uid(), coalesce(_actor,'Super Admin'), _user_id, _target,
          _role, _eco, _eco_name, _amount, _before, _after,
          trim(_reason), nullif(trim(_category),''), nullif(trim(_reference),''), _ledger);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Super Admin'),
          'Issued platform credits', _target,
          jsonb_build_object('amount', _amount, 'reason', trim(_reason),
                             'category', nullif(trim(_category),''), 'reference', nullif(trim(_reference),''),
                             'ecosystem_id', _eco, 'shop', _eco_name, 'recipient_id', _user_id,
                             'balance_before', _before, 'balance_after', _after,
                             'operator_id', auth.uid(), 'action_type', 'manual_credit',
                             'entry_kind', 'superadmin_credit_issuance', 'tx_id', _tx));
  return _tx;
end; $function$;

REVOKE ALL ON FUNCTION public.superadmin_issue_credits(uuid, numeric, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_issue_credits(uuid, numeric, text, text, text, text, uuid) TO authenticated;