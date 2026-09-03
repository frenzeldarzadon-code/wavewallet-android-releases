-- Retail R4 — order lifecycle & settlement hardening. Rollback-only: the DO
-- block ends with RAISE EXCEPTION so nothing persists. Success = final error
-- text "RETAIL_R4_TESTS_PASSED". Fixtures are live ids; replace as needed.
--
-- Lifecycle under test: pending -> approved | rejected | cancelled (all final).
-- Accounting model per approved coin order:
--   buyer debit (total) = admin credit (seller_total - cashback) + cashback credit + platform fee (reporting only)
-- Matrix: A normal, B wholesale, C percent, D fixed, E disabled, F reseller earns,
-- G no subreseller, H/I repeated settlement, J settle-after-settle guard, K cancel
-- before settlement, L/M cancel after settlement, N price change, O cashback change,
-- P fee once + no Super Admin credit, Q no points, R New Generation isolation.
-- S (Voucher functions unchanged) is checked outside via function checksums.

DO $$
DECLARE
  _u    uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- Sagada Wave One-Stop-Shop (universe)
  _adm  uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- shop admin (both shops)
  _cus  uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- universe customer
  _res  uuid := '0c10e602-c154-4e0f-bac1-0aadc642fee0'; -- reseller
  _sub  uuid := 'fd9b863c-9c7c-4794-a35b-779e7d82e37b'; -- subreseller under _res
  _sa   uuid := '4f8c8e50-16f6-441d-9619-121c72ba3387'; -- super admin
  _s    uuid := '1ba85735-e5df-4fbe-bf5f-71dff985e824'; -- SW DEMO (New Generation)
  _cus2 uuid := '617ef79a-e3d6-4a6f-9dcc-b09414a35336'; -- NG customer
  _pA uuid; _pB uuid; _pD uuid; _pN uuid;
  _o record; _ord public.retail_orders; _l public.credit_ledger;
  _cg uuid; _ag uuid; _rg uuid; _sg uuid; _sag uuid; _c2s uuid; _c2g uuid; _as uuid;
  _cus0 numeric; _adm0 numeric; _res0 numeric; _sub0 numeric; _sa0 numeric; _c2s0 numeric; _c2g0 numeric; _as0 numeric;
  _points0 bigint; _ledger0 bigint; _prev_fee numeric; _n int;
  _debits numeric := 0; _admin_credits numeric := 0; _cb_credits numeric := 0; _fees numeric := 0; _refunds numeric := 0;
  c_cus text; c_adm text; c_cus2 text;
