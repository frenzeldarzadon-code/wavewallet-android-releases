-- Retail Phase R3 — product-level cashback foundation.
--
-- Self-contained rollback test: one DO block that ends with RAISE EXCEPTION, so
-- nothing persists. Success is the final error text "RETAIL_R3_TESTS_PASSED".
-- Replace the ids with rows from the target database.
--
-- Formulas under test (all on the ACTUAL seller amount paid for the line):
--   percent : cashback = round(seller_line × value / 100, 2)   capped at seller_line
--   fixed   : cashback = round(value × qty, 2)                 capped at seller_line
--   disabled: 0
--   fee     = round(seller_line × fee% / 100, 2)   (reporting only, never a wallet credit)
--   settlement: admin credit = seller_total − cashback_total ; earner credit = cashback_total
--   reconciliation: buyer debit = admin credit + cashback credit + fee (retained, no wallet)

DO $$
DECLARE
  _u    uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- Sagada Wave One-Stop-Shop (universe)
  _adm  uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- shop admin (both shops)
  _cus  uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- universe customer
  _sel  uuid := '61553ac3-2ffa-47b1-9231-893be7b92eb9'; -- authorized storefront seller (reseller)
  _sa   uuid := '4f8c8e50-16f6-441d-9619-121c72ba3387'; -- super admin
  _s    uuid := '1ba85735-e5df-4fbe-bf5f-71dff985e824'; -- SW DEMO (subscription / New Generation)
  _cus2 uuid := '617ef79a-e3d6-4a6f-9dcc-b09414a35336'; -- subscription customer
  _pp uuid; _pf uuid; _pd uuid; _pw uuid; _pn uuid;
  _o record; _ord public.retail_orders; _it public.retail_order_items; _l public.credit_ledger;
  _cg uuid; _ag uuid; _sg uuid; _c2s uuid; _as uuid; _c2g uuid;
  _cg0 numeric; _ag0 numeric; _sg0 numeric; _c2g0 numeric; _as0 numeric;
  _sa_rows int; _cb_rows int; _prev_fee numeric; _n int;
  claims_cus text; claims_adm text; claims_cus2 text;
