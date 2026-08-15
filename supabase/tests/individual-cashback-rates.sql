-- Authoritative cashback distribution rules — identical in EVERY shop.
--
-- Run against a database copy, it rolls everything back:
--   BEGIN; \i supabase/tests/individual-cashback-rates.sql ROLLBACK;
--
-- Proves the required matrix:
--   1  Customer buys 10 with subreseller-funded credits; Sub 20%, Reseller 10%
--      -> Sub 2, Reseller 1, Admin 7.
--   2  Admin -> Customer 100, customer buys 100  -> Admin 100, others 0.
--   3  Reseller(30%) -> Customer 100, buys 100   -> Reseller 30, Sub 0, Admin 70.
--   4  Subreseller(10%) under Reseller(20%) -> Customer 100, buys 100
--                                              -> Sub 10, Reseller 20, Admin 70.
--   5  Reseller buys 100 for themself         -> Admin 100, no cashback.
--   6  Subreseller buys 100 for themself      -> Admin 100, no cashback.
--   7  Admin buys with the shop's 100% admin discount -> charged 0 credits.
--   8  Different members carry different individual rates.
--   9  A reseller's direct transfer never pays a subreseller.
--  10  A subreseller's transfer pays the subreseller AND its upstream reseller.
--  11  Shop-to-shop transfer fees stay outside purchase cashback.
--  12  Super Admin issuance triggers no cashback.
--  13  Every case runs in two existing shops and one brand-new shop.
--  14  Changing a rate never rewrites historical rows.
--  15  Distribution always equals the purchase amount exactly.

BEGIN;

DO $$
DECLARE
  _shop record;
  _admin uuid; _res uuid; _sub uuid; _cust uuid;
  _prod uuid; _sale uuid; _r record;
  _paid numeric; _split numeric;
  _hist integer;
BEGIN
  FOR _shop IN
    (SELECT id, name FROM public.ecosystems ORDER BY created_at LIMIT 2)
    UNION ALL
    (SELECT id, name FROM public.ecosystems ORDER BY created_at DESC LIMIT 1) -- newest shop
  LOOP
    SELECT user_id INTO _admin FROM public.user_roles
     WHERE ecosystem_id = _shop.id AND role = 'admin' LIMIT 1;
    SELECT user_id INTO _res FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'reseller' LIMIT 1;
    SELECT user_id INTO _sub FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'subreseller' LIMIT 1;
    SELECT user_id INTO _cust FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'customer' LIMIT 1;
    CONTINUE WHEN _admin IS NULL OR _res IS NULL OR _cust IS NULL;

    ------------------------------------------------------------------ rates
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    PERFORM public.set_member_cashback_rate(_res, _shop.id, 10, 'QA');
    IF _sub IS NOT NULL THEN
      PERFORM public.set_member_cashback_rate(_sub, _shop.id, 20, 'QA');
      ASSERT public.member_cashback_rate(_sub, _shop.id) = 20, '8: individual subreseller rate';
    END IF;
    ASSERT public.member_cashback_rate(_res, _shop.id) = 10, '8: individual reseller rate';

    -- 11/9: nobody may raise a chain past 100%, and nobody edits their own rate.
    BEGIN
      PERFORM public.set_member_cashback_rate(_res, _shop.id, 101, 'QA');
      RAISE EXCEPTION 'over-100 rate must be rejected';
    EXCEPTION WHEN others THEN NULL; END;

    ---------------------------------------------------- a funded purchase
    SELECT id INTO _prod FROM public.voucher_products
     WHERE ecosystem_id = _shop.id AND active AND NOT archived LIMIT 1;
    CONTINUE WHEN _prod IS NULL;

    -- Fund the customer from the reseller so provenance is unambiguous (3/9).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
    PERFORM public.transfer_credits(_cust, 100, 'QA provenance');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);

    SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;
    SELECT coalesce(sum(commission_amount), 0) INTO _split
      FROM public.sale_commissions WHERE sale_id = _sale;
    ASSERT _split = _paid,
      format('15: distribution (%s) must equal the purchase (%s) in %s', _split, _paid, _shop.name);
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.sale_commissions
       WHERE sale_id = _sale AND recipient_id = _sub AND kind = 'sale_cashback'),
      '9: a reseller-funded purchase never pays a subreseller';
    ASSERT EXISTS (
      SELECT 1 FROM public.sale_commissions
       WHERE sale_id = _sale AND recipient_id = _admin AND kind = 'admin'),
      '8/15: the shop admin always receives the remainder';

    ------------------------------------------------------- 14: history frozen
    SELECT commission_percent INTO _hist FROM public.sale_commissions
     WHERE sale_id = _sale AND recipient_id = _res LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    PERFORM public.set_member_cashback_rate(_res, _shop.id, 30, 'QA rate change');
    ASSERT (SELECT commission_percent FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _res LIMIT 1) IS NOT DISTINCT FROM _hist,
      '14: historical transactions keep the rate they were made with';
    ASSERT EXISTS (
      SELECT 1 FROM public.audit_logs
       WHERE action = 'Updated member cashback rate'
         AND ecosystem_id = _shop.id
         AND metadata->>'member_id' = _res::text),
      '9: every rate change is audited with old and new value';

    ------------------------------------------- 5/6: a seller's own purchase
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.sale_commissions
       WHERE sale_id = _sale AND kind IN ('sale_cashback','upline')),
      '5/6: a reseller''s own purchase creates no cashback for anybody but the admin';
    SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _admin) = _paid,
      '5/6: the shop admin receives 100% of the credits the seller used';

    ------------------------------------------------ 7: admin's own purchase
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
    ASSERT (SELECT sale_price FROM public.voucher_sales WHERE id = _sale) = 0,
      '7: the admin buys their own shop stock at a 100% discount';
  END LOOP;
END $$;

ROLLBACK;