BEGIN
  c_cus  := json_build_object('sub', _cus,  'role', 'authenticated')::text;
  c_adm  := json_build_object('sub', _adm,  'role', 'authenticated')::text;
  c_cus2 := json_build_object('sub', _cus2, 'role', 'authenticated')::text;

  ASSERT public.is_universe_shop(_u) AND NOT public.is_universe_shop(_s), 'fixtures';
  SELECT retail_platform_fee_percent INTO _prev_fee FROM public.platform_settings WHERE id = 1;
  UPDATE public.platform_settings SET retail_platform_fee_percent = 1 WHERE id = 1;
  UPDATE public.ecosystems SET store_retail_enabled = true, retail_credit_enabled = true,
         retail_pickup_enabled = true, operations_frozen = false WHERE id IN (_u, _s);
  INSERT INTO public.shop_seller_authorizations (ecosystem_id, user_id, active) VALUES (_u, _res, true)
  ON CONFLICT (ecosystem_id, user_id) DO UPDATE SET active = true;

  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R4 A', 100, 0, 0, 100, true, true, false, true, 'disabled', 50) RETURNING id INTO _pA;
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R4 B', 100, 90, 12, 100, true, true, false, true, 'percent', 10) RETURNING id INTO _pB;
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R4 D', 100, 0, 0, 100, true, true, false, true, 'fixed', 2) RETURNING id INTO _pD;
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_s, 'R4 NG', 100, 90, 12, 100, true, true, false, true, 'percent', 10) RETURNING id INTO _pN;

  _cg := public.ensure_global_wallet(_cus); _ag := public.ensure_global_wallet(_adm);
  _rg := public.ensure_global_wallet(_res); _sg := public.ensure_global_wallet(_sub);
  _sag := public.ensure_global_wallet(_sa);
  _c2s := public.ensure_credit_account(_cus2, _s); _c2g := public.ensure_global_wallet(_cus2);
  _as := public.ensure_credit_account(_adm, _s);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_cg, _cus, NULL, 'credit', 5000, 0, 'R4 funding', 'R4', public.new_tx_id(), 'general'),
         (_c2s, _cus2, _s, 'credit', 2000, 0, 'R4 funding', 'R4', public.new_tx_id(), 'general');
  SELECT balance INTO _cus0 FROM public.credit_accounts WHERE id = _cg;
  SELECT balance INTO _adm0 FROM public.credit_accounts WHERE id = _ag;
  SELECT balance INTO _res0 FROM public.credit_accounts WHERE id = _rg;
  SELECT balance INTO _sub0 FROM public.credit_accounts WHERE id = _sg;
  SELECT balance INTO _sa0  FROM public.credit_accounts WHERE id = _sag;
  SELECT count(*) INTO _points0 FROM public.points_ledger;
  SELECT count(*) INTO _ledger0 FROM public.credit_ledger;

  -- ===== A + E: normal price, cashback disabled (value ignored) =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pA, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'pending' AND _ord.total = 101 AND _ord.seller_total = 100 AND _ord.platform_fee_amount = 1 AND _ord.cashback_total = 0, 'A snapshot';
  ASSERT _ord.hold_ledger_id IS NOT NULL AND _ord.credit_hold_tx IS NOT NULL AND _ord.wallet_account_id = _cg, 'A hold on global wallet';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'approved' AND _ord.settlement_ledger_id IS NOT NULL AND _ord.cashback_ledger_id IS NULL AND _ord.refund_ledger_id IS NULL, 'A approved';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus0 - 101, 'A buyer -101 once';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0 + 100, 'A admin +100';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no AND entry_kind = 'retail_hold') = 1, 'A one debit';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no AND entry_kind = 'retail_settlement') = 1, 'A one settlement';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no AND entry_kind = 'retail_cashback') = 0, 'E no cashback when disabled';
  ASSERT (SELECT count(*) FROM public.retail_platform_fees WHERE order_id = _ord.id) = 1 AND (SELECT fee_credits FROM public.retail_platform_fees WHERE order_id = _ord.id) = 1, 'A fee once';
  _cus0 := _cus0 - 101; _adm0 := _adm0 + 100; _debits := _debits + 101; _admin_credits := _admin_credits + 100; _fees := _fees + 1;

  -- ===== H + I: double-click / repeated settlement RPC =====
  BEGIN
    PERFORM public.retail_review_order(_ord.id, true, NULL);
    RAISE EXCEPTION 'H must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'H must fail' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.retail_review_order(_ord.id, false, 'late reject');
    RAISE EXCEPTION 'I must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'I must fail' THEN RAISE; END IF; END;
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus0 AND (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0, 'H/I balances unchanged';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no) = 2, 'H/I still exactly 2 ledger rows (hold + settlement)';
  ASSERT (SELECT count(*) FROM public.retail_platform_fees WHERE order_id = _ord.id) = 1, 'H/I fee still once';

  -- ===== J: settle-after-settle at the row level (trigger) =====
  BEGIN
    UPDATE public.retail_orders SET status = 'pending' WHERE id = _ord.id;
    RAISE EXCEPTION 'J1 must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'J1 must fail' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.retail_orders SET settlement_ledger_id = _ord.hold_ledger_id WHERE id = _ord.id;
    RAISE EXCEPTION 'J2 must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'J2 must fail' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.retail_orders SET total = 1 WHERE id = _ord.id;
    RAISE EXCEPTION 'J3 must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'J3 must fail' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.retail_order_items SET unit_price = 1 WHERE order_id = _ord.id;
    RAISE EXCEPTION 'J4 must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'J4 must fail' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM public.retail_order_items WHERE order_id = _ord.id;
    RAISE EXCEPTION 'J5 must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'J5 must fail' THEN RAISE; END IF; END;
  ASSERT (SELECT count(*) FROM public.retail_order_items WHERE order_id = _ord.id) = 1, 'J5 items still present';
  -- a duplicate settlement ledger row is impossible even if a caller bypassed the RPC
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
    VALUES (_ag, _adm, _u, 'credit', 100, 0, 'dup', _ord.order_no, _ord.credit_hold_tx || '-S', 'retail_settlement');
    RAISE EXCEPTION 'J6 must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'J6 must fail' THEN RAISE; END IF; END;
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0, 'J no coins created';

  -- ===== B + C + F + N + O: wholesale, percent cashback via reseller, product edited after order =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pB, 'quantity', 12)), 'pickup', 'credit', NULL, NULL, _res);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.seller_total = 1080 AND _ord.platform_fee_amount = 10.80 AND _ord.total = 1090.80, 'B wholesale pricing 12 x 90';
  ASSERT _ord.cashback_recipient_id = _res AND _ord.cashback_total = 108, 'C/F 10% of 1080 to reseller (not 120)';
  ASSERT (SELECT wholesale_applied AND unit_price = 90 AND regular_unit_price = 100 AND cashback_amount = 108 FROM public.retail_order_items WHERE order_id = _ord.id), 'B item snapshot';
  -- N + O: change price and cashback after order creation
  UPDATE public.retail_products SET price = 500, wholesale_price = 450, cashback_mode = 'fixed', cashback_value = 99 WHERE id = _pB;
  UPDATE public.platform_settings SET retail_platform_fee_percent = 5 WHERE id = 1;
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.seller_total = 1080 AND _ord.platform_fee_percent = 1 AND _ord.platform_fee_amount = 10.80 AND _ord.cashback_total = 108 AND _ord.total = 1090.80, 'N/O order snapshot unchanged';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus0 - 1090.80, 'B buyer -1090.80';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0 + 972, 'B admin +972 (1080 - 108)';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _rg) = _res0 + 108, 'F reseller +108';
  ASSERT (SELECT fee_credits FROM public.retail_platform_fees WHERE order_id = _ord.id) = 10.80 AND (SELECT fee_percent FROM public.retail_platform_fees WHERE order_id = _ord.id) = 1, 'N/O settled with snapshot fee, not 5%';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no AND entry_kind = 'retail_cashback') = 1, 'C one cashback row';
  UPDATE public.platform_settings SET retail_platform_fee_percent = 1 WHERE id = 1;
  _cus0 := _cus0 - 1090.80; _adm0 := _adm0 + 972; _res0 := _res0 + 108;
  _debits := _debits + 1090.80; _admin_credits := _admin_credits + 972; _cb_credits := _cb_credits + 108; _fees := _fees + 10.80;

  -- ===== D: fixed cashback per unit via reseller =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pD, 'quantity', 3)), 'pickup', 'credit', NULL, NULL, _res);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.seller_total = 300 AND _ord.platform_fee_amount = 3 AND _ord.total = 303 AND _ord.cashback_total = 6, 'D fixed 2 x 3 = 6';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0 + 294 AND (SELECT balance FROM public.credit_accounts WHERE id = _rg) = _res0 + 6, 'D admin +294, reseller +6';
  _cus0 := _cus0 - 303; _adm0 := _adm0 + 294; _res0 := _res0 + 6;
  _debits := _debits + 303; _admin_credits := _admin_credits + 294; _cb_credits := _cb_credits + 6; _fees := _fees + 3;

  -- ===== K: cancellation before settlement =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pA, 'quantity', 2)), 'pickup', 'credit', NULL, NULL, _res);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus0 - 202, 'K hold taken';
  SELECT stock INTO _n FROM public.retail_products WHERE id = _pA;
  PERFORM public.cancel_retail_order(_ord.id);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'cancelled' AND _ord.refund_ledger_id IS NOT NULL AND _ord.settlement_ledger_id IS NULL AND _ord.cashback_ledger_id IS NULL, 'K cancelled, refunded, never settled';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.refund_ledger_id;
  ASSERT _l.amount = 202 AND _l.reverses_ledger_id = _ord.hold_ledger_id, 'K refund equals hold exactly';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus0, 'K buyer whole again';
  ASSERT (SELECT stock FROM public.retail_products WHERE id = _pA) = _n + 2, 'K stock restored';
  ASSERT (SELECT count(*) FROM public.retail_platform_fees WHERE order_id = _ord.id) = 0, 'K no fee reported';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0 AND (SELECT balance FROM public.credit_accounts WHERE id = _rg) = _res0, 'K no seller/cashback income';
  BEGIN
    PERFORM public.cancel_retail_order(_ord.id);
    RAISE EXCEPTION 'K2 must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'K2 must fail' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims', c_adm, true);
  BEGIN
    PERFORM public.retail_review_order(_ord.id, true, NULL);
    RAISE EXCEPTION 'K3 must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'K3 must fail' THEN RAISE; END IF; END;
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no) = 2, 'K exactly hold + one refund';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus0, 'K no second refund';
  _debits := _debits + 202; _refunds := _refunds + 202;

  -- ===== L + M: cancellation after settlement (approved is final; no refund path) =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pA, 'quantity', 1)), 'pickup', 'credit');
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_o.order_id, true, NULL);
  PERFORM set_config('request.jwt.claims', c_cus, true);
  BEGIN
    PERFORM public.cancel_retail_order(_o.order_id);
    RAISE EXCEPTION 'L must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'L must fail' THEN RAISE; END IF; END;
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'approved' AND _ord.refund_ledger_id IS NULL, 'L/M approved stays approved, no refund';
  BEGIN
    UPDATE public.retail_orders SET status = 'cancelled', refund_ledger_id = _ord.hold_ledger_id WHERE id = _ord.id;
    RAISE EXCEPTION 'M must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'M must fail' THEN RAISE; END IF; END;
  _cus0 := _cus0 - 101; _adm0 := _adm0 + 100; _debits := _debits + 101; _admin_credits := _admin_credits + 100; _fees := _fees + 1;
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus0 AND (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0, 'L/M balances';

  -- ===== G: subreseller never earns anything in Retail =====
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _sg) = _sub0, 'G subreseller balance unchanged';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = _sub AND entry_kind IN ('retail_cashback','retail_settlement')), 'G no subreseller retail rows';

  -- ===== P: platform fee reporting only; Super Admin gets nothing =====
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _sag) = _sa0, 'P super admin wallet unchanged';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = _sa AND entry_kind IN ('retail_hold','retail_settlement','retail_cashback','retail_refund')), 'P no super admin retail ledger rows';
  ASSERT NOT EXISTS (SELECT 1 FROM public.retail_platform_fees f GROUP BY f.order_id HAVING count(*) > 1), 'P fee once per order';
  ASSERT (SELECT count(*) FROM public.retail_platform_fees f JOIN public.retail_orders o ON o.id = f.order_id WHERE o.status <> 'approved') = 0, 'P fees only on approved orders';

  -- ===== Q: no Retail points path =====
  ASSERT (SELECT count(*) FROM public.points_ledger) = _points0, 'Q no points rows created by Retail';

  -- ===== reconciliation over the whole Universe run =====
  ASSERT _debits = _admin_credits + _cb_credits + _fees + _refunds, 'RECONCILE: debits = admin + cashback + fees + refunds';
  ASSERT (SELECT coalesce(sum(amount),0) FROM public.credit_ledger WHERE entry_kind = 'retail_hold' AND user_id = _cus AND created_at >= now()) = _debits, 'ledger debits match';
  ASSERT (SELECT coalesce(sum(amount),0) FROM public.credit_ledger WHERE entry_kind IN ('retail_settlement','retail_cashback','retail_refund') AND ecosystem_id = _u AND created_at >= now()) + (SELECT coalesce(sum(fee_credits),0) FROM public.retail_platform_fees WHERE ecosystem_id = _u AND created_at >= now()) = _debits, 'ledger credits + fees = debits (no coins created)';
  ASSERT _cus0 = (SELECT balance FROM public.credit_accounts WHERE id = _cg), 'buyer end balance';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) - _adm0 = 0, 'admin end balance';

  -- ===== R: New Generation isolation =====
  SELECT balance INTO _c2s0 FROM public.credit_accounts WHERE id = _c2s;
  SELECT balance INTO _c2g0 FROM public.credit_accounts WHERE id = _c2g;
  SELECT balance INTO _as0  FROM public.credit_accounts WHERE id = _as;
  PERFORM set_config('request.jwt.claims', c_cus2, true);
  BEGIN
    PERFORM public.retail_place_order(_s, jsonb_build_array(jsonb_build_object('product_id', _pN, 'quantity', 12)), 'pickup', 'credit', NULL, NULL, _res);
    RAISE EXCEPTION 'R1 must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'R1 must fail' THEN RAISE; END IF; END;
  SELECT * INTO _o FROM public.retail_place_order(_s, jsonb_build_array(jsonb_build_object('product_id', _pN, 'quantity', 12)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.wallet_account_id = _c2s AND _ord.total = 1090.80 AND _ord.cashback_total = 0, 'R NG hold on SHOP wallet, same pricing, no storefront cashback';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _c2s) = _c2s0 - 1090.80, 'R NG buyer shop wallet -1090.80';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _as) = _as0 + 1080, 'R NG admin SHOP wallet +1080';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _c2g) = _c2g0, 'R NG buyer global wallet untouched';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0, 'R NG never touches admin global wallet';

  UPDATE public.platform_settings SET retail_platform_fee_percent = _prev_fee WHERE id = 1;
  RAISE EXCEPTION 'RETAIL_R4_TESTS_PASSED';
END $$;
