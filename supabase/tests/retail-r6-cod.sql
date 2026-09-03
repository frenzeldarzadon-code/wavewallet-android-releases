-- Retail R6 — Cash-on-Delivery collector float + order chat. Rollback-only: the DO
-- block ends with RAISE EXCEPTION so nothing persists. Success = final error text
-- "RETAIL_R6_TESTS_PASSED". Fixtures are live ids (same as R4/R5).
--
-- Locked example: seller cut 100 -> retail 101 (1 fee embedded), delivery 20,
-- customer total 121, collector float 121, cashback 10% -> 10 to storefront
-- reseller, split 70/30 -> delivery 14 / collector 6.
-- Reconciliation: 90 (admin) + 10 (cashback) + 1 (fee, reporting only) + 14 + 6 = 121.

DO $$
DECLARE
  _u    uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- universe shop
  _adm  uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- shop admin (settlement recipient)
  _cus  uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- customer
  _res  uuid := '0c10e602-c154-4e0f-bac1-0aadc642fee0'; -- reseller storefront seller
  _sub  uuid := 'fd9b863c-9c7c-4794-a35b-779e7d82e37b'; -- subreseller
  _col  uuid := '00507612-c147-4cc2-b9b0-2f823e88c823'; -- collector
  _del  uuid := '2516c24c-ed51-4135-90cb-1b6bdf98491d'; -- delivery person
  _s    uuid := '1ba85735-e5df-4fbe-bf5f-71dff985e824'; -- SW DEMO (New Generation)
  _cus2 uuid := '617ef79a-e3d6-4a6f-9dcc-b09414a35336'; -- NG customer
  _p uuid; _pN uuid; _o record; _q record; _ord public.retail_orders; _ord2 public.retail_orders; _ord3 public.retail_orders; _ord4 public.retail_orders; _ord5 public.retail_orders;
  _acct_col uuid; _acct_adm uuid; _acct_res uuid; _acct_del uuid; _acct_cus uuid; _c2s uuid;
  _b_col0 numeric; _b_adm0 numeric; _b_res0 numeric; _b_del0 numeric; _b_cus0 numeric; _b_sub0 numeric;
  _sum0 numeric; _ledger0 bigint; _fees0 bigint; _ok boolean; _n int; _tid uuid; _tid2 uuid; _snap jsonb; _sa uuid;
  _admbal numeric;
  c_cus text; c_adm text; c_res text; c_sub text; c_col text; c_del text; c_cus2 text; c_none text := '{}';
  bal numeric;
