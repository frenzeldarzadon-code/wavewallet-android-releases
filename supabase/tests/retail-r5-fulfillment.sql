-- Retail R5 — fulfillment workflow (non-financial). Rollback-only: the DO block
-- ends with RAISE EXCEPTION so nothing persists. Success = final error text
-- "RETAIL_R5_TESTS_PASSED". Fixtures are live ids (same as R4).
--
-- Fulfillment: awaiting -> accepted -> preparing -> ready -> [out_for_delivery] -> delivered -> completed
--              rejected/cancelled -> closed
-- Matrix: A initial state, B seller progression (pickup + delivery), C invalid
-- transitions rejected, D customer isolation, E seller isolation, F final orders
-- immutable, G financial snapshot untouched, H zero ledger movement, I no delivery
-- fee/collector/CoH artefacts, J New Generation isolation.

DO $$
DECLARE
  _u    uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- Sagada Wave One-Stop-Shop (universe)
  _adm  uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- shop admin
  _cus  uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- universe customer
  _res  uuid := '0c10e602-c154-4e0f-bac1-0aadc642fee0'; -- reseller (storefront seller)
  _sub  uuid := 'fd9b863c-9c7c-4794-a35b-779e7d82e37b'; -- subreseller (never a retail seller)
  _s    uuid := '1ba85735-e5df-4fbe-bf5f-71dff985e824'; -- SW DEMO (New Generation)
  _cus2 uuid := '617ef79a-e3d6-4a6f-9dcc-b09414a35336'; -- NG customer
  _p uuid; _pN uuid; _o record; _ord public.retail_orders; _snap jsonb; _snap2 jsonb;
  _cg uuid; _c2s uuid;
  _ledger0 bigint; _acct0 jsonb; _fees0 bigint; _n int; _ok boolean;
  c_cus text; c_adm text; c_res text; c_sub text; c_cus2 text;
