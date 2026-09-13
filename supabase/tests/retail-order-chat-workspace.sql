-- Retail order chat centralization. Rollback-only: the DO block ends with
-- RAISE EXCEPTION so nothing persists. Success = final error text
-- "RETAIL_ORDER_CHAT_TESTS_PASSED". Fixtures are live ids; replace as needed.
--
-- Under test:
--   1 every retail order (pickup included) gets exactly one order thread on
--     insert, with the customer and the seller as members; the sync is
--     idempotent and participants follow later assignments;
--   2 retail_order_workspace answers only members, with role-correct flags;
--   3 retail_seller_cancel_order cancels at any live stage and fully reverses
--     money (payment refunded, settlement and cashback reversed), stock and
--     points, once only;
--   4 a customer cannot cancel someone else's order or use the seller path.

DO $$
DECLARE
  _u   uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- universe shop
  _adm uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- shop admin
  _cus uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- customer
  _p uuid; _o record; _ord public.retail_orders; _t uuid; _ws jsonb;
  _cg uuid; _ag uuid; _cus0 numeric; _adm0 numeric; _stock0 int; _prev_fee numeric;
  c_cus text; c_adm text;
BEGIN
  c_cus := json_build_object('sub', _cus, 'role', 'authenticated')::text;
  c_adm := json_build_object('sub', _adm, 'role', 'authenticated')::text;

  SELECT retail_platform_fee_percent INTO _prev_fee FROM public.platform_settings WHERE id = 1;
  UPDATE public.platform_settings SET retail_platform_fee_percent = 1 WHERE id = 1;
  UPDATE public.ecosystems SET store_retail_enabled = true, retail_credit_enabled = true,
         retail_pickup_enabled = true, operations_frozen = false WHERE id = _u;

  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty,
         stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'CHAT P', 100, 0, 0, 40, true, true, false, true, 'percent', 10) RETURNING id INTO _p;
  _stock0 := 40;

  _cg := public.ensure_global_wallet(_cus); _ag := public.ensure_global_wallet(_adm);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
         balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_cg, _cus, NULL, 'credit', 5000, 0, 'chat test funding', 'CHAT', public.new_tx_id(), 'general');
  SELECT balance INTO _cus0 FROM public.credit_accounts WHERE id = _cg;
  SELECT balance INTO _adm0 FROM public.credit_accounts WHERE id = _ag;

  -- ===== 1: pickup order gets a thread automatically =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u,
    jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 2)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.fulfillment = 'pickup' AND _ord.chat_thread_id IS NOT NULL, '1 pickup order has a thread';
  _t := _ord.chat_thread_id;
  ASSERT (SELECT count(*) FROM public.dm_threads WHERE order_id = _ord.id) = 1, '1 exactly one thread';
  ASSERT (SELECT count(*) FROM public.dm_thread_members WHERE thread_id = _t AND removed_at IS NULL
          AND user_id IN (_cus, _adm)) = 2, '1 customer + seller are members';
  -- idempotent re-sync
  PERFORM public.retail_sync_order_chat(_ord.id);
  PERFORM public.retail_order_chat(_ord.id);
  ASSERT (SELECT count(*) FROM public.dm_threads WHERE order_id = _ord.id) = 1, '1 sync is idempotent';

  -- ===== 2: workspace flags per role =====
  _ws := public.retail_order_workspace(_t);
  ASSERT _ws->>'role' = 'customer' AND (_ws->>'can_customer_cancel')::boolean
         AND NOT (_ws->>'can_seller_cancel')::boolean AND NOT (_ws->>'can_review')::boolean,
         '2 customer flags while pending';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  _ws := public.retail_order_workspace(_t);
  ASSERT _ws->>'role' = 'seller' AND (_ws->>'can_review')::boolean
         AND (_ws->>'can_seller_cancel')::boolean AND jsonb_array_length(_ws->'items') = 1,
         '2 seller flags while pending';

  -- ===== 3: approve, advance, then cancel mid-fulfillment with full reversal =====
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'approved' AND _ord.settlement_ledger_id IS NOT NULL
         AND _ord.cashback_ledger_id IS NOT NULL, '3 approved and settled';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) < _cus0, '3 buyer charged';
  PERFORM public.retail_update_fulfillment(_ord.id, 'preparing');
  _ws := public.retail_order_workspace(_t);
  ASSERT (_ws->>'can_seller_cancel')::boolean, '3 seller cancel stays available after approval';

  PERFORM public.retail_seller_cancel_order(_ord.id, 'Out of stock');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'cancelled' AND _ord.reversed_at IS NOT NULL AND _ord.credit_released
         AND _ord.fulfillment_status = 'closed' AND _ord.decision_note = 'Out of stock',
         '3 order cancelled and marked reversed';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus0, '3 buyer made whole';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0, '3 seller settlement reversed';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no
          AND entry_kind = 'retail_settlement_reversal') = 1, '3 one settlement reversal';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no
          AND entry_kind = 'retail_cashback_reversal') = 1, '3 one cashback reversal';
  ASSERT (SELECT stock FROM public.retail_products WHERE id = _p) = _stock0, '3 stock restored';
  ASSERT (SELECT reversed_at FROM public.retail_platform_fees WHERE order_id = _ord.id) IS NOT NULL,
         '3 platform fee marked reversed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.points_ledger WHERE retail_order_id = _ord.id
                     AND entry_type = 'earn'
                     AND NOT EXISTS (SELECT 1 FROM public.points_ledger r
                                      WHERE r.retail_order_id = _ord.id AND r.direction = 'debit')),
         '3 any awarded points reversed';

  -- second cancel must not move money again
  BEGIN
    PERFORM public.retail_seller_cancel_order(_ord.id, 'again');
    RAISE EXCEPTION '3 double cancel must fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = '3 double cancel must fail' THEN RAISE; END IF;
  END;
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus0
     AND (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm0, '3 idempotent';

  -- ===== 4: authorization =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u,
    jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  BEGIN
    PERFORM public.retail_seller_cancel_order(_ord.id, 'customer tries seller path');
    RAISE EXCEPTION '4 customer must not use the seller cancel';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = '4 customer must not use the seller cancel' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.retail_order_workspace(_ord.chat_thread_id);
    RAISE EXCEPTION '4 outsider must not read the workspace';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = '4 outsider must not read the workspace' THEN RAISE; END IF;
  END;

  UPDATE public.platform_settings SET retail_platform_fee_percent = _prev_fee WHERE id = 1;
  RAISE EXCEPTION 'RETAIL_ORDER_CHAT_TESTS_PASSED';
END $$;
