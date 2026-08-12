-- 1) Emergency freeze -------------------------------------------------------
ALTER TABLE public.ecosystems
  ADD COLUMN IF NOT EXISTS operations_frozen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS frozen_reason text,
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS frozen_by uuid;

CREATE OR REPLACE FUNCTION public.require_operational()
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _frozen boolean; _reason text;
begin
  if public.is_super_admin(auth.uid()) then return; end if;
  _eco := public.current_ecosystem(auth.uid());
  if not public.subscription_ok(_eco) then
    raise exception 'This shop is not active — the operator must renew the subscription before making changes';
  end if;
  select operations_frozen, frozen_reason into _frozen, _reason
    from public.ecosystems where id = _eco;
  if coalesce(_frozen, false) then
    raise exception 'This shop is temporarily frozen by the platform owner%',
      coalesce(' — ' || nullif(trim(_reason), ''), '');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_ecosystem_freeze(_ecosystem_id uuid, _frozen boolean, _reason text DEFAULT NULL)
RETURNS public.ecosystems
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _row public.ecosystems; _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can freeze a shop';
  end if;
  if _frozen and coalesce(trim(_reason), '') = '' then
    raise exception 'A reason is required when freezing a shop';
  end if;

  update public.ecosystems
     set operations_frozen = _frozen,
         frozen_reason = case when _frozen then trim(_reason) else null end,
         frozen_at = case when _frozen then now() else null end,
         frozen_by = case when _frozen then auth.uid() else null end,
         updated_at = now()
   where id = _ecosystem_id
  returning * into _row;
  if _row.id is null then raise exception 'Shop not found'; end if;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Platform owner'),
          case when _frozen then 'Froze shop operations' else 'Unfroze shop operations' end,
          _row.name, jsonb_build_object('reason', _reason));

  return _row;
end;
$function$;

REVOKE ALL ON FUNCTION public.set_ecosystem_freeze(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ecosystem_freeze(uuid, boolean, text) TO authenticated;

-- 2) Refund / reversal workflow ---------------------------------------------
ALTER TABLE public.voucher_codes DROP CONSTRAINT IF EXISTS voucher_codes_status_check;
ALTER TABLE public.voucher_codes ADD CONSTRAINT voucher_codes_status_check
  CHECK (status = ANY (ARRAY['unused'::text, 'sold'::text, 'void'::text]));

ALTER TABLE public.voucher_sales
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refund_tx text;

CREATE OR REPLACE FUNCTION public.refund_voucher_sale(_sale_id uuid, _reason text)
RETURNS TABLE(tx_id text, credits_refunded numeric, points_refunded integer,
              points_reversed integer, commission_reversed numeric, codes_voided integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _s public.voucher_sales;
  _tx text;
  _acct uuid;
  _pacct uuid;
  _actor text;
  _rec record;
  _credits numeric(14,2) := 0;
  _points_back integer := 0;
  _points_rev integer := 0;
  _comm numeric(14,2) := 0;
  _codes integer := 0;
  _orig public.points_ledger;
begin
  perform public.require_operational();

  select * into _s from public.voucher_sales where id = _sale_id for update;
  if _s.id is null then raise exception 'Sale not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _s.ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this shop';
  end if;
  if _s.refunded_at is not null then raise exception 'This sale was already refunded'; end if;
  if coalesce(trim(_reason), '') = '' then raise exception 'A reason is required'; end if;

  _tx := public.new_tx_id();

  -- a) return what the buyer paid (credits or points), as a new ledger entry
  if _s.points_spent > 0 then
    select id into _pacct from public.points_accounts where user_id = _s.buyer_id;
    if _pacct is null then raise exception 'Buyer points wallet not found'; end if;
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_type, sale_id)
    values (_pacct, _s.buyer_id, _s.ecosystem_id, 'credit', _s.points_spent, 0,
            'Voucher sale refunded — ' || trim(_reason), _s.tx_id, auth.uid(), _tx, 'adjust', _sale_id);
    _points_back := _s.points_spent;
  end if;

  if _s.sale_price > 0 then
    select id into _acct from public.credit_accounts where user_id = _s.buyer_id;
    if _acct is null then raise exception 'Buyer credit wallet not found'; end if;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind)
    values (_acct, _s.buyer_id, _s.ecosystem_id, 'credit', _s.sale_price, 0,
            'Voucher sale refunded — ' || trim(_reason), _s.tx_id, auth.uid(), _tx, _sale_id, 'refund');
    _credits := _s.sale_price;
  end if;

  -- b) claw back credit-back paid out on this sale
  for _rec in
    select recipient_id, sum(commission_amount) as amount
      from public.sale_commissions
     where sale_id = _sale_id and reversed_at is null
     group by recipient_id
  loop
    select id into _acct from public.credit_accounts where user_id = _rec.recipient_id;
    continue when _acct is null;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind)
    values (_acct, _rec.recipient_id, _s.ecosystem_id, 'debit', _rec.amount, 0,
            'Credit-back reversed — sale refunded', _tx, auth.uid(), _tx, _sale_id,
            'sale_commission_reversal');
    _comm := _comm + _rec.amount;
  end loop;
  update public.sale_commissions set reversed_at = now()
   where sale_id = _sale_id and reversed_at is null;

  -- c) remove points the buyer earned on this sale (once)
  select * into _orig from public.points_ledger
   where sale_id = _sale_id and entry_type = 'earn' limit 1;
  if _orig.id is not null and not exists (
      select 1 from public.points_ledger
       where sale_id = _sale_id and entry_type = 'adjust' and direction = 'debit') then
    select id into _pacct from public.points_accounts where user_id = _orig.user_id;
    if _pacct is not null then
      insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                        reason, reference, actor_id, tx_id, entry_type, sale_id,
                                        credits_basis, credits_per_point_used, points_rule_version)
      values (_pacct, _orig.user_id, _orig.ecosystem_id, 'debit', _orig.amount, 0,
              'Points reversed — sale refunded', _orig.tx_id, auth.uid(), _tx, 'adjust', _sale_id,
              _orig.credits_basis, _orig.credits_per_point_used, _orig.points_rule_version);
      _points_rev := _orig.amount;
    end if;
  end if;

  -- d) void the released codes so they can never be sold again
  update public.voucher_codes set status = 'void'
   where sale_id = _sale_id and status = 'sold';
  get diagnostics _codes = row_count;

  -- e) mark the sale refunded; the original row is never edited otherwise
  update public.voucher_sales
     set refunded_at = now(), refund_reason = trim(_reason), refund_tx = _tx
   where id = _sale_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_s.ecosystem_id, auth.uid(), coalesce(_actor, 'Admin'), 'Refunded voucher sale',
          _s.product_name || ' — ' || _s.tx_id,
          jsonb_build_object('sale_id', _sale_id, 'tx_id', _tx, 'reason', trim(_reason),
                             'credits_refunded', _credits, 'points_refunded', _points_back,
                             'points_reversed', _points_rev, 'commission_reversed', _comm,
                             'codes_voided', _codes));

  return query select _tx, _credits, _points_back, _points_rev, _comm, _codes;
end;
$function$;

REVOKE ALL ON FUNCTION public.refund_voucher_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_voucher_sale(uuid, text) TO authenticated;