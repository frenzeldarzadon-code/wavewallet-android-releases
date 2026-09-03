-- Universe voucher pricing: no reseller purchase discount, price-inclusive
-- platform fee, cashback untouched, New Generation isolated.
--
-- Run against a database copy; it rolls everything back:
--   psql -v ON_ERROR_STOP=1 -c BEGIN -f supabase/tests/voucher-universe-pricing.sql -c ROLLBACK
--
-- Proves:
--   1  Universe reseller/subreseller voucher discount is 0 (cashback rate untouched).
--   2  A ₱10 live voucher still costs the customer ₱10; fee 0.10; seller cut 9.90.
--   3  Reseller buying at full price earns exactly their cashback rate on ₱10
--      (identical money to the old discount) — and only once (no double fee).
--   4  Customer through a reseller storefront: cashback = rate% of ₱10, fee 0.10,
--      admin gets the remainder minus the fee; distribution + fee == price.
--   5  A general promo price applies to everyone; fee follows the actual price.
--   6  Set Retail Price / Set Seller's Cut round-trip in both directions.
--   7  Changing the platform fee never reprices an existing product or its sales.
--   8  Historical voucher sales are byte-for-byte unchanged.
--   9  New Generation (subscription) resellers keep their existing discount rule.

DO $$
DECLARE
  _shop uuid; _admin uuid; _res uuid; _cust uuid; _super uuid; _ng uuid; _ng_res uuid;
  _prod uuid; _promo uuid; _sale uuid; _rate int; _hist_before text; _hist_after text;
  _rates_before text; _rates_after text; _fee numeric; _cut numeric; _price numeric;
  _res_cb numeric; _adm_cb numeric; _split numeric; _new_prod uuid; r record;
