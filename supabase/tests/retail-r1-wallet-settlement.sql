-- Retail Phase R1 — wallet routing, settlement, refunds, rollback, freeze, isolation.
--
-- Self-contained rollback test: every write happens inside one DO block that
-- ends with RAISE EXCEPTION, so nothing persists. Run it as a single
-- statement (psql or the SQL runner); success is the final error text
-- "RETAIL_R1_TESTS_PASSED". Replace the ids with rows from the target database.
--
-- Expectations:
--   Universe shop: coin hold/settlement/refund all use GLOBAL wallets (ecosystem_id null).
--   New Generation shop: coin hold/settlement use the SHOP wallet; global wallets untouched.
--   Approve settles once to the shop admin; second review refused.
--   Reject / cancel refund the exact hold, referencing the hold row.
--   Insufficient balance rolls back the order, stock and ledger together.
--   Frozen shop refuses new orders and approvals.

DO $$
DECLARE
  -- Universe shop + members
  _u    uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- Sagada Wave One-Stop-Shop (universe)
  _adm  uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- shop admin (both shops)
  _cus  uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- universe customer
  -- New Generation shop + member
  _s    uuid := '1ba85735-e5df-4fbe-bf5f-71dff985e824'; -- SW DEMO (subscription)
  _cus2 uuid := '617ef79a-e3d6-4a6f-9dcc-b09414a35336'; -- subscription customer
  _prod uuid; _prod2 uuid; _o record; _ord public.retail_orders; _l public.credit_ledger;
  _cg uuid; _ag uuid; _c2s uuid; _c2g uuid; _as uuid; _ag_bal numeric; _cg_bal numeric;
  _c2s_bal numeric; _c2g_bal numeric; _as_bal numeric; _n int; _stock int; _orders int;
  _flags jsonb;
  claims_cus text; claims_adm text; claims_cus2 text;
