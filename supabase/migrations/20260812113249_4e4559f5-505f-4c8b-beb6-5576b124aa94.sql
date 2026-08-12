-- Fix: seller/customer roles must never be able to push credits "upward"
-- to an ecosystem admin or the platform owner.

CREATE OR REPLACE FUNCTION public.can_load_credits(_actor uuid, _target uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _t_eco uuid; _t_parent uuid; _t_status public.account_status; _a_eco uuid;
        _t_is_reseller boolean; _t_is_sub boolean;
begin
  if _actor is null or _target is null or _actor = _target then return false; end if;
  select ecosystem_id, reseller_id, status into _t_eco, _t_parent, _t_status
    from public.profiles where id = _target;
  if _t_eco is null or _t_status <> 'active' then return false; end if;

  if public.is_super_admin(_actor) then return true; end if;
  if public.is_ecosystem_admin(_actor, _t_eco) then return true; end if;

  select ecosystem_id into _a_eco from public.profiles where id = _actor;
  if _a_eco is null or _a_eco is distinct from _t_eco then return false; end if;

  -- Never allow crediting upward: admins / platform owners are not valid recipients
  -- for reseller, subreseller or customer initiated loads.
  if public.is_super_admin(_target) or public.is_ecosystem_admin(_target, _t_eco) then
    return false;
  end if;

  _t_is_reseller := public.has_role(_target, 'reseller');
  _t_is_sub := public.has_role(_target, 'subreseller');

  -- Resellers: any customer in the same shop, plus their OWN subresellers only.
  if public.has_role(_actor, 'reseller') then
    if _t_is_reseller then return false; end if;
    if _t_is_sub then return _t_parent = _actor; end if;
    return true; -- customer in the same ecosystem
  end if;

  -- Subresellers: customers in the same shop only; never resellers/subresellers.
  if public.has_role(_actor, 'subreseller') then
    return not _t_is_reseller and not _t_is_sub;
  end if;

  return false;
end; $function$;

CREATE OR REPLACE FUNCTION public.transfer_credits(_recipient_id uuid, _amount numeric, _note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _my_eco uuid; _eco uuid; _from uuid; _to uuid; _tx text;
  _status public.account_status;
  _pct integer := 0; _bonus numeric(14,2) := 0; _total numeric(14,2);
  _actor_name text; _target text; _priv boolean;
begin
  perform public.require_operational();
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
      -- Customers: fellow customers only. Never sellers, admins or the platform owner.
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

  -- Credit-LOADING commission: resellers only, released by admin/platform owner.
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
          case when _bonus > 0 then 'Credit received with commission' else 'Credit transfer received' end,
          nullif(trim(_note),''), auth.uid(), _tx || '-R', _amount, _pct, _bonus);

  if _bonus > 0 then
    select full_name into _actor_name from public.profiles where id = auth.uid();
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_my_eco, auth.uid(), coalesce(_actor_name,'Admin'), 'Released credits to reseller',
            coalesce(_target,''),
            jsonb_build_object('base_amount', _amount, 'commission_kind','credit_loading',
                               'commission_percent', _pct,
                               'commission_amount', _bonus, 'total_received', _total, 'tx_id', _tx));
  end if;

  return _tx;
end; $function$;