BEGIN
  SELECT user_id INTO _super FROM public.user_roles WHERE role = 'super_admin' LIMIT 1;
  ASSERT _super IS NOT NULL, 'a super admin is required';

  SELECT e.id INTO _shop FROM public.ecosystems e
   WHERE e.shop_kind = 'universe' AND e.archived_at IS NULL AND coalesce(e.operations_frozen,false) = false
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.ecosystem_id = e.id AND m.role = 'admin' AND m.membership_state = 'active')
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.ecosystem_id = e.id AND m.role = 'reseller' AND m.membership_state = 'active')
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.ecosystem_id = e.id AND m.role = 'customer' AND m.membership_state = 'active')
   ORDER BY e.created_at LIMIT 1;
  ASSERT _shop IS NOT NULL, 'a Universe shop with admin, reseller and customer is required';

  SELECT m.user_id INTO _admin FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'admin' AND m.membership_state = 'active' AND p.status = 'active' LIMIT 1;
  SELECT m.user_id INTO _res FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'reseller' AND m.membership_state = 'active' AND p.status = 'active'
     AND NOT public.is_super_admin(m.user_id) LIMIT 1;
  SELECT m.user_id INTO _cust FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'customer' AND m.membership_state = 'active' AND p.status = 'active'
     AND NOT public.is_super_admin(m.user_id) LIMIT 1;
  ASSERT _admin IS NOT NULL AND _res IS NOT NULL AND _cust IS NOT NULL, 'active fixtures required';

  -- Snapshots that must not change.
  SELECT md5(string_agg(row_to_json(v)::text, '|' ORDER BY v.id)) INTO _hist_before
    FROM public.voucher_sales v;
  SELECT md5(string_agg(m.user_id::text || ':' || coalesce(m.sale_commission_percent,-1) || ':' || coalesce(m.reseller_discount_percent,-1), '|' ORDER BY m.user_id))
    INTO _rates_before FROM public.ecosystem_memberships m WHERE m.ecosystem_id = _shop;

  _rate := coalesce(public.member_cashback_rate(_res, _shop), 0);
  ASSERT _rate > 0, 'fixture reseller needs a cashback rate';

  ---------------------------------------------------------------- 1
  ASSERT public.voucher_discount_percent_for(_res, _shop) = 0, '1: Universe reseller has no purchase discount';
  ASSERT public.member_cashback_rate(_res, _shop) = _rate, '1: cashback rate untouched';

  ---------------------------------------------------------------- fixtures
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_shop, 'QA ₱10 live voucher', 'qa', 10, true) RETURNING id INTO _prod;
  ASSERT (SELECT platform_fee_percent FROM public.voucher_products WHERE id = _prod) = 1, 'new product snapshots 1%';
  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, promo_price, active)
  VALUES (_shop, 'QA promo voucher', 'qa', 20, 15, true) RETURNING id INTO _promo;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _shop, _prod, 'QA-' || g, 'unused' FROM generate_series(1, 6) g;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _shop, _promo, 'QAP-' || g, 'unused' FROM generate_series(1, 4) g;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  PERFORM public.admin_load_credits(_res, 100, 'QA fund reseller', 'QA-R', _shop);
  PERFORM public.admin_load_credits(_cust, 100, 'QA fund customer', 'QA-C', _shop);

  ---------------------------------------------------------------- 2, 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
  SELECT sale_price, platform_fee_amount, seller_amount, unit_price INTO _price, _fee, _cut, r
    FROM public.voucher_sales WHERE id = _sale;
  ASSERT _price = 10.00, format('2: reseller pays the full ₱10, got %s', _price);
  ASSERT (SELECT discount_percent FROM public.voucher_sales WHERE id = _sale) = 0, '2: no reseller discount recorded';
  ASSERT _fee = 0.10 AND _cut = 9.90, format('2: fee %s / seller cut %s', _fee, _cut);
  ASSERT (SELECT amount FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'purchase') = 10.00, '2: wallet debited exactly ₱10';
  SELECT coalesce(sum(commission_amount),0) INTO _res_cb FROM public.sale_commissions WHERE sale_id = _sale AND recipient_id = _res;
  ASSERT _res_cb = round(10 * _rate / 100.0, 2), format('3: reseller cashback %s = %s%% of ₱10', _res_cb, _rate);
  SELECT coalesce(sum(commission_amount),0) INTO _adm_cb FROM public.sale_commissions WHERE sale_id = _sale AND recipient_id = _admin;
  SELECT coalesce(sum(commission_amount),0) INTO _split FROM public.sale_commissions WHERE sale_id = _sale;
  ASSERT _split + _fee = 10.00, format('3: cashback %s + fee %s must equal ₱10 (no double fee)', _split, _fee);
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'sale_commission' AND user_id = _res) = 1, '3: one cashback ledger row';

  ---------------------------------------------------------------- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1, _res);
  SELECT sale_price, platform_fee_amount INTO _price, _fee FROM public.voucher_sales WHERE id = _sale;
  ASSERT _price = 10.00 AND _fee = 0.10, '4: customer pays ₱10, fee 0.10';
  ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions WHERE sale_id = _sale AND recipient_id = _res)
         = round(10 * _rate / 100.0, 2), '4: storefront cashback is rate% of ₱10, not of ₱9.90';
  ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions WHERE sale_id = _sale AND recipient_id = _admin)
         = round(10 - round(10 * _rate / 100.0, 2) - 0.10, 2), '4: admin remainder is net of cashback AND fee';

  ---------------------------------------------------------------- 5
  SELECT sale_id INTO _sale FROM public.purchase_voucher(_promo, 1);
  SELECT sale_price, platform_fee_amount, seller_amount INTO _price, _fee, _cut FROM public.voucher_sales WHERE id = _sale;
  ASSERT _price = 15.00 AND _fee = 0.15 AND _cut = 14.85, format('5: promo price for customer %s/%s/%s', _price, _fee, _cut);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT sale_id INTO _sale FROM public.purchase_voucher(_promo, 2);
  SELECT sale_price, platform_fee_amount, seller_amount INTO _price, _fee, _cut FROM public.voucher_sales WHERE id = _sale;
  ASSERT _price = 30.00 AND _fee = 0.30 AND _cut = 29.70, format('5: same promo price for reseller ×2 %s/%s/%s', _price, _fee, _cut);

  ---------------------------------------------------------------- 6
  ASSERT public.voucher_seller_cut(10, 1) = 9.90 AND public.voucher_platform_fee_amount(10, 1) = 0.10, '6: set retail ₱10';
  ASSERT public.voucher_price_from_seller_cut(10, 1) = 10.10, '6: set seller cut ₱10 → ₱10.10';
  ASSERT public.voucher_seller_cut(public.voucher_price_from_seller_cut(9.95, 1), 1) = 9.95, '6: round trip 9.95';
  ASSERT public.voucher_seller_cut(0.01, 1) + public.voucher_platform_fee_amount(0.01, 1) = 0.01, '6: cut + fee always equals price';
  ASSERT public.voucher_seller_cut(10, 0) = 10 AND public.voucher_platform_fee_amount(10, 0) = 0, '6: zero fee';

  ---------------------------------------------------------------- 7
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  SELECT * INTO r FROM public.platform_settings WHERE id = 1;
  PERFORM public.set_platform_money_settings(r.cashback_reseller_percent, r.cashback_subreseller_percent,
            r.cash_out_credits_per_unit, r.cash_out_php_per_unit, r.withdrawal_fee_percent,
            r.shop_transfer_fee_credits, r.cash_in_fee_percent, r.retail_platform_fee_percent, 2);
  ASSERT public.voucher_platform_fee_percent() = 2, '7: fee configurable';
  ASSERT (SELECT platform_fee_percent FROM public.voucher_products WHERE id = _prod) = 1, '7: existing product keeps 1%';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
  ASSERT (SELECT platform_fee_percent FROM public.voucher_sales WHERE id = _sale) = 1, '7: sale of an existing product still 1%';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_shop, 'QA after change', 'qa', 10, true) RETURNING id INTO _new_prod;
  ASSERT (SELECT platform_fee_percent FROM public.voucher_products WHERE id = _new_prod) = 2, '7: new product snapshots 2%';
  UPDATE public.voucher_products SET description = 'edited' WHERE id = _prod;
  ASSERT (SELECT platform_fee_percent FROM public.voucher_products WHERE id = _prod) = 1, '7: non-price edit keeps snapshot';
  UPDATE public.voucher_products SET credit_price = 11 WHERE id = _prod;
  ASSERT (SELECT platform_fee_percent FROM public.voucher_products WHERE id = _prod) = 2, '7: re-pricing takes the current fee';

  ---------------------------------------------------------------- 8
  SELECT md5(string_agg(row_to_json(v)::text, '|' ORDER BY v.id)) INTO _hist_after
    FROM public.voucher_sales v WHERE v.product_id NOT IN (_prod, _promo, _new_prod);
  ASSERT _hist_before = _hist_after, '8: historical voucher sales untouched';
  SELECT md5(string_agg(m.user_id::text || ':' || coalesce(m.sale_commission_percent,-1) || ':' || coalesce(m.reseller_discount_percent,-1), '|' ORDER BY m.user_id))
    INTO _rates_after FROM public.ecosystem_memberships m WHERE m.ecosystem_id = _shop;
  ASSERT _rates_before = _rates_after, '8: cashback configurations untouched';

  ---------------------------------------------------------------- 9
  SELECT m.ecosystem_id, m.user_id INTO _ng, _ng_res
    FROM public.ecosystem_memberships m JOIN public.ecosystems e ON e.id = m.ecosystem_id
   WHERE e.shop_kind = 'subscription' AND m.role = 'reseller' AND m.membership_state = 'active'
     AND coalesce(public.member_cashback_rate(m.user_id, m.ecosystem_id), 0) > 0 LIMIT 1;
  IF _ng IS NOT NULL THEN
    ASSERT public.voucher_discount_percent_for(_ng_res, _ng) = public.member_cashback_rate(_ng_res, _ng),
      '9: New Generation reseller discount rule unchanged';
  END IF;
  ASSERT NOT EXISTS (SELECT 1 FROM public.voucher_sales v JOIN public.ecosystems e ON e.id = v.ecosystem_id
                      WHERE e.shop_kind = 'subscription' AND v.platform_fee_amount > 0),
    '9: no platform fee ever recorded in a New Generation shop';

  RAISE NOTICE 'voucher-universe-pricing: all assertions passed (rate %%%, shop %)', _rate, _shop;
END $$;
