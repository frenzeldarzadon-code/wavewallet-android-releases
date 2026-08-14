
-- 1. Fee setting
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS shop_transfer_fee_credits numeric(14,2) NOT NULL DEFAULT 5;

-- 2. Platform earnings record for transfer fees
CREATE TABLE IF NOT EXISTS public.shop_transfer_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id text NOT NULL,
  user_id uuid NOT NULL,
  from_ecosystem_id uuid REFERENCES public.ecosystems(id) ON DELETE SET NULL,
  to_ecosystem_id uuid REFERENCES public.ecosystems(id) ON DELETE SET NULL,
  gross_credits numeric(14,2) NOT NULL,
  fee_credits numeric(14,2) NOT NULL,
  net_credits numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shop_transfer_fees TO authenticated;
GRANT ALL ON public.shop_transfer_fees TO service_role;
ALTER TABLE public.shop_transfer_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner or platform can read transfer fees" ON public.shop_transfer_fees;
CREATE POLICY "Owner or platform can read transfer fees"
  ON public.shop_transfer_fees FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR user_id = auth.uid());

CREATE INDEX IF NOT EXISTS shop_transfer_fees_created_idx ON public.shop_transfer_fees (created_at DESC);

-- 3. Provenance: transferred credits earn no reseller/subreseller cashback,
--    and lots are consumed within the shop wallet they belong to.
CREATE OR REPLACE FUNCTION public.track_credit_lots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _kind text; _src uuid; _left numeric(14,2); _take numeric(14,2); _lot record;
  _nil uuid := '00000000-0000-0000-0000-000000000000';
begin
  if new.direction = 'credit' then
    _src := new.actor_id;
    if new.entry_kind = 'shop_transfer_in' then
      _kind := 'transfer'; _src := null;
    elsif new.entry_kind = 'transfer_reversal' then
      _kind := 'system'; _src := null;
    elsif new.entry_kind = 'sale_commission' or _src is null then
      _kind := 'system'; _src := null;
    elsif _src = new.user_id then
      _kind := 'self';
    elsif public.is_super_admin(_src) or public.is_ecosystem_admin(_src, new.ecosystem_id) then
      _kind := 'admin';
    elsif exists (select 1 from public.user_roles ur
                   where ur.user_id = _src and ur.role = 'reseller' and ur.ecosystem_id = new.ecosystem_id) then
      _kind := 'reseller';
    elsif exists (select 1 from public.user_roles ur
                   where ur.user_id = _src and ur.role = 'subreseller' and ur.ecosystem_id = new.ecosystem_id) then
      _kind := 'subreseller';
    else
      _kind := 'system'; _src := null;
    end if;

    insert into public.credit_lots (ecosystem_id, user_id, ledger_id, source_user_id, source_kind, amount, remaining)
    values (new.ecosystem_id, new.user_id, new.id, _src, _kind, new.amount, new.amount)
    on conflict (ledger_id) do nothing;
    return null;
  end if;

  if new.entry_kind = 'transfer_reversal' and new.reverses_ledger_id is not null then
    select id, remaining into _lot from public.credit_lots
     where ledger_id = new.reverses_ledger_id for update;
    if _lot.id is null then
      raise exception 'Original transfer credits can no longer be traced';
    end if;
    if _lot.remaining < new.amount then
      raise exception 'Cannot reverse automatically because some credits have already been spent or transferred.';
    end if;
    update public.credit_lots set remaining = remaining - new.amount where id = _lot.id;
    insert into public.credit_lot_consumptions (ecosystem_id, ledger_id, lot_id, user_id, amount)
    values (new.ecosystem_id, new.id, _lot.id, new.user_id, new.amount)
    on conflict (ledger_id, lot_id) do nothing;
    return null;
  end if;

  _left := new.amount;
  for _lot in
    select id, remaining from public.credit_lots
     where user_id = new.user_id
       and coalesce(ecosystem_id, _nil) = coalesce(new.ecosystem_id, _nil)
       and remaining > 0
     order by seq
     for update
  loop
    exit when _left <= 0;
    _take := least(_left, _lot.remaining);
    update public.credit_lots set remaining = remaining - _take where id = _lot.id;
    insert into public.credit_lot_consumptions (ecosystem_id, ledger_id, lot_id, user_id, amount)
    values (new.ecosystem_id, new.id, _lot.id, new.user_id, _take)
    on conflict (ledger_id, lot_id) do nothing;
    _left := _left - _take;
  end loop;
  return null;
end; $function$;