BEGIN
  c_cus  := json_build_object('sub', _cus,  'role', 'authenticated')::text;
  c_adm  := json_build_object('sub', _adm,  'role', 'authenticated')::text;
  c_res  := json_build_object('sub', _res,  'role', 'authenticated')::text;
  c_sub  := json_build_object('sub', _sub,  'role', 'authenticated')::text;
  c_cus2 := json_build_object('sub', _cus2, 'role', 'authenticated')::text;

  UPDATE public.ecosystems SET store_retail_enabled = true, retail_credit_enabled = true, retail_cash_enabled = true,
         retail_pickup_enabled = true, retail_delivery_enabled = true, operations_frozen = false WHERE id IN (_u, _s);
  INSERT INTO public.shop_seller_authorizations (ecosystem_id, user_id, active) VALUES (_u, _res, true)
  ON CONFLICT (ecosystem_id, user_id) DO UPDATE SET active = true;
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R5 P', 100, 0, 0, 100, true, true, false, true, 'percent', 10) RETURNING id INTO _p;
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_s, 'R5 NG', 100, 0, 0, 100, true, true, false, true, 'disabled', 0) RETURNING id INTO _pN;
  _cg := public.ensure_global_wallet(_cus);
  _c2s := public.ensure_credit_account(_cus2, _s);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_cg, _cus, NULL, 'credit', 5000, 0, 'R5 funding', 'R5', public.new_tx_id(), 'general'),
         (_c2s, _cus2, _s, 'credit', 2000, 0, 'R5 funding', 'R5', public.new_tx_id(), 'general');

  -- ===== A: new order enters 'awaiting' =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 2)), 'pickup', 'credit', NULL, NULL, _res);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'pending' AND _ord.fulfillment_status = 'awaiting' AND _ord.seller_id = _res, 'A initial state';
  -- customer cannot advance a pending order; seller cannot skip review
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'preparing'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'A customer cannot advance pending order';
  PERFORM set_config('request.jwt.claims', c_res, true);
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'preparing'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'A seller cannot advance before approval';

  -- approve (R4 path) -> accepted; snapshot financials and ledger state
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.status = 'approved' AND _ord.fulfillment_status = 'accepted' AND _ord.fulfillment_updated_at IS NOT NULL, 'A approved -> accepted';
  _snap := to_jsonb(_ord) - 'fulfillment_status' - 'fulfillment_updated_at' - 'delivered_at' - 'completed_at' - 'updated_at';
  SELECT count(*) INTO _ledger0 FROM public.credit_ledger;
  SELECT count(*) INTO _fees0 FROM public.retail_platform_fees;
  SELECT jsonb_agg(jsonb_build_object('id', id, 'b', balance) ORDER BY id) INTO _acct0 FROM public.credit_accounts WHERE user_id IN (_cus, _adm, _res, _sub, _cus2);

  -- ===== C: invalid transitions (skip, backward, customer-delivered) =====
  PERFORM set_config('request.jwt.claims', c_res, true);
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'ready'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C skip accepted->ready rejected';
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'out_for_delivery'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C out_for_delivery on pickup rejected';
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'completed'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C seller cannot complete';
  PERFORM set_config('request.jwt.claims', c_cus, true);
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'preparing'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C customer cannot advance';
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'delivered'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C customer cannot mark delivered';
  -- subreseller is not a retail seller
  PERFORM set_config('request.jwt.claims', c_sub, true);
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'preparing'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C subreseller cannot touch order';
  -- direct row-level skip / backward moves rejected by guard
  BEGIN UPDATE public.retail_orders SET fulfillment_status = 'delivered' WHERE id = _ord.id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C guard blocks skip';
  BEGIN UPDATE public.retail_orders SET fulfillment_status = 'awaiting' WHERE id = _ord.id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C guard blocks backward';
  BEGIN UPDATE public.retail_orders SET delivered_at = now() WHERE id = _ord.id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C timestamps write-once';

  -- ===== B: reseller storefront seller progresses pickup order; customer confirms =====
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_update_fulfillment(_ord.id, 'preparing');
  PERFORM public.retail_update_fulfillment(_ord.id, 'ready');
  PERFORM public.retail_update_fulfillment(_ord.id, 'delivered');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.fulfillment_status = 'delivered' AND _ord.delivered_at IS NOT NULL AND _ord.completed_at IS NULL, 'B seller reached delivered';
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'preparing'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'C backward via RPC rejected';
  PERFORM set_config('request.jwt.claims', c_cus, true);
  PERFORM public.retail_update_fulfillment(_ord.id, 'completed');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.fulfillment_status = 'completed' AND _ord.completed_at IS NOT NULL AND _ord.status = 'approved', 'B customer completed';
  -- notifications recorded for the customer
  SELECT count(*) INTO _n FROM public.member_notifications WHERE user_id = _cus AND title LIKE '%' || _ord.order_no || '%';
  ASSERT _n >= 3, 'B customer notified: ' || _n;

  -- ===== F: completed orders cannot be changed =====
  PERFORM set_config('request.jwt.claims', c_adm, true);
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'preparing'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'F completed via RPC';
  BEGIN UPDATE public.retail_orders SET fulfillment_status = 'delivered' WHERE id = _ord.id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'F completed via row';
  BEGIN UPDATE public.retail_orders SET status = 'cancelled' WHERE id = _ord.id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'F completed cannot cancel';

  -- ===== G + H: financial snapshot and ledger untouched by fulfillment =====
  _snap2 := to_jsonb(_ord) - 'fulfillment_status' - 'fulfillment_updated_at' - 'delivered_at' - 'completed_at' - 'updated_at';
  ASSERT _snap = _snap2, 'G snapshot changed';
  ASSERT (SELECT count(*) FROM public.credit_ledger) = _ledger0, 'H zero ledger rows';
  ASSERT (SELECT count(*) FROM public.retail_platform_fees) = _fees0, 'H zero fee rows';
  ASSERT (SELECT jsonb_agg(jsonb_build_object('id', id, 'b', balance) ORDER BY id) FROM public.credit_accounts WHERE user_id IN (_cus, _adm, _res, _sub, _cus2)) = _acct0, 'H balances unchanged';
  -- row-level attempt to alter price under cover of a fulfillment change
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'delivery', 'cash', '12 Main St', NULL, NULL);
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_o.order_id, true, NULL);
  BEGIN UPDATE public.retail_orders SET fulfillment_status = 'preparing', total = 1 WHERE id = _o.order_id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'G price cannot ride along with fulfillment';
  BEGIN UPDATE public.retail_orders SET fulfillment_status = 'preparing', cashback_total = 99 WHERE id = _o.order_id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'G cashback cannot ride along';

  -- ===== B2: delivery order requires out_for_delivery; admin path =====
  PERFORM public.retail_update_fulfillment(_o.order_id, 'preparing');
  PERFORM public.retail_update_fulfillment(_o.order_id, 'ready');
  BEGIN PERFORM public.retail_update_fulfillment(_o.order_id, 'delivered'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'B2 delivery cannot skip out_for_delivery';
  PERFORM public.retail_update_fulfillment(_o.order_id, 'out_for_delivery');
  PERFORM public.retail_update_fulfillment(_o.order_id, 'delivered');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.fulfillment_status = 'delivered', 'B2 delivered';
  -- admin may close out a stuck hand-over on the customer's behalf
  PERFORM public.retail_update_fulfillment(_o.order_id, 'completed');
  ASSERT (SELECT fulfillment_status FROM public.retail_orders WHERE id = _o.order_id) = 'completed', 'B2 admin completed';
  ASSERT (SELECT count(*) FROM public.credit_ledger) = _ledger0, 'H cash order moved no coins';

  -- ===== F2: rejected / cancelled -> closed, immutable =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'pickup', 'cash');
  PERFORM public.cancel_retail_order(_o.order_id);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.status = 'cancelled' AND _ord.fulfillment_status = 'closed', 'F2 cancelled -> closed';
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'preparing'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'F2 closed immutable';
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'pickup', 'cash');
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_o.order_id, false, 'no');
  ASSERT (SELECT fulfillment_status FROM public.retail_orders WHERE id = _o.order_id) = 'closed', 'F2 rejected -> closed';

  -- ===== D + E: visibility =====
  PERFORM set_config('request.jwt.claims', c_cus2, true);
  ASSERT (SELECT count(*) FROM public.my_retail_orders(_u)) = 0, 'D other customer sees nothing';
  PERFORM set_config('request.jwt.claims', c_cus, true);
  ASSERT (SELECT count(*) FROM public.my_retail_orders(_u) WHERE shop_name IS NOT NULL) >= 4, 'D customer sees own orders with shop name';
  ASSERT (SELECT count(*) FROM public.list_retail_orders(_u, 'all')) = 0, 'E customer is not a seller';
  PERFORM set_config('request.jwt.claims', c_res, true);
  ASSERT (SELECT count(*) FROM public.list_retail_orders(_u, 'all')) = 1
     AND (SELECT bool_and(seller_id = _res) FROM public.list_retail_orders(_u, 'all')), 'E reseller sees only attributed orders';
  PERFORM set_config('request.jwt.claims', c_sub, true);
  ASSERT (SELECT count(*) FROM public.list_retail_orders(_u, 'all')) = 0, 'E subreseller sees nothing';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  ASSERT (SELECT count(*) FROM public.list_retail_orders(_u, 'all')) >= 4, 'E admin sees all';

  -- ===== I: no delivery-fee / collector / cash-on-hand artefacts =====
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='retail_orders'
                     AND column_name ~ '(collector|courier|delivery_fee|cash_on_hand|coh_)'), 'I no R6 columns';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name ~ '(collector|delivery_fee|cash_on_hand)'), 'I no R6 tables';

  -- ===== J: New Generation isolation =====
  PERFORM set_config('request.jwt.claims', c_cus2, true);
  SELECT * INTO _o FROM public.retail_place_order(_s, jsonb_build_array(jsonb_build_object('product_id', _pN, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.wallet_account_id = _c2s AND _ord.fulfillment_status = 'awaiting', 'J NG order uses shop wallet';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  PERFORM public.retail_update_fulfillment(_ord.id, 'preparing');
  ASSERT (SELECT fulfillment_status FROM public.retail_orders WHERE id = _ord.id) = 'preparing', 'J NG fulfillment works';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE ecosystem_id IS NULL AND user_id = _cus2) = 0, 'J NG customer never touched global wallet';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE entry_kind IN ('retail_settlement','retail_cashback') AND reference = _ord.order_no AND ecosystem_id <> _s) = 0, 'J NG settlement stays in shop';

  RAISE EXCEPTION 'RETAIL_R5_TESTS_PASSED';
END $$;
