-- Regression test: purchase_voucher must not fail with
--   ERROR: column reference "sale_id" is ambiguous
-- The function's RETURNS TABLE column `sale_id` collided with the unqualified
-- `sale_id` used in an ON CONFLICT inference clause on public.sale_commissions.
--
-- The test drives a real customer purchase (credits path) inside a
-- subtransaction and rolls everything back, asserting:
--   * the RPC succeeds and returns exactly one voucher code
--   * credits are debited at face value, points earned at the ecosystem ratio
--   * the voucher code is marked sold and tied to the sale (atomic, no orphan)
--
-- Run as a superuser/postgres session:  psql -f this-file.sql

DO $$
declare
  _eco uuid; _cust uuid; _prod uuid; _price numeric; _ratio numeric;
  _bal_before numeric; _pts_before integer;
  _bal_after numeric; _pts_after integer;
  _r record; _sold int; _summary text;
begin
  begin
    -- Arrange: an ecosystem with an active credit-priced product and stock.
    select vp.ecosystem_id, vp.id, coalesce(vp.promo_price, vp.credit_price)
      into _eco, _prod, _price
      from public.voucher_products vp
     where vp.active and not vp.archived
       and exists (select 1 from public.voucher_codes vc
                    where vc.product_id = vp.id and vc.status = 'unused')
     limit 1;
    if _prod is null then raise exception 'no product with stock to test'; end if;

    select e.credits_per_point into _ratio from public.ecosystems e where e.id = _eco;

    -- A customer in that ecosystem, funded enough to buy one voucher.
    select p.id into _cust
      from public.profiles p
      join public.credit_accounts ca on ca.user_id = p.id
     where p.ecosystem_id = _eco and p.status = 'active'
       and ca.balance >= _price
       and not exists (select 1 from public.user_roles ur
                        where ur.user_id = p.id and ur.role <> 'customer')
     limit 1;
    if _cust is null then raise exception 'no funded customer to test'; end if;

    select balance into _bal_before from public.credit_accounts where user_id = _cust;
    select balance into _pts_before from public.points_accounts where user_id = _cust;

    perform set_config('request.jwt.claims',
      json_build_object('sub', _cust::text, 'role', 'authenticated')::text, true);

    -- Act: this is the exact call that used to raise 42702 "sale_id is ambiguous".
    select * into _r from public.purchase_voucher(_prod, 1);

    -- Assert
    if _r.sale_id is null then raise exception 'no sale row returned'; end if;
    if coalesce(array_length(_r.codes, 1), 0) <> 1 then
      raise exception 'expected 1 code, got %', coalesce(array_length(_r.codes,1),0);
    end if;
    if _r.sale_price <> _price then
      raise exception 'expected face value %, got %', _price, _r.sale_price;
    end if;

    select balance into _bal_after from public.credit_accounts where user_id = _cust;
    select balance into _pts_after from public.points_accounts where user_id = _cust;

    if _bal_after <> _bal_before - _price then
      raise exception 'balance % expected %', _bal_after, _bal_before - _price;
    end if;
    if _ratio > 0 and _pts_after <> _pts_before + floor(_price / _ratio)::int then
      raise exception 'points % expected %', _pts_after, _pts_before + floor(_price/_ratio)::int;
    end if;

    select count(*) into _sold from public.voucher_codes vc
     where vc.sale_id = _r.sale_id and vc.status = 'sold'
       and vc.sold_to = _cust and vc.sold_at is not null;
    if _sold <> 1 then raise exception 'expected 1 sold code linked to sale, got %', _sold; end if;

    _summary := format('OK: tx=%s price=%s points=+%s code=%s',
                       _r.tx_id, _r.sale_price, _pts_after - _pts_before, _r.codes[1]);

    raise exception 'ROLLBACK_TEST';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST' then
      raise exception 'purchase_voucher regression FAILED: %', sqlerrm;
    end if;
  end;

  raise notice '%', coalesce(_summary, 'no summary');
  raise notice 'purchase_voucher sale_id-ambiguity regression PASSED (rolled back)';
end $$;