-- 4. Wallet resolution helper: the wallet of a person inside one shop.
CREATE OR REPLACE FUNCTION public.wallet_id_for(_user_id uuid, _ecosystem_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from public.credit_accounts
   where user_id = _user_id
     and (ecosystem_id = _ecosystem_id or ecosystem_id is null)
   order by (ecosystem_id is null)
   limit 1;
$function$;

-- 5. Global (Universe) wallet
CREATE OR REPLACE FUNCTION public.ensure_global_wallet(_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _id uuid;
begin
  insert into public.credit_accounts (user_id, ecosystem_id)
  values (_user_id, null)
  on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
  select id into _id from public.credit_accounts where user_id = _user_id and ecosystem_id is null;
  return _id;
end $function$;

-- 6. Balances of every shop wallet the caller owns, for the transfer screen.
CREATE OR REPLACE FUNCTION public.my_shop_wallets()
 RETURNS TABLE(ecosystem_id uuid, ecosystem_name text, balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id, e.name, coalesce(ca.balance, 0)
    from public.ecosystem_memberships m
    join public.ecosystems e on e.id = m.ecosystem_id
    left join public.credit_accounts ca
      on ca.user_id = m.user_id and ca.ecosystem_id = m.ecosystem_id
   where m.user_id = auth.uid()
     and m.membership_state = 'active'
     and m.status = 'active'
     and e.archived_at is null
   order by e.name;
$function$;

-- 7. Shop-to-shop transfer, routed through the caller's global wallet.
CREATE OR REPLACE FUNCTION public.transfer_credits_between_shops(
  _from_ecosystem_id uuid, _to_ecosystem_id uuid, _amount numeric, _note text DEFAULT NULL)
 RETURNS TABLE(tx_id text, fee_credits numeric, net_credits numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid();
  _fee numeric(14,2);
  _net numeric(14,2);
  _from uuid; _to uuid; _global uuid;
  _bal numeric(14,2);
  _tx text;
  _from_name text; _to_name text; _actor text;
begin
  if _uid is null then raise exception 'Not signed in'; end if;
  if public.acting_as() is not null then
    raise exception 'Cannot move credits between shops while acting as another member';
  end if;
  perform public.assert_actor_active();

  if _from_ecosystem_id is null or _to_ecosystem_id is null then
    raise exception 'Choose both a source and a destination shop';
  end if;
  if _from_ecosystem_id = _to_ecosystem_id then
    raise exception 'Choose two different shops';
  end if;

  select coalesce(shop_transfer_fee_credits, 5) into _fee from public.platform_settings where id = 1;
  _fee := coalesce(_fee, 5);

  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;
  if _amount <= _fee then
    raise exception 'Transfer at least % credits so the % credit fee leaves something to receive', _fee + 1, _fee;
  end if;
  _net := round(_amount - _fee, 2);

  -- Approved, active membership in BOTH shops is mandatory.
  if not exists (select 1 from public.ecosystem_memberships
                  where user_id = _uid and ecosystem_id = _from_ecosystem_id
                    and membership_state = 'active' and status = 'active') then
    raise exception 'You are not an approved member of the source shop';
  end if;
  if not exists (select 1 from public.ecosystem_memberships
                  where user_id = _uid and ecosystem_id = _to_ecosystem_id
                    and membership_state = 'active' and status = 'active') then
    raise exception 'You are not an approved member of the destination shop';
  end if;

  select name into _from_name from public.ecosystems
   where id = _from_ecosystem_id and archived_at is null
     and not coalesce(operations_frozen, false);
  if _from_name is null then raise exception 'The source shop is not available right now'; end if;
  select name into _to_name from public.ecosystems
   where id = _to_ecosystem_id and archived_at is null
     and not coalesce(operations_frozen, false);
  if _to_name is null then raise exception 'The destination shop is not available right now'; end if;

  perform public.ensure_membership_wallets(_uid, _from_ecosystem_id);
  perform public.ensure_membership_wallets(_uid, _to_ecosystem_id);
  _global := public.ensure_global_wallet(_uid);

  select id, balance into _from, _bal from public.credit_accounts
   where user_id = _uid and ecosystem_id = _from_ecosystem_id for update;
  select id into _to from public.credit_accounts
   where user_id = _uid and ecosystem_id = _to_ecosystem_id for update;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;
  if coalesce(_bal, 0) < _amount then
    raise exception 'Not enough credits in %', _from_name;
  end if;

  _tx := public.new_tx_id();

  -- Shop wallet -> global wallet
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_from, _uid, _from_ecosystem_id, 'debit', _amount, 0,
          'Shop transfer sent — to ' || _to_name, nullif(btrim(coalesce(_note,'')),''), _uid, _tx, 'shop_transfer_out');

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_global, _uid, null, 'credit', _amount, 0,
          'Shop transfer in transit — from ' || _from_name, nullif(btrim(coalesce(_note,'')),''), _uid, _tx || '-G', 'shop_transfer_in');

  -- Global wallet -> destination shop wallet, less the platform fee
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_global, _uid, null, 'debit', _amount, 0,
          'Shop transfer released — to ' || _to_name, nullif(btrim(coalesce(_note,'')),''), _uid, _tx || '-GO', 'shop_transfer_out');

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_to, _uid, _to_ecosystem_id, 'credit', _net, 0,
          'Shop transfer received — from ' || _from_name ||
            case when _fee > 0 then ' (fee ' || _fee::text || ' credits)' else '' end,
          nullif(btrim(coalesce(_note,'')),''), _uid, _tx || '-R', 'shop_transfer_in');

  if _fee > 0 then
    insert into public.shop_transfer_fees (tx_id, user_id, from_ecosystem_id, to_ecosystem_id,
                                           gross_credits, fee_credits, net_credits)
    values (_tx, _uid, _from_ecosystem_id, _to_ecosystem_id, _amount, _fee, _net);
  end if;

  select coalesce(full_name, email) into _actor from public.profiles where id = _uid;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_from_ecosystem_id, _uid, coalesce(_actor, 'Member'), 'Transferred credits between shops', _to_name,
          jsonb_build_object('amount', _amount, 'fee', _fee, 'net', _net,
                             'from_ecosystem_id', _from_ecosystem_id,
                             'to_ecosystem_id', _to_ecosystem_id, 'tx_id', _tx));
  perform public.log_operator_action(_uid, _from_ecosystem_id, 'Shop-to-shop credit transfer',
          'credit_transfer', _uid,
          jsonb_build_object('amount', _amount, 'fee', _fee, 'net', _net, 'to', _to_name, 'tx_id', _tx));

  return query select _tx, _fee, _net;
end $function$;

REVOKE ALL ON FUNCTION public.transfer_credits_between_shops(uuid, uuid, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.transfer_credits_between_shops(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_shop_wallets() TO authenticated;
