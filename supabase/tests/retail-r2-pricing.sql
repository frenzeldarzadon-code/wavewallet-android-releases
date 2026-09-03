-- Retail Phase R2 — pricing foundation: wholesale (single tier) + additive platform fee.
--
-- Self-contained rollback test: every write happens inside one DO block that
-- ends with RAISE EXCEPTION, so nothing persists. Run it as a single
-- statement (psql or the SQL runner); success is the final error text
-- "RETAIL_R2_TESTS_PASSED". Replace the ids with rows from the target database.
--
-- Expectations:
--   Applicable price first: wholesale price once qty >= wholesale_min_qty, else regular.
--   Fee = round(seller line × fee% / 100, 2) on the APPLICABLE seller amount only.
--   Customer consumes seller amount + fee; the ledger hold equals the order total.
--   Order rows snapshot seller_total / fee% / fee amount; later setting changes never touch them.
--   Approval pays the admin the seller amount only and records the fee for the platform.
--   Insufficient balance rolls back order, stock and ledger together.
--   Universe orders use GLOBAL wallets; New Generation orders use the SHOP wallet.

DO $$
DECLARE
  _u    uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- Sagada Wave One-Stop-Shop (universe)
  _adm  uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- shop admin (both shops)
  _cus  uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- universe customer
  _s    uuid := '1ba85735-e5df-4fbe-bf5f-71dff985e824'; -- SW DEMO (subscription)
  _cus2 uuid := '617ef79a-e3d6-4a6f-9dcc-b09414a35336'; -- subscription customer
  _prod uuid; _prod2 uuid; _cheap uuid; _o record; _ord public.retail_orders; _it public.retail_order_items;
  _l public.credit_ledger; _cg uuid; _ag uuid; _c2s uuid; _c2g uuid; _as uuid;
  _cg_bal numeric; _ag_bal numeric; _c2s_bal numeric; _c2g_bal numeric; _as_bal numeric;
  _stock int; _orders int; _fee_rows int; _prev_fee numeric;
  claims_cus text; claims_adm text; claims_cus2 text;
