CREATE OR REPLACE FUNCTION public.refund_voucher_sale(_sale_id uuid, _reason text)
RETURNS TABLE(tx_id text, credits_refunded numeric, points_refunded integer,
              points_reversed integer, commission_reversed numeric, codes_voided integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _s public.voucher_sales;
  _ref text;
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

  -- shared reference that ties every reversal entry of this refund together;
  -- each ledger row still gets its own globally unique transaction id.
  _ref := public.new_tx_id();

  if _s.points_spent > 0 then
    select id into _pacct from public.points_accounts where user_id = _s.buyer_id;
    if _pacct is null then raise exception 'Buyer points wallet not found'; end if;
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_type, sale_id)
    values (_pacct, _s.buyer_id, _s.ecosystem_id, 'credit', _s.points_spent, 0,
            'Voucher sale refunded — ' || trim(_reason), _ref, auth.uid(),
            public.new_tx_id(), 'adjust', _sale_id);
    _points_back := _s.points_spent;
  end if;

  if _s.sale_price > 0 then
    select id into _acct from public.credit_accounts where user_id = _s.buyer_id;
    if _acct is null then raise exception 'Buyer credit wallet not found'; end if;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind)
    values (_acct, _s.buyer_id, _s.ecosystem_id, 'credit', _s.sale_price, 0,
            'Voucher sale refunded — ' || trim(_reason), _ref, auth.uid(),
            public.new_tx_id(), _sale_id, 'refund');
    _credits := _s.sale_price;
  end if;

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
            'Credit-back reversed — sale refunded', _ref, auth.uid(),
            public.new_tx_id(), _sale_id, 'sale_commission_reversal');
    _comm := _comm + _rec.amount;
  end loop;
  update public.sale_commissions set reversed_at = now()
   where sale_id = _sale_id and reversed_at is null;

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
              'Points reversed — sale refunded', _ref, auth.uid(),
              public.new_tx_id(), 'adjust', _sale_id,
              _orig.credits_basis, _orig.credits_per_point_used, _orig.points_rule_version);
      _points_rev := _orig.amount;
    end if;
  end if;

  update public.voucher_codes set status = 'void'
   where sale_id = _sale_id and status = 'sold';
  get diagnostics _codes = row_count;

  update public.voucher_sales
     set refunded_at = now(), refund_reason = trim(_reason), refund_tx = _ref
   where id = _sale_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_s.ecosystem_id, auth.uid(), coalesce(_actor, 'Admin'), 'Refunded voucher sale',
          _s.product_name || ' — ' || _s.tx_id,
          jsonb_build_object('sale_id', _sale_id, 'refund_ref', _ref, 'reason', trim(_reason),
                             'credits_refunded', _credits, 'points_refunded', _points_back,
                             'points_reversed', _points_rev, 'commission_reversed', _comm,
                             'codes_voided', _codes));

  return query select _ref, _credits, _points_back, _points_rev, _comm, _codes;
end;
$function$;

REVOKE ALL ON FUNCTION public.refund_voucher_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_voucher_sale(uuid, text) TO authenticated;