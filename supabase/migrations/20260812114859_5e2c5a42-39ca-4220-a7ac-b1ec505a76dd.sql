CREATE OR REPLACE FUNCTION public.assert_actor_active()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare _s public.account_status;
begin
  if public.is_super_admin(auth.uid()) then return; end if;
  select status into _s from public.profiles where id = auth.uid();
  if _s is null then raise exception 'Your account was not found'; end if;
  if _s <> 'active' then raise exception 'Your account is suspended'; end if;
end;
$$;

REVOKE ALL ON FUNCTION public.assert_actor_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_actor_active() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transfer_credits(_recipient_id uuid, _amount numeric, _note text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _my_eco uuid; _eco uuid; _from uuid; _to uuid; _tx text;
  _status public.account_status;
  _pct integer := 0; _bonus numeric(14,2) := 0; _total numeric(14,2);
  _actor_name text; _target text; _priv boolean;
begin
  perform public.require_operational();
  perform public.assert_actor_active();
  select ecosystem_id into _my_eco from public.profiles where id = auth.uid();
  select ecosystem_id, status, full_name || ' — ' || email
    into _eco, _status, _target
  from public.profiles where id = _recipient_id;

  if _eco is null then raise exception 'Recipient not found'; end if;
  _priv := public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _eco);
  if public.is_super_admin(auth.uid()) then
    _my_eco := coalesce(_my_eco, _eco);
  end if;
  if _my_eco is null or _eco is distinct from _my_eco then
    raise exception 'Transfers are only allowed inside your own shop';
  end if;
  if _recipient_id = auth.uid() then raise exception 'You cannot send credits to yourself'; end if;
  if _status <> 'active' then raise exception 'That account is suspended'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  if not _priv then
    if public.has_role(auth.uid(), 'reseller') or public.has_role(auth.uid(), 'subreseller') then
      if not public.can_load_credits(auth.uid(), _recipient_id) then
        raise exception 'You can only send credits to customers in your shop and to your own subresellers';
      end if;
    else
      if public.is_super_admin(_recipient_id)
         or public.is_ecosystem_admin(_recipient_id, _eco)
         or public.has_role(_recipient_id, 'reseller')
         or public.has_role(_recipient_id, 'subreseller') then
        raise exception 'Credits can only be sent to fellow customers';
      end if;
    end if;
  end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _recipient_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _pct := public.commission_rate_for(auth.uid(), _recipient_id);
  _bonus := round(_amount * _pct / 100.0, 2);
  _total := _amount + _bonus;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _my_eco, 'debit', _amount, 0,
          case when _bonus > 0 then 'Credit released to reseller' else 'Credit transfer sent' end,
          nullif(trim(_note),''), auth.uid(), _tx, _amount, _pct, _bonus);

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_to, _recipient_id, _my_eco, 'credit', _total, 0,
          case when _bonus > 0 then 'Credit released with commission' else 'Credit transfer received' end,
          nullif(trim(_note),''), auth.uid(), _tx || '-R', _amount, _pct, _bonus);

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_my_eco, auth.uid(), coalesce(_actor_name,'Member'), 'Transferred credits', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'commission_percent', _pct,
                             'commission_amount', _bonus, 'total_received', _total, 'tx_id', _tx));
  return _tx;
end;
$$;

CREATE OR REPLACE FUNCTION public.reseller_load_credits(_customer_id uuid, _amount numeric, _reference text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare _eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text; _my_role text;
begin
  perform public.require_operational();
  perform public.assert_actor_active();
  if public.has_role(auth.uid(), 'reseller') then _my_role := 'reseller';
  elsif public.has_role(auth.uid(), 'subreseller') then _my_role := 'subreseller';
  else raise exception 'Only resellers can load credits';
  end if;

  select ecosystem_id, full_name || ' — ' || email into _eco, _target
    from public.profiles where id = _customer_id;
  if _eco is null then raise exception 'That member is not in your shop'; end if;
  if _customer_id = auth.uid() then raise exception 'Choose another member'; end if;

  if not public.can_load_credits(auth.uid(), _customer_id) then
    raise exception 'You can load credits to customers in your shop and to your own subresellers only';
  end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _customer_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _eco, 'debit', _amount, 0, 'Credit load to customer', nullif(trim(_reference),''), auth.uid(), _tx, _amount, 0, 0);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_to, _customer_id, _eco, 'credit', _amount, 0, 'Credit load from ' || _my_role, nullif(trim(_reference),''), auth.uid(), _tx || '-R', _amount, 0, 0);

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Reseller'), 'Loaded credits to shop member', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'tx_id', _tx, 'actor_role', _my_role,
                             'recipient_id', _customer_id,
                             'recipient_is_own_subreseller',
                               exists (select 1 from public.profiles p where p.id = _customer_id and p.reseller_id = auth.uid()),
                             'loading_commission_percent', 0));
  return _tx;
end;
$$;

REVOKE ALL ON FUNCTION public.transfer_credits(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_credits(uuid, numeric, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reseller_load_credits(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reseller_load_credits(uuid, numeric, text) TO authenticated, service_role;