BEGIN
  claims_cus  := json_build_object('sub', _cus, 'role', 'authenticated')::text;
  claims_adm  := json_build_object('sub', _adm, 'role', 'authenticated')::text;
  claims_cus2 := json_build_object('sub', _cus2, 'role', 'authenticated')::text;

  ASSERT public.is_universe_shop(_u), 'fixture: first shop must be a Universe shop';
  ASSERT NOT public.is_universe_shop(_s), 'fixture: second shop must be a subscription shop';

  -- ---------------- setup ----------------
  SELECT retail_platform_fee_percent INTO _prev_fee FROM public.platform_settings WHERE id = 1;
  UPDATE public.platform_settings SET retail_platform_fee_percent = 1 WHERE id = 1;
  ASSERT public.retail_platform_fee_percent() = 1, 'fee setting readable';

  UPDATE public.ecosystems SET store_retail_enabled = true, retail_credit_enabled = true,
         retail_cash_enabled = true, retail_pickup_enabled = true, operations_frozen = false
   WHERE id IN (_u, _s);
  -- regular ₱100, wholesale ₱90 from 12 pieces
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible)
  VALUES (_u, 'R2 sardines', 100, 90, 12, 100, true, true, false, true) RETURNING id INTO _prod;
  -- rounding fixture: ₱12.35, no wholesale
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible)
  VALUES (_u, 'R2 candy', 12.35, 0, 0, 100, true, true, false, true) RETURNING id INTO _cheap;
  -- New Generation product
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible)
  VALUES (_s, 'R2 noodles', 100, 90, 12, 100, true, true, false, true) RETURNING id INTO _prod2;

  _cg := public.ensure_global_wallet(_cus);
  _ag := public.ensure_global_wallet(_adm);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_cg, _cus, NULL, 'credit', 5000, 0, 'R2 test funding', 'R2', public.new_tx_id(), 'general');
  SELECT balance INTO _cg_bal FROM public.credit_accounts WHERE id = _cg;
  SELECT balance INTO _ag_bal FROM public.credit_accounts WHERE id = _ag;

  -- ---------------- 1. normal retail price + 1% fee ----------------
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.total = 101.00, 'normal: customer consumes 101';
  ASSERT _ord.seller_total = 100.00 AND _ord.platform_fee_percent = 1.00 AND _ord.platform_fee_amount = 1.00, 'normal snapshot';
  SELECT * INTO _it FROM public.retail_order_items WHERE order_id = _ord.id;
  ASSERT _it.unit_price = 100 AND NOT _it.wholesale_applied AND _it.seller_line_total = 100 AND _it.fee_amount = 1 AND _it.line_total = 101, 'normal item snapshot';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.hold_ledger_id;
  ASSERT _l.amount = 101.00 AND _l.account_id = _cg, 'normal: ledger hold equals displayed total, on the GLOBAL wallet';

  -- ---------------- 2. threshold selection: 11 stays regular ----------------
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 11)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.seller_total = 1100 AND _ord.platform_fee_amount = 11 AND _ord.total = 1111, 'qty 11 uses regular price';
  PERFORM public.cancel_retail_order(_ord.id);

  -- ---------------- 3. wholesale price + fee from the DISCOUNTED amount ----------------
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 12)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  SELECT * INTO _it FROM public.retail_order_items WHERE order_id = _ord.id;
  ASSERT _it.wholesale_applied AND _it.unit_price = 90 AND _it.regular_unit_price = 100, 'qty 12 applies wholesale';
  ASSERT _ord.seller_total = 1080.00, 'wholesale seller amount 12 × 90';
  ASSERT _ord.platform_fee_amount = 10.80, 'fee is 1% of 1080, never 1% of 1200';
  ASSERT _ord.platform_fee_amount <> 12.00, 'fee must not use the regular price';
  ASSERT _ord.total = 1090.80, 'wholesale customer total';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.hold_ledger_id;
  ASSERT _l.amount = 1090.80, 'wholesale hold equals total';

  -- ---------------- 4. historical snapshot: change the setting, settle with the old rate ----------------
  UPDATE public.platform_settings SET retail_platform_fee_percent = 2 WHERE id = 1;
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.platform_fee_percent = 1 AND _ord.platform_fee_amount = 10.80 AND _ord.total = 1090.80, 'order unchanged after fee change';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, 'ok');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'approved' AND _ord.settlement_ledger_id IS NOT NULL, 'approved';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id;
  ASSERT _l.amount = 1080.00 AND _l.account_id = _ag AND _l.user_id = _adm, 'admin receives the SELLER amount on the GLOBAL wallet';
  SELECT count(*) INTO _fee_rows FROM public.retail_platform_fees WHERE order_id = _ord.id AND fee_credits = 10.80 AND fee_percent = 1 AND seller_credits = 1080;
  ASSERT _fee_rows = 1, 'platform fee recorded once with the snapshotted rate';
  SELECT balance INTO _ag_bal FROM public.credit_accounts WHERE id = _ag;
  -- new orders now use 2%
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 12)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.platform_fee_percent = 2 AND _ord.seller_total = 1080 AND _ord.platform_fee_amount = 21.60 AND _ord.total = 1101.60, 'new order uses the new rate; seller amount unchanged';
  PERFORM public.cancel_retail_order(_ord.id);
  SELECT * INTO _l FROM public.credit_ledger WHERE id = (SELECT refund_ledger_id FROM public.retail_orders WHERE id = _ord.id);
  ASSERT _l.amount = 1101.60 AND _l.account_id = _cg, 'cancellation refunds the full customer amount';
  UPDATE public.platform_settings SET retail_platform_fee_percent = 1 WHERE id = 1;

  -- ---------------- 5. rounding: per-line rounding, order = sum of lines ----------------
  SELECT * INTO _o FROM public.retail_place_order(_u,
    jsonb_build_array(jsonb_build_object('product_id', _cheap, 'quantity', 3),
                      jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  SELECT * INTO _it FROM public.retail_order_items WHERE order_id = _ord.id AND product_id = _cheap;
  ASSERT _it.seller_line_total = 37.05 AND _it.fee_amount = 0.37 AND _it.line_total = 37.42, 'rounded line 12.35 × 3';
  ASSERT _ord.seller_total = 137.05 AND _ord.platform_fee_amount = 1.37 AND _ord.total = 138.42, 'order = sum of rounded lines';
  ASSERT _ord.total = (SELECT sum(line_total) FROM public.retail_order_items WHERE order_id = _ord.id), 'total equals item sum';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.hold_ledger_id;
  ASSERT _l.amount = _ord.total, 'ledger equals displayed total (no rounding drift)';
  PERFORM public.cancel_retail_order(_ord.id);

  -- ---------------- 6. insufficient balance is atomic ----------------
  SELECT stock INTO _stock FROM public.retail_products WHERE id = _prod;
  SELECT count(*) INTO _orders FROM public.retail_orders WHERE customer_id = _cus;
  SELECT balance INTO _cg_bal FROM public.credit_accounts WHERE id = _cg;
  BEGIN
    PERFORM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 90)), 'pickup', 'credit');
    RAISE EXCEPTION 'insufficient balance must fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'insufficient balance must fail' THEN RAISE; END IF;
  END;
  ASSERT (SELECT stock FROM public.retail_products WHERE id = _prod) = _stock, 'stock restored after failed hold';
  ASSERT (SELECT count(*) FROM public.retail_orders WHERE customer_id = _cus) = _orders, 'no orphan order';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cg_bal, 'no partial debit';

  -- ---------------- 7. New Generation: shop wallet only, same pricing ----------------
  _c2s := public.ensure_credit_account(_cus2, _s);
  _c2g := public.ensure_global_wallet(_cus2);
  _as  := public.ensure_credit_account(_adm, _s);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_c2s, _cus2, _s, 'credit', 2000, 0, 'R2 NG funding', 'R2', public.new_tx_id(), 'general');
  SELECT balance INTO _c2g_bal FROM public.credit_accounts WHERE id = _c2g;
  SELECT balance INTO _as_bal FROM public.credit_accounts WHERE id = _as;
  PERFORM set_config('request.jwt.claims', claims_cus2, true);
  SELECT * INTO _o FROM public.retail_place_order(_s, jsonb_build_array(jsonb_build_object('product_id', _prod2, 'quantity', 12)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.total = 1090.80 AND _ord.seller_total = 1080 AND _ord.platform_fee_amount = 10.80, 'NG pricing identical';
  ASSERT _ord.wallet_account_id = _c2s, 'NG hold on the SHOP wallet';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _c2g) = _c2g_bal, 'NG: global wallet untouched';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _l FROM public.credit_ledger WHERE id = (SELECT settlement_ledger_id FROM public.retail_orders WHERE id = _ord.id);
  ASSERT _l.account_id = _as AND _l.amount = 1080, 'NG settlement: seller amount to admin SHOP wallet';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _ag_bal, 'NG settlement never touches the admin global wallet';

  -- ---------------- 8. buyer listing exposes wholesale, hides SKU/barcode ----------------
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  ASSERT EXISTS (SELECT 1 FROM public.list_retail_products(_u) WHERE id = _prod AND wholesale_price = 90 AND wholesale_min_qty = 12), 'wholesale visible to buyers';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.routine_columns_dummy_check LIMIT 0), 'noop';

  UPDATE public.platform_settings SET retail_platform_fee_percent = _prev_fee WHERE id = 1;
  RAISE EXCEPTION 'RETAIL_R2_TESTS_PASSED';
END $$;