BEGIN
  claims_cus  := json_build_object('sub', _cus, 'role', 'authenticated')::text;
  claims_adm  := json_build_object('sub', _adm, 'role', 'authenticated')::text;
  claims_cus2 := json_build_object('sub', _cus2, 'role', 'authenticated')::text;
  ASSERT public.is_universe_shop(_u) AND NOT public.is_universe_shop(_s), 'fixture shops';

  SELECT retail_platform_fee_percent INTO _prev_fee FROM public.platform_settings WHERE id = 1;
  UPDATE public.platform_settings SET retail_platform_fee_percent = 1 WHERE id = 1;
  UPDATE public.ecosystems SET store_retail_enabled = true, retail_credit_enabled = true,
         retail_cash_enabled = true, retail_pickup_enabled = true, operations_frozen = false
   WHERE id IN (_u, _s);

  -- products: percent 10%, fixed 2/unit, disabled, wholesale+percent, NG percent
  INSERT INTO public.retail_products (ecosystem_id, name, price, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R3 pct', 100, 100, true, true, false, true, 'percent', 10) RETURNING id INTO _pp;
  INSERT INTO public.retail_products (ecosystem_id, name, price, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R3 fixed', 100, 100, true, true, false, true, 'fixed', 2) RETURNING id INTO _pf;
  INSERT INTO public.retail_products (ecosystem_id, name, price, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R3 off', 100, 100, true, true, false, true, 'disabled', 50) RETURNING id INTO _pd;
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R3 bulk', 100, 90, 12, 100, true, true, false, true, 'percent', 10) RETURNING id INTO _pw;
  INSERT INTO public.retail_products (ecosystem_id, name, price, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_s, 'R3 NG', 100, 100, true, true, false, true, 'percent', 10) RETURNING id INTO _pn;

  _cg := public.ensure_global_wallet(_cus); _ag := public.ensure_global_wallet(_adm); _sg := public.ensure_global_wallet(_sel);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_cg, _cus, NULL, 'credit', 10000, 0, 'R3 funding', 'R3', public.new_tx_id(), 'general');
  SELECT count(*) INTO _sa_rows FROM public.credit_ledger WHERE user_id = _sa;

  -- ---------- A + G. percent cashback, storefront seller attribution ----------
  SELECT balance INTO _cg0 FROM public.credit_accounts WHERE id = _cg;
  SELECT balance INTO _ag0 FROM public.credit_accounts WHERE id = _ag;
  SELECT balance INTO _sg0 FROM public.credit_accounts WHERE id = _sg;
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pp, 'quantity', 1)), 'pickup', 'credit', NULL, NULL, _sel);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.total = 101 AND _ord.seller_total = 100 AND _ord.platform_fee_amount = 1, 'A pricing';
  ASSERT _ord.seller_id = _sel AND _ord.cashback_recipient_id = _sel AND _ord.cashback_total = 10, 'A: 10% of 100 to the storefront seller';
  SELECT * INTO _it FROM public.retail_order_items WHERE order_id = _ord.id;
  ASSERT _it.cashback_mode = 'percent' AND _it.cashback_value = 10 AND _it.cashback_amount = 10, 'A item snapshot';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cg0 - 101, 'A: buyer debited exactly once (101)';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _sg) = _sg0, 'A: no cashback before approval';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.status = 'approved' AND _ord.settlement_ledger_id IS NOT NULL AND _ord.cashback_ledger_id IS NOT NULL, 'A approved with both pointers';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id;
  ASSERT _l.amount = 90 AND _l.account_id = _ag, 'A: admin receives seller amount minus cashback (100 − 10)';
  SELECT * INTO _l FROM public.credit_ledger WHERE id = _ord.cashback_ledger_id;
  ASSERT _l.amount = 10 AND _l.account_id = _sg AND _l.user_id = _sel AND _l.entry_kind = 'retail_cashback' AND _l.tx_id = _ord.credit_hold_tx || '-CB', 'G: cashback to the storefront seller''s GLOBAL wallet';
  -- M. reconciliation: 101 debit = 90 admin + 10 seller + 1 fee (retained, no wallet)
  ASSERT (SELECT sum(CASE direction WHEN 'debit' THEN amount ELSE -amount END)
            FROM public.credit_ledger WHERE tx_id LIKE _ord.credit_hold_tx || '%') = 1, 'M: net ledger movement equals the retained fee only';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE tx_id LIKE _ord.credit_hold_tx || '%') = 3, 'M: exactly hold + settlement + cashback rows';
  ASSERT (SELECT fee_credits FROM public.retail_platform_fees WHERE order_id = _ord.id) = 1, 'F: fee recorded once, 1.00, not reduced by cashback';

  -- ---------- H. retry cannot create a second cashback ----------
  BEGIN
    PERFORM public.retail_review_order(_ord.id, true, NULL);
    RAISE EXCEPTION 'retry must fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'retry must fail' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
    VALUES (_sg, _sel, _u, 'credit', 10, 0, 'dup', 'dup', _ord.credit_hold_tx || '-CB', 'retail_cashback');
    RAISE EXCEPTION 'duplicate tx must fail';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  SELECT count(*) INTO _cb_rows FROM public.credit_ledger WHERE user_id = _sel AND entry_kind = 'retail_cashback' AND reference = _ord.order_no;
  ASSERT _cb_rows = 1, 'H: exactly one cashback credit';

  -- ---------- J. product setting change never alters the order snapshot ----------
  UPDATE public.retail_products SET cashback_mode = 'fixed', cashback_value = 50 WHERE id = _pp;
  SELECT * INTO _it FROM public.retail_order_items WHERE order_id = _ord.id;
  ASSERT _it.cashback_mode = 'percent' AND _it.cashback_value = 10 AND _it.cashback_amount = 10, 'J snapshot intact';
  ASSERT (SELECT cashback_total FROM public.retail_orders WHERE id = _ord.id) = 10, 'J order intact';

  -- ---------- B. fixed cashback ----------
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pf, 'quantity', 3)), 'pickup', 'credit', NULL, NULL, _sel);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.cashback_total = 6 AND _ord.seller_total = 300 AND _ord.total = 303, 'B: fixed 2 × 3 = 6';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT (SELECT amount FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id) = 294, 'B admin 300 − 6';
  ASSERT (SELECT amount FROM public.credit_ledger WHERE id = _ord.cashback_ledger_id) = 6, 'B cashback 6';

  -- ---------- C. disabled cashback ----------
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pd, 'quantity', 2)), 'pickup', 'credit', NULL, NULL, _sel);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.cashback_total = 0, 'C: disabled → 0 even with a value set';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.cashback_ledger_id IS NULL AND (SELECT amount FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id) = 200, 'C: admin gets full 200, no cashback row';

  -- ---------- D + E. wholesale vs regular base ----------
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pw, 'quantity', 12)), 'pickup', 'credit', NULL, NULL, _sel);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  SELECT * INTO _it FROM public.retail_order_items WHERE order_id = _ord.id;
  ASSERT _it.wholesale_applied AND _it.seller_line_total = 1080, 'D wholesale applied';
  ASSERT _it.cashback_amount = 108, 'D: 10% of the 1080 actually paid (never 120 of the regular 1200)';
  ASSERT _ord.platform_fee_amount = 10.80 AND _ord.total = 1090.80, 'D fee on 1080; fee not in cashback base';
  PERFORM public.cancel_retail_order(_ord.id);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pw, 'quantity', 11)), 'pickup', 'credit', NULL, NULL, _sel);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.cashback_total = 110 AND _ord.seller_total = 1100, 'E: below threshold → 10% of 1100';
  PERFORM public.cancel_retail_order(_ord.id);

  -- ---------- I. cancellation / rejection: refund once, no cashback ----------
  SELECT balance INTO _cg0 FROM public.credit_accounts WHERE id = _cg;
  SELECT balance INTO _sg0 FROM public.credit_accounts WHERE id = _sg;
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pp, 'quantity', 1)), 'pickup', 'credit', NULL, NULL, _sel);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, false, 'no');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.status = 'rejected' AND _ord.cashback_ledger_id IS NULL, 'I: rejected, no cashback';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cg0, 'I: buyer refunded exactly the debit';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _sg) = _sg0, 'I: seller untouched';
  ASSERT public.retail_refund_hold(_ord, _adm) IS NULL, 'I: second refund impossible';
  BEGIN
    PERFORM set_config('request.jwt.claims', claims_cus, true);
    PERFORM public.cancel_retail_order(_ord.id);
    RAISE EXCEPTION 'cancel after reject must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'cancel after reject must fail' THEN RAISE; END IF; END;

  -- ---------- no seller: direct-shop behaviour, admin keeps everything ----------
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pp, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.cashback_recipient_id IS NULL AND _ord.cashback_total = 0, 'no storefront → no cashback';
  PERFORM public.cancel_retail_order(_ord.id);
  -- cash order: no coins move, no coin cashback
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pp, 'quantity', 1)), 'pickup', 'cash', NULL, NULL, _sel);
  ASSERT (SELECT cashback_total FROM public.retail_orders WHERE id = _o.order_id) = 0, 'cash order → no coin cashback';
  -- unauthorized seller rejected
  BEGIN
    PERFORM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _pp, 'quantity', 1)), 'pickup', 'credit', NULL, NULL, _cus2);
    RAISE EXCEPTION 'unauthorized seller must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'unauthorized seller must fail' THEN RAISE; END IF; END;

  -- ---------- K. super admin never receives fee or cashback ----------
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE user_id = _sa) = _sa_rows, 'K: no super admin wallet credit';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE tx_id LIKE '%-F'), 'K: platform fee is never a ledger row';

  -- ---------- L. New Generation: shop wallet only; seller storefronts rejected ----------
  _c2s := public.ensure_credit_account(_cus2, _s); _c2g := public.ensure_global_wallet(_cus2); _as := public.ensure_credit_account(_adm, _s);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_c2s, _cus2, _s, 'credit', 1000, 0, 'R3 NG funding', 'R3', public.new_tx_id(), 'general');
  SELECT balance INTO _c2g0 FROM public.credit_accounts WHERE id = _c2g;
  SELECT balance INTO _ag0 FROM public.credit_accounts WHERE id = _ag;
  PERFORM set_config('request.jwt.claims', claims_cus2, true);
  BEGIN
    PERFORM public.retail_place_order(_s, jsonb_build_array(jsonb_build_object('product_id', _pn, 'quantity', 1)), 'pickup', 'credit', NULL, NULL, _sel);
    RAISE EXCEPTION 'NG seller must fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'NG seller must fail' THEN RAISE; END IF; END;
  SELECT * INTO _o FROM public.retail_place_order(_s, jsonb_build_array(jsonb_build_object('product_id', _pn, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.wallet_account_id = _c2s AND _ord.cashback_total = 0, 'L: NG hold on shop wallet, customer buyer earns nothing';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT (SELECT account_id FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id) = _as, 'L: settlement to admin SHOP wallet';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _c2g) = _c2g0, 'L: global wallet untouched';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _ag0, 'L: admin global wallet untouched';

  -- ---------- M. global reconciliation over all R3 orders ----------
  SELECT count(*) INTO _n FROM public.credit_ledger l
   WHERE l.entry_kind = 'retail_cashback'
     AND NOT EXISTS (SELECT 1 FROM public.retail_orders o WHERE o.cashback_ledger_id = l.id AND o.status = 'approved' AND o.payment_method = 'credit');
  ASSERT _n = 0, 'M: every cashback credit belongs to exactly one approved coin order';
  ASSERT (SELECT count(*) FROM (SELECT tx_id FROM public.credit_ledger WHERE entry_kind = 'retail_cashback' GROUP BY tx_id HAVING count(*) > 1) d) = 0, 'M: cashback tx ids unique';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.retail_orders o
     WHERE o.status = 'approved' AND o.payment_method = 'credit'
       AND o.total <> coalesce((SELECT amount FROM public.credit_ledger WHERE id = o.settlement_ledger_id), 0)
                    + coalesce((SELECT amount FROM public.credit_ledger WHERE id = o.cashback_ledger_id), 0)
                    + coalesce(o.platform_fee_amount, 0)), 'M: debit = admin + cashback + fee for every approved order';

  UPDATE public.platform_settings SET retail_platform_fee_percent = _prev_fee WHERE id = 1;
  RAISE EXCEPTION 'RETAIL_R3_TESTS_PASSED';
END $$;
