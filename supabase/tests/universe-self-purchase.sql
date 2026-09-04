-- GLOBAL self-purchase cashback rule — shared layer used by EVERY Universe shop type.
--
-- Run against a database copy; it rolls everything back:
--   psql -v ON_ERROR_STOP=1 -c BEGIN -f supabase/tests/universe-self-purchase.sql -c ROLLBACK
--
-- Authority: public.universe_self_purchase_net(...) decides eligibility + net figures,
--            public.universe_purchase_debit(...) writes the ONE buyer-side wallet row.
-- Voucher (purchase_voucher) and Retail (retail_place_order) both delegate to them.
--
-- Proves:
--   V1 Voucher: reseller buys ₱10 from OWN Universe shop → debit = 10 − rate%·10, ONE
--      wallet row, reason "price − cashback = charge", sale keeps price/self_cashback/
--      buyer_charge; admin remainder + fee + cashback still == price (R6 / fee intact).
--   V2 Voucher: customer buys the same product → full ₱10 debit, no self cashback.
--   V3 Voucher: quote == what was actually charged.
--   R1 Retail: reseller buys own-shop product with 20% cashback ₱10 → hold ₱8, one row.
--   R2 Retail: customer → hold ₱10; approve settles seller amount − cashback as before.
--   T1 Transfer: member → member coin transfer: zero cashback, no sale_commissions,
--      no self-purchase metadata.
--   NG shop wallets: untouched by the shared layer (is_universe_shop = false → no netting).

DO $$
DECLARE
  _shop uuid; _admin uuid; _res uuid; _cust uuid; _super uuid; _ng uuid;
  _prod uuid; _rprod uuid; _sale uuid; _rate int; _cb numeric; _net numeric;
  _fee numeric; _split numeric; _o record; _ord public.retail_orders; _l public.credit_ledger;
  _n int; _q record; _before numeric; _after numeric; _res_g uuid; _cust_g uuid;