BEGIN
  c_cus := json_build_object('sub', _cus, 'role', 'authenticated')::text;
  c_adm := json_build_object('sub', _adm, 'role', 'authenticated')::text;
  c_res := json_build_object('sub', _res, 'role', 'authenticated')::text;
  c_sub := json_build_object('sub', _sub, 'role', 'authenticated')::text;
  c_col := json_build_object('sub', _col, 'role', 'authenticated')::text;
  c_del := json_build_object('sub', _del, 'role', 'authenticated')::text;
  c_cus2 := json_build_object('sub', _cus2, 'role', 'authenticated')::text;

  UPDATE public.ecosystems SET store_retail_enabled = true, retail_credit_enabled = true, retail_cash_enabled = true,
         retail_pickup_enabled = true, retail_delivery_enabled = true, operations_frozen = false WHERE id IN (_u, _s);
  UPDATE public.platform_settings SET retail_platform_fee_percent = 1 WHERE id = 1; -- live setting may be 0; the locked example needs 1%
  INSERT INTO public.shop_seller_authorizations (ecosystem_id, user_id, active) VALUES (_u, _res, true)
  ON CONFLICT (ecosystem_id, user_id) DO UPDATE SET active = true;
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R6 P', 100, 0, 0, 100, true, true, false, true, 'percent', 10) RETURNING id INTO _p;
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_s, 'R6 NG', 100, 0, 0, 100, true, true, false, true, 'disabled', 0) RETURNING id INTO _pN;
  _acct_col := public.ensure_global_wallet(_col); _acct_adm := public.ensure_global_wallet(_adm);
  _acct_res := public.ensure_global_wallet(_res); _acct_del := public.ensure_global_wallet(_del);
  _acct_cus := public.ensure_global_wallet(_cus); PERFORM public.ensure_global_wallet(_sub);
  _c2s := public.ensure_credit_account(_cus2, _s);
  SELECT id INTO _sa FROM public.user_roles WHERE role = 'super_admin' LIMIT 1;

  -- ===== Shop Admin split configuration (must total 100) =====
  PERFORM set_config('request.jwt.claims', c_res, true);
  BEGIN PERFORM public.update_retail_delivery_settings(_u, true, 20, 70, 30); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'CFG reseller cannot configure delivery';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  BEGIN PERFORM public.update_retail_delivery_settings(_u, true, 20, 60, 30); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'CFG split must equal 100';
  BEGIN PERFORM public.update_retail_delivery_settings(_s, true, 20, 70, 30); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'NG cannot enable COD';
  PERFORM public.update_retail_delivery_settings(_u, true, 20, 70, 30);
  SELECT * INTO _q FROM public.shop_store_settings(_u);
  ASSERT _q.cod_enabled AND _q.delivery_fee = 20 AND _q.delivery_pct = 70 AND _q.collector_pct = 30, 'CFG stored';

  -- ===== 4/5/6: quote — 101 product + 20 delivery = 121, fee 1 seller-side, never 1% on delivery =====
  SELECT * INTO _q FROM public.retail_cod_quote(_u, 100);
  ASSERT _q.platform_fee = 1 AND _q.delivery_fee = 20 AND _q.customer_total = 121, '5 quote 121: ' || _q.customer_total;
  -- seller (admin) with 0 available coins -> COD unavailable
  SELECT balance INTO _admbal FROM public.credit_accounts WHERE id = _acct_adm;
  IF _admbal > 0 THEN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
    VALUES (_acct_adm, _adm, NULL, 'debit', _admbal, 0, 'R6 drain', 'R6', public.new_tx_id(), 'general');
  END IF;
  SELECT * INTO _q FROM public.retail_cod_quote(_u, 100);
  ASSERT NOT _q.available, '4 seller with 0 coins: COD unavailable';
  PERFORM set_config('request.jwt.claims', c_cus, true);
  BEGIN SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'delivery', 'cod', '12 Main St', NULL, _res); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '4 COD order blocked while seller unfunded';
  -- fund admin with exactly the 1 coin fee requirement -> eligible
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_acct_adm, _adm, NULL, 'credit', 1, 0, 'R6 fee funding', 'R6', public.new_tx_id(), 'general');
  SELECT * INTO _q FROM public.retail_cod_quote(_u, 100);
  ASSERT _q.available, '4 seller funded with exactly 1 coin: COD available';

  -- snapshot balances / ledger state
  SELECT balance INTO _b_col0 FROM public.credit_accounts WHERE id = _acct_col;
  SELECT balance INTO _b_adm0 FROM public.credit_accounts WHERE id = _acct_adm;
  SELECT balance INTO _b_res0 FROM public.credit_accounts WHERE id = _acct_res;
  SELECT balance INTO _b_del0 FROM public.credit_accounts WHERE id = _acct_del;
  SELECT balance INTO _b_cus0 FROM public.credit_accounts WHERE id = _acct_cus;
  SELECT balance INTO _b_sub0 FROM public.credit_accounts WHERE user_id = _sub AND ecosystem_id IS NULL;
  SELECT coalesce(sum(balance),0) INTO _sum0 FROM public.credit_accounts;
  SELECT count(*) INTO _fees0 FROM public.retail_platform_fees;

  -- ===== 6/24: place COD order — total 101, delivery 20, NO customer coin debit =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  BEGIN SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'pickup', 'cod', NULL, NULL, _res); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'COD requires delivery';
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'delivery', 'cod', '12 Main St', 'ring bell', _res);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.payment_method = 'cod' AND _ord.seller_total = 100 AND _ord.platform_fee_amount = 1 AND _ord.total = 101
     AND _ord.delivery_fee = 20 AND _ord.delivery_split_delivery_pct = 70 AND _ord.delivery_split_collector_pct = 30
     AND _ord.cashback_total = 10 AND _ord.cashback_recipient_id = _res AND _ord.hold_ledger_id IS NULL, '6 order snapshot 101 + 20';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct_cus) = _b_cus0, '24 customer never debited';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no) = 0, '24 no ledger rows on placement';
  -- later admin change to fee/split does not alter the locked snapshot
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.update_retail_delivery_settings(_u, true, 99, 50, 50);
  ASSERT (SELECT delivery_fee FROM public.retail_orders WHERE id = _ord.id) = 20, 'snapshot locked vs admin change';
  PERFORM public.update_retail_delivery_settings(_u, true, 20, 70, 30);

  -- approve (no coin movement for COD) -> chat exists with seller + customer
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.status = 'approved' AND _ord.fulfillment_status = 'accepted' AND _ord.settlement_ledger_id IS NULL AND _ord.chat_thread_id IS NOT NULL, 'approved without settlement';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no) = 0, 'approval moved no coins';
  ASSERT (SELECT count(*) FROM public.dm_thread_members WHERE thread_id = _ord.chat_thread_id AND removed_at IS NULL) = 2, '8 chat seller+customer';
  -- (in-transaction now() makes the row look 'creating'; immutability is proven on the final order)
  BEGIN UPDATE public.retail_orders SET delivery_fee = 5 WHERE id = _ord.id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'delivery fee snapshot immutable';
  BEGIN UPDATE public.retail_orders SET delivery_split_delivery_pct = 50, delivery_split_collector_pct = 50 WHERE id = _ord.id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'split snapshot immutable';

  -- ===== 1/2/3/7: assignment — collector must have 121 AVAILABLE =====
  PERFORM set_config('request.jwt.claims', c_res, true);
  ASSERT (SELECT count(*) FROM public.retail_cod_assignees(_ord.id) WHERE user_id = _col AND collector_eligible) = 0, '3 collector with 0 coins not suggested';
  BEGIN PERFORM public.retail_cod_assign(_ord.id, false, _del, _col); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '2 insufficient collector blocked';
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_acct_col, _col, NULL, 'credit', 120, 0, 'R6 collector funding', 'R6', public.new_tx_id(), 'general');
  BEGIN PERFORM public.retail_cod_assign(_ord.id, false, _del, _col); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '2 collector with 120 < 121 blocked';
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_acct_col, _col, NULL, 'credit', 1, 0, 'R6 collector funding', 'R6', public.new_tx_id(), 'general');
  ASSERT (SELECT collector_eligible FROM public.retail_cod_assignees(_ord.id) WHERE user_id = _col), '3 collector with exactly 121 suggested';
  ASSERT (SELECT count(*) FROM public.retail_cod_assignees(_ord.id) WHERE user_id = _cus) = 0, '3 customer never a candidate';
  BEGIN PERFORM public.retail_cod_assign(_ord.id, false, _del, _cus); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'customer cannot be collector';
  PERFORM set_config('request.jwt.claims', c_sub, true);
  BEGIN PERFORM public.retail_cod_assign(_ord.id, false, _del, _col); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'subreseller cannot assign';
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_cod_assign(_ord.id, false, _del, _col);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.delivery_person_id = _del AND _ord.collector_id = _col AND _ord.collector_status = 'proposed' AND _ord.cod_hold_ledger_id IS NULL, '7 assigned, proposed, no hold yet';
  ASSERT (SELECT count(*) FROM public.dm_thread_members WHERE thread_id = _ord.chat_thread_id AND removed_at IS NULL) = 4, '32 chat has 4 participants';
  -- cannot go out for delivery before collector approval
  BEGIN PERFORM public.retail_update_fulfillment(_ord.id, 'preparing'); PERFORM public.retail_update_fulfillment(_ord.id, 'ready'); PERFORM public.retail_update_fulfillment(_ord.id, 'out_for_delivery'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'out_for_delivery blocked without hold';

  -- ===== 9/10: collector approval holds exactly 121 once; held coins unspendable =====
  PERFORM set_config('request.jwt.claims', c_del, true);
  BEGIN PERFORM public.retail_cod_collector_respond(_ord.id, true); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'only the collector can approve';
  PERFORM set_config('request.jwt.claims', c_col, true);
  PERFORM public.retail_cod_collector_respond(_ord.id, true);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.collector_status = 'approved' AND _ord.cod_hold_ledger_id IS NOT NULL AND _ord.cod_expected_cash = 121, '9 hold 121';
  ASSERT (SELECT amount FROM public.credit_ledger WHERE id = _ord.cod_hold_ledger_id) = 121
     AND (SELECT direction FROM public.credit_ledger WHERE id = _ord.cod_hold_ledger_id) = 'debit', '9 hold ledger is 121 debit';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct_col) = _b_col0, '10 collector available back to 0 (121 held)';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE entry_kind = 'retail_cod_hold' AND reference = _ord.order_no) = 1, '9 one hold';
  BEGIN PERFORM public.retail_cod_collector_respond(_ord.id, true); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '9 duplicate approval blocked';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE entry_kind = 'retail_cod_hold' AND reference = _ord.order_no) = 1, '9 still one hold';
  -- held coins cannot be spent (any debit against 0 available fails)
  BEGIN INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
        VALUES (_acct_col, _col, NULL, 'debit', 1, 0, 'spend attempt', 'R6', public.new_tx_id(), 'general'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '10 held coins unspendable';
  ASSERT (SELECT public.retail_cod_held_total()) = 121, '10 held total shows 121';
  -- collector cannot be swapped while held
  PERFORM set_config('request.jwt.claims', c_res, true);
  BEGIN PERFORM public.retail_cod_assign(_ord.id, false, _del, _res); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'collector locked while held';
  -- cash cannot be confirmed before out for delivery
  PERFORM set_config('request.jwt.claims', c_col, true);
  BEGIN PERFORM public.retail_cod_cash_received(_ord.id, 121); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'cash before dispatch blocked';

  -- ===== fulfillment: out for delivery (hand-off) -> customer cancellation blocked =====
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_update_fulfillment(_ord.id, 'out_for_delivery');
  PERFORM set_config('request.jwt.claims', c_cus, true);
  BEGIN PERFORM public.cancel_retail_order(_ord.id); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '21 customer cancellation blocked after handoff';
  BEGIN PERFORM public.retail_cod_seller_cancel(_ord.id, 'x'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '21 customer cannot use seller cancel';
  -- delivery person marks hand-over; customer confirms receipt
  PERFORM set_config('request.jwt.claims', c_del, true);
  PERFORM public.retail_update_fulfillment(_ord.id, 'delivered');
  BEGIN PERFORM public.retail_cod_cash_received(_ord.id, 121); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'delivery person cannot confirm cash';
  PERFORM set_config('request.jwt.claims', c_cus, true);
  PERFORM public.retail_update_fulfillment(_ord.id, 'completed');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.completed_at IS NOT NULL AND _ord.cod_settled_at IS NULL AND _ord.settlement_ledger_id IS NULL, '13 buyer receipt does not settle';
  -- 14: seller fallback blocked before 3 days
  PERFORM set_config('request.jwt.claims', c_res, true);
  BEGIN PERFORM public.retail_cod_seller_release(_ord.id); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '14 seller release blocked before 3 days';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no) = 1, '13 still only the hold';

  -- ===== 11/12/16-20/25/26: exact cash received settles ONCE =====
  _snap := to_jsonb(_ord) - 'cod_settled_at' - 'cod_settlement_kind' - 'cod_actual_cash' - 'cod_cash_received_at' - 'cod_discrepancy'
           - 'settlement_ledger_id' - 'settled_to' - 'cashback_ledger_id' - 'delivery_share_ledger_id' - 'collector_share_ledger_id' - 'updated_at';
  PERFORM set_config('request.jwt.claims', c_col, true);
  PERFORM public.retail_cod_cash_received(_ord.id, 121);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT _ord.cod_settled_at IS NOT NULL AND _ord.cod_settlement_kind = 'collector_confirmed' AND _ord.cod_actual_cash = 121 AND NOT _ord.cod_discrepancy, '11 settled';
  ASSERT (to_jsonb(_ord) - 'cod_settled_at' - 'cod_settlement_kind' - 'cod_actual_cash' - 'cod_cash_received_at' - 'cod_discrepancy'
           - 'settlement_ledger_id' - 'settled_to' - 'cashback_ledger_id' - 'delivery_share_ledger_id' - 'collector_share_ledger_id' - 'updated_at') = _snap, 'settlement did not alter snapshot';
  -- 16 seller product allocation 90 (100 - 10 cashback) to shop admin
  ASSERT (SELECT amount FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id) = 90 AND _ord.settled_to = _adm
     AND (SELECT user_id FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id) = _adm, '16 seller 90';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct_adm) = _b_adm0 + 90, '16 admin balance +90';
  -- 26 cashback 10 to reseller exactly once
  ASSERT (SELECT amount FROM public.credit_ledger WHERE id = _ord.cashback_ledger_id) = 10
     AND (SELECT user_id FROM public.credit_ledger WHERE id = _ord.cashback_ledger_id) = _res, '26 cashback 10 to reseller';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE entry_kind = 'retail_cashback' AND reference = _ord.order_no) = 1, '26 cashback once';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct_res) = _b_res0 + 10, '26 reseller +10';
  -- 27 no subreseller credit
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _sub AND ecosystem_id IS NULL) = _b_sub0
     AND (SELECT count(*) FROM public.credit_ledger WHERE user_id = _sub AND reference = _ord.order_no) = 0, '27 subreseller untouched';
  -- 17/18 delivery split 70/30 of 20 -> 14 / 6
  ASSERT (SELECT amount FROM public.credit_ledger WHERE id = _ord.delivery_share_ledger_id) = 14
     AND (SELECT user_id FROM public.credit_ledger WHERE id = _ord.delivery_share_ledger_id) = _del, '17 delivery 14';
  ASSERT (SELECT amount FROM public.credit_ledger WHERE id = _ord.collector_share_ledger_id) = 6
     AND (SELECT user_id FROM public.credit_ledger WHERE id = _ord.collector_share_ledger_id) = _col, '18 collector 6';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct_del) = _b_del0 + 14, '17 delivery balance +14';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct_col) = _b_col0 + 6, '18 collector balance: 0 available + 6 share';
  -- 19 separate records (hold, settlement, cashback, delivery, collector)
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no) = 5
     AND (SELECT count(DISTINCT entry_kind) FROM public.credit_ledger WHERE reference = _ord.order_no) = 5, '19 five distinct records';
  -- 25 platform fee: one reporting row, no wallet credit, no super admin coins
  ASSERT (SELECT count(*) FROM public.retail_platform_fees WHERE order_id = _ord.id) = 1
     AND (SELECT fee_credits FROM public.retail_platform_fees WHERE order_id = _ord.id) = 1, '25 fee row 1 once';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no AND entry_kind NOT IN ('retail_cod_hold','retail_settlement','retail_cashback','retail_delivery_share','retail_collector_share')) = 0, '25 no fee wallet credit';
  IF _sa IS NOT NULL THEN
    ASSERT (SELECT count(*) FROM public.credit_ledger WHERE user_id = _sa AND reference = _ord.order_no) = 0, '25 super admin received nothing';
  END IF;
  -- 20 exact reconciliation: credits + fee = hold; system total shrinks by exactly the 1 fee
  ASSERT (SELECT sum(amount) FROM public.credit_ledger WHERE reference = _ord.order_no AND direction = 'credit') + 1 = 121, '20 90+10+14+6+1 = 121';
  ASSERT (SELECT coalesce(sum(balance),0) FROM public.credit_accounts) = _sum0 + 121 - 1, '20 no coin creation (system total = before + collector funding - fee)';
  -- 12/23 duplicates blocked
  BEGIN PERFORM public.retail_cod_cash_received(_ord.id, 121); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '12 duplicate cash confirmation blocked';
  PERFORM set_config('request.jwt.claims', c_res, true);
  BEGIN PERFORM public.retail_cod_seller_release(_ord.id); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '23 release after settlement blocked';
  BEGIN PERFORM public.retail_cod_seller_cancel(_ord.id, 'x'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '23 cancel after settlement blocked';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  BEGIN PERFORM public.retail_cod_resolve_discrepancy(_ord.id, 'settle', NULL); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '23 admin resolve on settled blocked';
  BEGIN UPDATE public.retail_orders SET status = 'cancelled' WHERE id = _ord.id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '23 row-level cancel after settlement blocked';
  BEGIN INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, entry_kind)
        VALUES (_acct_adm, _adm, _u, 'credit', 90, 0, 'dup', _ord.order_no, _adm, _ord.cod_hold_tx || '-S', 'retail_settlement'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '12 unique tx_id blocks duplicate settlement row';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord.order_no) = 5, '12 still five records';
  -- customer + seller views
  PERFORM set_config('request.jwt.claims', c_cus, true);
  ASSERT (SELECT count(*) FROM public.my_retail_orders(_u) WHERE id = _ord.id AND delivery_fee = 20 AND collector_name IS NOT NULL) = 1, 'customer sees own COD order';
  PERFORM set_config('request.jwt.claims', c_col, true);
  ASSERT (SELECT count(*) FROM public.retail_my_cod_assignments() WHERE id = _ord.id AND my_role = 'collector' AND my_share = 6) = 1, 'collector sees assignment';
  ASSERT (SELECT count(*) FROM public.list_retail_orders(_u, 'all')) = 0, 'collector is not a seller';
  ASSERT (SELECT count(*) FROM public.my_retail_orders(_u) WHERE id = _ord.id) = 0, 'collector does not see customer view';

  -- ===== 32: chat authorization =====
  PERFORM set_config('request.jwt.claims', c_col, true);
  PERFORM public.dm_send_thread(_ord.chat_thread_id, 'On my way', NULL);
  PERFORM set_config('request.jwt.claims', c_cus, true);
  ASSERT (SELECT count(*) FROM public.dm_messages_for(_ord.chat_thread_id) WHERE sender_name IS NOT NULL) = 1, '32 customer reads order chat';
  ASSERT (SELECT count(*) FROM public.dm_thread_list() WHERE thread_id = _ord.chat_thread_id AND kind = 'order' AND jsonb_array_length(participants) = 4) = 1, '32 thread list shows order chat';
  ASSERT (SELECT public.retail_order_chat(_ord.id)) = _ord.chat_thread_id, '32 one-tap chat resolves same thread';
  PERFORM set_config('request.jwt.claims', c_sub, true);
  BEGIN PERFORM public.dm_send_thread(_ord.chat_thread_id, 'intruder', NULL); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '32 outsider cannot post';
  BEGIN PERFORM public.dm_messages_for(_ord.chat_thread_id); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '32 outsider cannot read';
  BEGIN PERFORM public.retail_order_chat(_ord.id); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '32 outsider cannot open';
  ASSERT (SELECT count(*) FROM public.dm_thread_list() WHERE thread_id = _ord.chat_thread_id) = 0, '32 outsider does not list it';
  PERFORM set_config('request.jwt.claims', c_cus, true);
  ASSERT (SELECT count(*) FROM public.dm_thread_list() WHERE thread_id = _ord.chat_thread_id) = 1, '32 history kept after completion';

  -- ===== 15: seller fallback after 3 days (order 2) — same settlement path, exactly once =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'delivery', 'cod', '12 Main St', NULL, _res);
  SELECT * INTO _ord2 FROM public.retail_orders WHERE id = _o.order_id;
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord2.id, true, NULL);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_acct_col, _col, NULL, 'credit', 115, 0, 'R6 collector funding', 'R6', public.new_tx_id(), 'general'); -- 6 + 115 = 121
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_cod_assign(_ord2.id, false, _del, _col);
  PERFORM set_config('request.jwt.claims', c_col, true);
  PERFORM public.retail_cod_collector_respond(_ord2.id, true);
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_update_fulfillment(_ord2.id, 'preparing'); PERFORM public.retail_update_fulfillment(_ord2.id, 'ready'); PERFORM public.retail_update_fulfillment(_ord2.id, 'out_for_delivery'); PERFORM public.retail_update_fulfillment(_ord2.id, 'delivered');
  PERFORM set_config('request.jwt.claims', c_cus, true);
  PERFORM public.retail_update_fulfillment(_ord2.id, 'completed');
  PERFORM set_config('request.jwt.claims', c_res, true);
  BEGIN PERFORM public.retail_cod_seller_release(_ord2.id); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '14 blocked at day 0';
  -- backdate the buyer receipt (test-only; triggers bypassed for this single timestamp edit)
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.retail_orders SET completed_at = now() - interval '3 days 1 minute' WHERE id = _ord2.id;
  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM set_config('request.jwt.claims', c_sub, true);
  BEGIN PERFORM public.retail_cod_seller_release(_ord2.id); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '15 only seller may release';
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_cod_seller_release(_ord2.id);
  SELECT * INTO _ord2 FROM public.retail_orders WHERE id = _ord2.id;
  ASSERT _ord2.cod_settled_at IS NOT NULL AND _ord2.cod_settlement_kind = 'seller_release', '15 released';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord2.order_no) = 5
     AND (SELECT sum(amount) FROM public.credit_ledger WHERE reference = _ord2.order_no AND direction = 'credit') = 120, '15 same allocations 90+10+14+6';
  BEGIN PERFORM public.retail_cod_seller_release(_ord2.id); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '15 duplicate release blocked';
  PERFORM set_config('request.jwt.claims', c_col, true);
  BEGIN PERFORM public.retail_cod_cash_received(_ord2.id, 121); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '15 collector cannot re-settle after release';

  -- ===== 22: seller voluntary cancellation with hold -> float released once (order 3) =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'delivery', 'cod', '12 Main St', NULL, _res);
  SELECT * INTO _ord3 FROM public.retail_orders WHERE id = _o.order_id;
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord3.id, true, NULL);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_acct_col, _col, NULL, 'credit', 109, 0, 'R6 collector funding', 'R6', public.new_tx_id(), 'general'); -- 12 + 109 = 121
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_cod_assign(_ord3.id, false, _del, _col);
  PERFORM set_config('request.jwt.claims', c_col, true);
  PERFORM public.retail_cod_collector_respond(_ord3.id, true);
  SELECT balance INTO bal FROM public.credit_accounts WHERE id = _acct_col;
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_update_fulfillment(_ord3.id, 'preparing'); PERFORM public.retail_update_fulfillment(_ord3.id, 'ready'); PERFORM public.retail_update_fulfillment(_ord3.id, 'out_for_delivery');
  PERFORM public.retail_cod_seller_cancel(_ord3.id, 'customer unavailable');
  SELECT * INTO _ord3 FROM public.retail_orders WHERE id = _ord3.id;
  ASSERT _ord3.status = 'cancelled' AND _ord3.fulfillment_status = 'closed' AND _ord3.refund_ledger_id IS NOT NULL AND _ord3.cod_settled_at IS NULL, '22 cancelled';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct_col) = bal + 121, '22 float returned 121';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord3.order_no) = 2, '22 hold + release only';
  ASSERT (SELECT stock FROM public.retail_products WHERE id = _p) = 98, '22 stock restored';
  BEGIN PERFORM public.retail_cod_seller_cancel(_ord3.id, 'again'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '23 duplicate cancel blocked';
  PERFORM set_config('request.jwt.claims', c_col, true);
  BEGIN PERFORM public.retail_cod_cash_received(_ord3.id, 121); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '23 cancelled order cannot settle';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord3.order_no) = 2, '23 no extra rows';

  -- ===== partial / wrong cash -> discrepancy, no settlement (order 4) =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'delivery', 'cod', '12 Main St', NULL, _res);
  SELECT * INTO _ord4 FROM public.retail_orders WHERE id = _o.order_id;
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord4.id, true, NULL);
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_cod_assign(_ord4.id, true, NULL, _col); -- self delivery + collector
  PERFORM set_config('request.jwt.claims', c_col, true);
  PERFORM public.retail_cod_collector_respond(_ord4.id, true);
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_update_fulfillment(_ord4.id, 'preparing'); PERFORM public.retail_update_fulfillment(_ord4.id, 'ready'); PERFORM public.retail_update_fulfillment(_ord4.id, 'out_for_delivery');
  PERFORM set_config('request.jwt.claims', c_col, true);
  PERFORM public.retail_cod_cash_received(_ord4.id, 100);
  SELECT * INTO _ord4 FROM public.retail_orders WHERE id = _ord4.id;
  ASSERT _ord4.cod_discrepancy AND _ord4.cod_actual_cash = 100 AND _ord4.cod_settled_at IS NULL AND _ord4.settlement_ledger_id IS NULL, 'partial cash flagged, not settled';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord4.order_no) = 1, 'partial cash moved nothing';
  BEGIN PERFORM public.retail_cod_cash_received(_ord4.id, 121); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'cash cannot be re-entered';
  PERFORM set_config('request.jwt.claims', c_res, true);
  BEGIN PERFORM public.retail_cod_seller_cancel(_ord4.id, 'x'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'reseller cannot bypass discrepancy';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_cod_resolve_discrepancy(_ord4.id, 'settle', NULL);
  SELECT * INTO _ord4 FROM public.retail_orders WHERE id = _ord4.id;
  ASSERT _ord4.cod_settled_at IS NOT NULL AND _ord4.cod_settlement_kind = 'admin_resolved' AND NOT _ord4.cod_discrepancy, 'admin resolved';
  -- self delivery: delivery share (14) goes to the seller (reseller), collector 6
  ASSERT (SELECT user_id FROM public.credit_ledger WHERE id = _ord4.delivery_share_ledger_id) = _res
     AND (SELECT amount FROM public.credit_ledger WHERE id = _ord4.delivery_share_ledger_id) = 14
     AND (SELECT amount FROM public.credit_ledger WHERE id = _ord4.collector_share_ledger_id) = 6, 'self-delivery share to seller';
  ASSERT (SELECT sum(amount) FROM public.credit_ledger WHERE reference = _ord4.order_no AND direction = 'credit') = 120, 'order 4 reconciles 90+10+14+6 (+1 fee)';

  -- ===== 8: self delivery, no collector -> seller + customer chat only (order 5, cash payment) =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'delivery', 'cash', '12 Main St', NULL, _res);
  SELECT * INTO _ord5 FROM public.retail_orders WHERE id = _o.order_id;
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord5.id, true, NULL);
  PERFORM set_config('request.jwt.claims', c_res, true);
  PERFORM public.retail_cod_assign(_ord5.id, true, NULL, NULL);
  BEGIN PERFORM public.retail_cod_assign(_ord5.id, false, _del, _col); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, 'cash order has no collector';
  SELECT * INTO _ord5 FROM public.retail_orders WHERE id = _ord5.id;
  ASSERT _ord5.self_delivery AND _ord5.chat_thread_id IS NOT NULL
     AND (SELECT count(*) FROM public.dm_thread_members WHERE thread_id = _ord5.chat_thread_id AND removed_at IS NULL) = 2
     AND (SELECT count(*) FROM public.dm_thread_members WHERE thread_id = _ord5.chat_thread_id AND removed_at IS NULL AND user_id IN (_res, _cus)) = 2, '8 self-delivery chat seller+customer';
  -- plain cash order still moves no coins through fulfillment (R4/R5 regression)
  PERFORM public.retail_update_fulfillment(_ord5.id, 'preparing'); PERFORM public.retail_update_fulfillment(_ord5.id, 'ready'); PERFORM public.retail_update_fulfillment(_ord5.id, 'out_for_delivery');
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE reference = _ord5.order_no) = 0, '29 cash order moves no coins';

  -- ===== 29: R4 credit order regression (unchanged path) =====
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_acct_cus, _cus, NULL, 'credit', 500, 0, 'R6 cus funding', 'R6', public.new_tx_id(), 'general');
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'pickup', 'credit', NULL, NULL, _res);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.total = 101 AND _ord.delivery_fee = 0 AND _ord.hold_ledger_id IS NOT NULL AND _ord.collector_status = 'none', '29 credit order unchanged (101, hold, no COD)';
  PERFORM set_config('request.jwt.claims', c_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _ord.id;
  ASSERT (SELECT amount FROM public.credit_ledger WHERE id = _ord.settlement_ledger_id) = 90
     AND (SELECT amount FROM public.credit_ledger WHERE id = _ord.cashback_ledger_id) = 10
     AND (SELECT count(*) FROM public.retail_platform_fees WHERE order_id = _ord.id) = 1, '29 R4 settlement 90/10/1';
  BEGIN UPDATE public.retail_orders SET collector_id = _col WHERE id = _ord.id; _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '29 credit order cannot gain a collector';

  -- ===== 31: New Generation isolation =====
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_c2s, _cus2, _s, 'credit', 500, 0, 'R6 NG funding', 'R6', public.new_tx_id(), 'general');
  PERFORM set_config('request.jwt.claims', c_cus2, true);
  BEGIN SELECT * INTO _o FROM public.retail_place_order(_s, jsonb_build_array(jsonb_build_object('product_id', _pN, 'quantity', 1)), 'delivery', 'cod', 'NG St'); _ok := true; EXCEPTION WHEN OTHERS THEN _ok := false; END;
  ASSERT NOT _ok, '31 NG cannot place COD';
  ASSERT NOT (SELECT cod_enabled FROM public.shop_store_settings(_s)), '31 NG settings never expose COD';
  SELECT * INTO _o FROM public.retail_place_order(_s, jsonb_build_array(jsonb_build_object('product_id', _pN, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.wallet_account_id = _c2s AND _ord.delivery_fee = 0, '31 NG credit order uses shop wallet';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE ecosystem_id IS NULL AND user_id = _cus2) = 0, '31 NG customer never touched global wallet';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE entry_kind IN ('retail_cod_hold','retail_cod_release','retail_delivery_share','retail_collector_share') AND ecosystem_id = _s) = 0, '31 no COD ledger in NG';

  -- ===== 28: Voucher functions untouched by R6 =====
  ASSERT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'voucher%' AND prosrc ~* '(cod_|collector|delivery_fee)') = 0, '28 voucher functions do not reference COD';

  RAISE EXCEPTION 'RETAIL_R6_TESTS_PASSED';
END $$;