BEGIN
  claims_cus  := json_build_object('sub', _cus, 'role', 'authenticated')::text;
  claims_adm  := json_build_object('sub', _adm, 'role', 'authenticated')::text;
  claims_cus2 := json_build_object('sub', _cus2, 'role', 'authenticated')::text;

  ASSERT public.is_universe_shop(_u), 'fixture: first shop must be a Universe shop';
  ASSERT NOT public.is_universe_shop(_s), 'fixture: second shop must be a subscription shop';

  -- ---------------- setup: enable retail, product, funding ----------------
  UPDATE public.ecosystems SET store_retail_enabled = true, retail_credit_enabled = true,
         retail_cash_enabled = true, retail_pickup_enabled = true, operations_frozen = false
   WHERE id IN (_u, _s);
  INSERT INTO public.retail_products (ecosystem_id, name, price, stock, active, published, archived, public_visible)
  VALUES (_u, 'R1 test soap', 25, 10, true, true, false, true) RETURNING id INTO _prod;
  INSERT INTO public.retail_products (ecosystem_id, name, price, stock, active, published, archived, public_visible)
  VALUES (_s, 'R1 test noodles', 25, 10, true, true, false, true) RETURNING id INTO _prod2;

  _cg := public.ensure_global_wallet(_cus);
  _ag := public.ensure_global_wallet(_adm);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_cg, _cus, NULL, 'credit', 100, 0, 'R1 test funding', 'R1', public.new_tx_id(), 'general');
  SELECT balance INTO _cg_bal FROM public.credit_accounts WHERE id = _cg;
  SELECT balance INTO _ag_bal FROM public.credit_accounts WHERE id = _ag;
  SELECT count(*) INTO _orders FROM public.retail_orders WHERE customer_id = _cus;

  -- ---------------- 1. Universe hold lands on the GLOBAL wallet ----------------
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 2)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.total = 50, 'order total';
  ASSERT _ord.hold_ledger_id IS NOT NULL AND _ord.wallet_account_id = _cg, 'hold must be on the global wallet';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.hold_ledger_id;
  ASSERT _l.entry_kind = 'retail_hold' AND _l.direction = 'debit' AND _l.amount = 50, 'hold ledger row';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cg_bal - 50, 'buyer global balance debited';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger cl JOIN public.credit_accounts ca ON ca.id = cl.account_id
                      WHERE cl.reference = _ord.order_no AND ca.ecosystem_id IS NOT NULL), 'no shop wallet touched in a Universe shop';
  ASSERT (SELECT stock FROM public.retail_products WHERE id = _prod) = 8, 'stock reserved';

  -- ---------------- 2. Approve settles once to the admin's GLOBAL wallet ----------------
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_o.order_id, true, 'ok');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'approved' AND _ord.settlement_ledger_id IS NOT NULL AND _ord.settled_to = _adm, 'settled to admin';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id;
  ASSERT _l.entry_kind = 'retail_settlement' AND _l.account_id = _ag AND _l.amount = 50, 'settlement on admin global wallet';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _ag_bal + 50, 'admin received the coins';
  BEGIN
    PERFORM public.retail_review_order(_o.order_id, true);
    RAISE EXCEPTION 'second approval should fail';
  EXCEPTION WHEN others THEN
    IF position('already' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no) = 2, 'exactly hold + settlement';

  -- ---------------- 3. Reject refunds the exact hold ----------------
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit');
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cg_bal - 75, 'second hold';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_o.order_id, false, 'out of stock');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'rejected' AND _ord.credit_released AND _ord.refund_ledger_id IS NOT NULL, 'rejected + refund pointer';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.refund_ledger_id;
  ASSERT _l.entry_kind = 'retail_refund' AND _l.account_id = _cg AND _l.amount = 25 AND _l.reverses_ledger_id = _ord.hold_ledger_id, 'refund references the hold';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cg_bal - 50, 'refund restored balance';
  ASSERT (SELECT stock FROM public.retail_products WHERE id = _prod) = 8, 'stock restored after reject';

  -- ---------------- 4. Cancel refunds too ----------------
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit');
  PERFORM public.cancel_retail_order(_o.order_id);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'cancelled' AND _ord.refund_ledger_id IS NOT NULL, 'cancelled with refund';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cg_bal - 50, 'cancel refunded';
  BEGIN
    PERFORM public.cancel_retail_order(_o.order_id);
    RAISE EXCEPTION 'second cancel should fail';
  EXCEPTION WHEN others THEN
    IF position('already' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- ---------------- 5. Insufficient balance rolls everything back ----------------
  SELECT count(*) INTO _n FROM public.retail_orders WHERE customer_id = _cus;
  SELECT count(*) INTO _stock FROM public.credit_ledger WHERE user_id = _cus;
  BEGIN
    PERFORM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 3)), 'pickup', 'credit'); -- 75 > 50 left
    RAISE EXCEPTION 'insufficient balance should fail';
  EXCEPTION WHEN others THEN
    IF position('Insufficient' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  ASSERT (SELECT count(*) FROM public.retail_orders WHERE customer_id = _cus) = _n, 'no orphan order';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE user_id = _cus) = _stock, 'no orphan ledger row';
  ASSERT (SELECT stock FROM public.retail_products WHERE id = _prod) = 8, 'stock not consumed on failure';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cg_bal - 50, 'balance untouched on failure';

  -- ---------------- 6. Frozen shop ----------------
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit');
  UPDATE public.ecosystems SET operations_frozen = true WHERE id = _u;
  BEGIN
    PERFORM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit');
    RAISE EXCEPTION 'frozen shop should refuse orders';
  EXCEPTION WHEN others THEN
    IF position('frozen' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  BEGIN
    PERFORM public.retail_review_order(_o.order_id, true);
    RAISE EXCEPTION 'frozen shop should refuse settlement';
  EXCEPTION WHEN others THEN
    IF position('frozen' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  ASSERT (SELECT status FROM public.retail_orders WHERE id = _o.order_id) = 'pending', 'order still pending while frozen';
  UPDATE public.ecosystems SET operations_frozen = false WHERE id = _u;
  PERFORM public.retail_review_order(_o.order_id, false, 'unfrozen reject');
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cg_bal - 50, 'refund after unfreeze';

  -- ---------------- 7. New Generation isolation ----------------
  PERFORM public.ensure_membership_wallets(_cus2, _s);
  PERFORM public.ensure_membership_wallets(_adm, _s);
  SELECT id INTO _c2s FROM public.credit_accounts WHERE user_id = _cus2 AND ecosystem_id = _s;
  SELECT id INTO _as  FROM public.credit_accounts WHERE user_id = _adm  AND ecosystem_id = _s;
  _c2g := public.ensure_global_wallet(_cus2);
  ASSERT _c2s IS NOT NULL AND _as IS NOT NULL, 'fixture: shop wallets';
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_c2s, _cus2, _s, 'credit', 100, 0, 'R1 test funding', 'R1', public.new_tx_id(), 'general');
  SELECT balance INTO _c2s_bal FROM public.credit_accounts WHERE id = _c2s;
  SELECT balance INTO _c2g_bal FROM public.credit_accounts WHERE id = _c2g;
  SELECT balance INTO _as_bal  FROM public.credit_accounts WHERE id = _as;
  SELECT balance INTO _ag_bal  FROM public.credit_accounts WHERE id = _ag;

  PERFORM set_config('request.jwt.claims', claims_cus2, true);
  SELECT * INTO _o FROM public.retail_place_order(_s, jsonb_build_array(jsonb_build_object('product_id', _prod2, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.wallet_account_id = _c2s, 'NG hold on the shop wallet';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _c2s) = _c2s_bal - 25, 'NG shop wallet debited';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _c2g) = _c2g_bal, 'NG buyer global wallet untouched';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_o.order_id, true);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id;
  ASSERT _l.account_id = _as, 'NG settlement on the admin shop wallet';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _as) = _as_bal + 25, 'NG admin shop wallet credited';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _ag_bal, 'NG never reaches the admin global wallet';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger cl JOIN public.credit_accounts ca ON ca.id = cl.account_id
                      WHERE cl.reference = _ord.order_no AND ca.ecosystem_id IS NULL), 'no global wallet row for an NG order';

  -- ---------------- 8. Public exposure ----------------
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'retail_products' AND 'anon' = ANY(roles)),
         'anon must not read retail_products rows directly';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.routines r
                      WHERE r.routine_name = 'list_retail_products'
                        AND pg_get_function_result((r.specific_schema||'.'||r.specific_name)::text::regprocedure) LIKE '%wholesale%'),
         'buyer listing must not return wholesale fields';

  RAISE EXCEPTION 'RETAIL_R1_TESTS_PASSED';
END $$;