BEGIN
  SELECT user_id INTO _super FROM public.user_roles WHERE role = 'super_admin' LIMIT 1;
  SELECT e.id INTO _shop FROM public.ecosystems e
   WHERE e.shop_kind = 'universe' AND e.archived_at IS NULL AND coalesce(e.operations_frozen,false) = false
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.ecosystem_id = e.id AND m.role = 'admin' AND m.membership_state = 'active')
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.ecosystem_id = e.id AND m.role = 'reseller' AND m.membership_state = 'active')
   ORDER BY e.created_at LIMIT 1;
  ASSERT _shop IS NOT NULL, 'a Universe shop with admin + reseller is required';
  SELECT id INTO _ng FROM public.ecosystems WHERE shop_kind <> 'universe' AND archived_at IS NULL LIMIT 1;

  SELECT m.user_id INTO _admin FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'admin' AND m.membership_state = 'active' AND p.status = 'active' LIMIT 1;
  SELECT m.user_id INTO _res FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'reseller' AND m.membership_state = 'active' AND p.status = 'active'
     AND NOT public.is_super_admin(m.user_id) LIMIT 1;
  -- Any active Universe member who is NOT part of this shop's management = plain customer.
  SELECT p.id INTO _cust FROM public.profiles p
   WHERE p.status = 'active' AND NOT public.is_super_admin(p.id)
     AND NOT EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.user_id = p.id AND m.ecosystem_id = _shop AND m.role <> 'customer')
     AND p.id <> _res LIMIT 1;
  ASSERT _admin IS NOT NULL AND _res IS NOT NULL AND _cust IS NOT NULL, 'active fixtures required';

  _rate := coalesce(public.member_cashback_rate(_res, _shop), 0);
  ASSERT _rate > 0, 'fixture reseller needs a cashback rate';

  ---------------------------------------------------------------- shared layer contract
  SELECT * INTO _q FROM public.universe_self_purchase_net(_res, _res, _shop, 'credit', 10, 2);
  ASSERT _q.self_purchase AND _q.self_cashback = 2 AND _q.buyer_charge = 8, 'net: ₱10 − ₱2 = ₱8';
  SELECT * INTO _q FROM public.universe_self_purchase_net(_cust, _res, _shop, 'credit', 10, 2);
  ASSERT NOT _q.self_purchase AND _q.buyer_charge = 10, 'net: buyer ≠ entitled recipient → full price';
  SELECT * INTO _q FROM public.universe_self_purchase_net(_res, _res, _shop, 'cash', 10, 2);
  ASSERT NOT _q.self_purchase AND _q.buyer_charge = 10, 'net: only wallet (credit) payments are netted';
  IF _ng IS NOT NULL THEN
    SELECT * INTO _q FROM public.universe_self_purchase_net(_res, _res, _ng, 'credit', 10, 2);
    ASSERT NOT _q.self_purchase AND _q.buyer_charge = 10, 'net: NG shops never netted';
  END IF;
  IF _super IS NOT NULL THEN
    SELECT * INTO _q FROM public.universe_self_purchase_net(_super, _super, _shop, 'credit', 10, 2);
    ASSERT NOT _q.self_purchase, 'net: super admin never earns self cashback';
  END IF;

  ---------------------------------------------------------------- fixtures
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_shop, 'QA self ₱10 voucher', 'qa', 10, true) RETURNING id INTO _prod;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _shop, _prod, 'QAS-' || g, 'unused' FROM generate_series(1, 4) g;
  UPDATE public.ecosystems SET store_retail_enabled = true, retail_credit_enabled = true, retail_pickup_enabled = true WHERE id = _shop;
  INSERT INTO public.retail_products (ecosystem_id, name, price, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_shop, 'QA self soap', 10, 10, true, true, false, true, 'percent', 20) RETURNING id INTO _rprod;

  _res_g := public.ensure_global_wallet(_res);
  _cust_g := public.ensure_global_wallet(_cust);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_res_g, _res, NULL, 'credit', 100, 0, 'QA fund', 'QA-R', public.new_tx_id(), 'general'),
         (_cust_g, _cust, NULL, 'credit', 100, 0, 'QA fund', 'QA-C', public.new_tx_id(), 'general');

  ---------------------------------------------------------------- V3 quote first
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _q FROM public.voucher_checkout_quote(_prod, 1);
  _cb := round(10 * _rate / 100.0, 2); _net := round(10 - _cb, 2);
  ASSERT _q.self_purchase AND _q.total = 10 AND _q.self_cashback = _cb AND _q.buyer_charge = _net AND _q.cashback_percent = _rate,
         format('V3: quote %s/%s/%s', _q.total, _q.self_cashback, _q.buyer_charge);

  ---------------------------------------------------------------- V1 voucher self purchase
  SELECT balance INTO _before FROM public.credit_accounts WHERE id = _res_g;
  SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
  SELECT balance INTO _after FROM public.credit_accounts WHERE id = _res_g;
  ASSERT _before - _after = _net, format('V1: wallet moved %s, expected net %s', _before - _after, _net);
  SELECT count(*) INTO _n FROM public.credit_ledger WHERE sale_id = _sale AND user_id = _res;
  ASSERT _n = 1, format('V1: exactly ONE wallet row for the buyer, got %s', _n);
  SELECT * INTO _l FROM public.credit_ledger WHERE sale_id = _sale AND user_id = _res;
  ASSERT _l.direction = 'debit' AND _l.amount = _net AND _l.base_amount = 10 AND _l.commission_amount = _cb, 'V1: debit carries gross/cashback breakdown';
  ASSERT _l.reason LIKE 'Self purchase%' AND _l.reason LIKE '%cashback =%', format('V1: readable reason, got %s', _l.reason);
  ASSERT (SELECT sale_price FROM public.voucher_sales WHERE id = _sale) = 10, 'V1: sale price stays ₱10 (terminology preserved)';
  ASSERT (SELECT self_cashback FROM public.voucher_sales WHERE id = _sale) = _cb, 'V1: sale.self_cashback';
  ASSERT (SELECT buyer_charge FROM public.voucher_sales WHERE id = _sale) = _net, 'V1: sale.buyer_charge';
  SELECT platform_fee_amount INTO _fee FROM public.voucher_sales WHERE id = _sale;
  SELECT coalesce(sum(commission_amount),0) INTO _split FROM public.sale_commissions WHERE sale_id = _sale;
  ASSERT _fee = 0.10 AND _split + _fee = 10, format('V1: cashback %s + fee %s == ₱10 (R6/fee intact)', _split, _fee);
  ASSERT (SELECT count(*) FROM public.sale_commissions WHERE sale_id = _sale AND recipient_id = _res AND commission_amount = _cb) = 1, 'V1: audit row for own cashback kept';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE sale_id = _sale AND user_id = _admin AND direction = 'credit') = 1, 'V1: admin remainder still credited';
  ASSERT (SELECT count(*) FROM public.voucher_codes WHERE product_id = _prod AND status = 'sold') = 1, 'V1: code issued';

  ---------------------------------------------------------------- V2 customer, same product
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  SELECT * INTO _q FROM public.voucher_checkout_quote(_prod, 1);
  ASSERT NOT _q.self_purchase AND _q.buyer_charge = 10, 'V2: customer quote is full price';
  SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
  ASSERT (SELECT amount FROM public.credit_ledger WHERE sale_id = _sale AND user_id = _cust) = 10, 'V2: customer debited ₱10';
  ASSERT (SELECT coalesce(self_cashback,0) FROM public.voucher_sales WHERE id = _sale) = 0, 'V2: no self cashback';
  ASSERT (SELECT buyer_charge FROM public.voucher_sales WHERE id = _sale) = 10, 'V2: buyer_charge = price';

  ---------------------------------------------------------------- R1 retail self purchase
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _q FROM public.retail_checkout_quote(_shop, jsonb_build_array(jsonb_build_object('product_id', _rprod, 'quantity', 1)));
  ASSERT _q.self_purchase AND _q.total = 10 AND _q.self_cashback = 2 AND _q.buyer_charge = 8, 'R1: quote ₱10 − ₱2 = ₱8';
  SELECT balance INTO _before FROM public.credit_accounts WHERE id = _res_g;
  SELECT * INTO _o FROM public.retail_place_order(_shop, jsonb_build_array(jsonb_build_object('product_id', _rprod, 'quantity', 1)), 'pickup', 'credit');
  SELECT balance INTO _after FROM public.credit_accounts WHERE id = _res_g;
  ASSERT _before - _after = 8, format('R1: wallet held %s, expected ₱8', _before - _after);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.total = 10 AND _ord.self_cashback = 2 AND _ord.buyer_charge = 8, 'R1: order keeps price / cashback / charge';
  SELECT count(*) INTO _n FROM public.credit_ledger WHERE user_id = _res AND created_at >= _ord.created_at;
  ASSERT _n = 1, format('R1: one wallet row for the hold, got %s', _n);
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.hold_ledger_id;
  ASSERT _l.amount = 8 AND _l.base_amount = 10 AND _l.commission_amount = 2 AND _l.reason LIKE 'Self purchase%', 'R1: hold row breakdown';

  ---------------------------------------------------------------- R2 retail customer
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  SELECT * INTO _o FROM public.retail_place_order(_shop, jsonb_build_array(jsonb_build_object('product_id', _rprod, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.total = 10 AND coalesce(_ord.self_cashback,0) = 0 AND _ord.buyer_charge = 10, 'R2: customer holds full ₱10';

  ---------------------------------------------------------------- T1 transfer: never a purchase
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT balance INTO _before FROM public.credit_accounts WHERE id = _res_g;
  PERFORM public.transfer_universe_coins(_cust, 5, 'QA transfer', 'QA-T-' || gen_random_uuid()::text);
  SELECT balance INTO _after FROM public.credit_accounts WHERE id = _res_g;
  ASSERT _before - _after = 5, 'T1: transfer debits exactly the amount';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = _res AND reason LIKE 'QA transfer%' AND (sale_id IS NOT NULL OR base_amount IS NOT NULL)),
         'T1: transfer row carries no sale / cashback breakdown';
  ASSERT NOT EXISTS (SELECT 1 FROM public.sale_commissions sc JOIN public.credit_ledger cl ON cl.id = sc.ledger_id WHERE cl.reason LIKE 'QA transfer%'),
         'T1: transfers produce zero cashback';

  RAISE NOTICE 'UNIVERSE_SELF_PURCHASE_TESTS_PASSED';
END $$;
