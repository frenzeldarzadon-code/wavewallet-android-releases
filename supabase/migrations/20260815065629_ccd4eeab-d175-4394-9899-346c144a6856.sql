-- Global (not per-shop) manual credit authorization.
-- Super Admin is a platform mint authority in EVERY shop: no source balance,
-- no shop wallet, no fee. Everyone else keeps their existing limits.

DROP FUNCTION IF EXISTS public.admin_load_credits(uuid, numeric, text, text);
DROP FUNCTION IF EXISTS public.admin_adjust_credits(uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION public.resolve_member_shop(_user_id uuid, _ecosystem_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare _eco uuid;
begin
  _eco := coalesce(_ecosystem_id, public.active_ecosystem(_user_id));
  if _eco is null then
    raise exception 'Choose the shop whose wallet this affects';
  end if;
  if not exists (select 1 from public.ecosystem_memberships m
                  where m.user_id = _user_id and m.ecosystem_id = _eco
                    and m.membership_state = 'active') then
    raise exception 'That member is not an approved member of the selected shop';
  end if;
  return _eco;
end $$;

CREATE OR REPLACE FUNCTION public.admin_load_credits(
  _user_id uuid, _amount numeric, _reason text DEFAULT NULL::text,
  _reference text DEFAULT NULL::text, _ecosystem_id uuid DEFAULT NULL::uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare _eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text;
begin
  perform public.require_operational();
  perform public.assert_actor_active();

  select p.full_name || ' — ' || p.email into _target
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _target is null then raise exception 'Member not found'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  _eco := public.resolve_member_shop(_user_id, _ecosystem_id);

  -- Platform exception: the owner mints credits straight into the member's
  -- wallet in the selected shop. No source wallet, no balance, no fee.
  if public.is_super_admin(auth.uid()) then
    return public.superadmin_issue_credits(
      _user_id, _amount,
      coalesce(nullif(trim(_reason),''), 'Super Admin Credit Issuance'),
      'Manual credit', nullif(trim(_reference),''), null, _eco);
  end if;

  if not public.is_ecosystem_admin(auth.uid(), _eco) then
    raise exception 'Only the shop admin can load credits to shop members';
  end if;
  if _user_id = auth.uid() then raise exception 'Choose another member'; end if;

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
end $$;

CREATE OR REPLACE FUNCTION public.admin_adjust_credits(
  _user_id uuid, _amount numeric, _reason text,
  _reference text DEFAULT NULL::text, _ecosystem_id uuid DEFAULT NULL::uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare _eco uuid; _acct uuid; _tx text; _actor text; _target text; _dir text;
        _before numeric(14,2); _after numeric(14,2); _super boolean;
begin
  perform public.require_operational();
  _super := public.is_super_admin(auth.uid());

  select p.full_name || ' — ' || p.email into _target
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _target is null then raise exception 'Member not found'; end if;
  if _amount is null or _amount = 0 then raise exception 'Enter an amount'; end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;

  _eco := public.resolve_member_shop(_user_id, _ecosystem_id);

  if not (_super or public.is_ecosystem_admin(auth.uid(), _eco)) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _amount > 0 and not _super then
    raise exception 'Only the platform owner can create credits. Buy platform credits, then load them from your own wallet.';
  end if;

  -- Adding credits always goes through the single platform issuance path.
  if _amount > 0 then
    return public.superadmin_issue_credits(
      _user_id, _amount, trim(_reason), 'Manual credit',
      nullif(trim(_reference),''), null, _eco);
  end if;

  _acct := public.ensure_credit_account(_user_id, _eco);
  if _acct is null then raise exception 'This member has no credit wallet in this shop yet'; end if;
  select balance into _before from public.credit_accounts where id = _acct;

  _tx := public.new_tx_id();
  _dir := 'debit';

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, _dir, abs(_amount), 0, trim(_reason),
          nullif(trim(_reference),''), auth.uid(), _tx, 'credit_revocation',
          abs(_amount), 0, 0)
  returning balance_after into _after;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'), 'Deducted credits', coalesce(_target,''),
          jsonb_build_object('amount', abs(_amount), 'reason', trim(_reason), 'reference', _reference,
                             'ecosystem_id', _eco, 'recipient_id', _user_id,
                             'balance_before', _before, 'balance_after', _after,
                             'operator_id', auth.uid(), 'action_type', 'adjustment',
                             'commission_percent', 0, 'commission_amount', 0,
                             'total_received', abs(_amount), 'tx_id', _tx));
  return _tx;
end $$;

REVOKE ALL ON FUNCTION public.resolve_member_shop(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_load_credits(uuid, numeric, text, text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_adjust_credits(uuid, numeric, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_member_shop(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_load_credits(uuid, numeric, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, numeric, text, text, uuid) TO authenticated, service_role;