-- Points come from the coins the member ACTUALLY parted with (Universe shops).
--   points = net spend after the member's own cashback / credits_per_point, 2 decimals
-- Voucher: 10-coin voucher, 30% self cashback -> 7 net -> 0.70 points
-- Retail:  100-coin order, 30 self cashback   -> 70 net -> 7.00 points
-- Run inside a transaction and ROLLBACK: no data is kept.
BEGIN;

CREATE TEMP TABLE diag(k text, v text) ON COMMIT DROP;

DO $$
DECLARE
  _u uuid; _adm uuid := gen_random_uuid(); _res uuid := gen_random_uuid(); _cust uuid := gen_random_uuid();
  _prod uuid; _r record; _bal numeric; _o uuid; _o2 uuid; _o3 uuid; _hold uuid; _sale uuid;
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind)
  VALUES ('Net Spend Universe', 'net-spend-universe', 'tok-net', 'Test', 0, 10, 'active', 'universe')
  RETURNING id INTO _u;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES (_adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'net-adm@test.local', '', now(), now()),
         (_res, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'net-res@test.local', '', now(), now()),
         (_cust, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'net-cust@test.local', '', now(), now());

  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  VALUES (_adm, _u, 'admin', 'active'), (_cust, _u, 'customer', 'active');
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state, sale_commission_percent)
  VALUES (_res, _u, 'reseller', 'active', 30);
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_adm, 'admin', _u), (_res, 'reseller', _u), (_cust, 'customer', _u);
  UPDATE public.profiles SET ecosystem_id = _u, status = 'active' WHERE id in (_adm, _res, _cust);

  PERFORM public.ensure_global_wallet(_res);
  PERFORM public.ensure_global_wallet(_cust);
  UPDATE public.credit_accounts SET balance = 5000 WHERE user_id in (_res, _cust);

  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_u, 'v', 't', 10, true) RETURNING id INTO _prod;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _u, _prod, 'U-' || g, 'unused' FROM generate_series(1, 4) g;

  -- Reseller self-purchase: pays 10, gets 3 back -> 7 net -> 0.70 points
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _r FROM public.purchase_voucher(_prod, 1);
  _sale := _r.sale_id;
  ASSERT _r.points_earned = 0.70, 'net 7 coins -> 0.70, got ' || _r.points_earned;
  ASSERT (SELECT credits_basis FROM public.points_ledger WHERE sale_id=_sale AND entry_type='earn') = 7, 'basis is the net charge';
  ASSERT (SELECT points_earned FROM public.voucher_sales WHERE id=_sale) = 0.70, 'sale row records same points';
  SELECT id INTO _hold FROM public.credit_ledger WHERE user_id = _res ORDER BY created_at DESC LIMIT 1;

  -- Voucher reversal removes exactly what was awarded
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _adm)::text, true);
  PERFORM public.reverse_sale_points(_sale, 'test');
  ASSERT (SELECT balance FROM public.points_accounts WHERE user_id=_res AND ecosystem_id=_u) = 0, 'voucher reversal zeroes the balance';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _r FROM public.purchase_voucher(_prod, 1);
  ASSERT _r.points_earned = 0.70, 'second voucher also 0.70';

  -- Ordinary customer: no cashback -> full 1.00
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  SELECT * INTO _r FROM public.purchase_voucher(_prod, 1);
  ASSERT _r.points_earned = 1.00, 'customer earns 1.00, got ' || _r.points_earned;

  -- Retail order with self cashback: points only once the customer receives it
  INSERT INTO public.retail_orders (ecosystem_id, customer_id, customer_name, order_no, status,
                                    fulfillment, fulfillment_status, payment_method, total,
                                    self_cashback, buyer_charge, credit_hold_tx, hold_ledger_id)
  VALUES (_u, _res, 'Net Reseller', 'RO-NET-1', 'approved', 'pickup', 'ready', 'credit', 100, 30, 70, 'TXNET1', _hold)
  RETURNING id INTO _o;
  ASSERT public.retail_award_order_points(_o) = 0, 'unfinished order earns nothing';
  UPDATE public.retail_orders SET fulfillment_status = 'delivered' WHERE id = _o;
  ASSERT public.retail_award_order_points(_o) = 0, 'delivered but not received earns nothing';
  UPDATE public.retail_orders SET fulfillment_status = 'completed' WHERE id = _o;
  ASSERT public.retail_award_order_points(_o) = 7.00, '70 net -> 7.00 points';
  ASSERT public.retail_award_order_points(_o) = 0, 'retry awards nothing';
  ASSERT (SELECT count(*) FROM public.points_ledger WHERE retail_order_id=_o AND entry_type='earn') = 1, 'single earn row per order';
  ASSERT (SELECT credits_basis FROM public.points_ledger WHERE retail_order_id=_o AND entry_type='earn') = 70, 'retail basis is the net charge';
  SELECT balance INTO _bal FROM public.points_accounts WHERE user_id=_res AND ecosystem_id=_u;
  ASSERT _bal = 7.70, '0.70 + 7.00 = 7.70, got ' || _bal;

  -- Retail order without cashback
  INSERT INTO public.retail_orders (ecosystem_id, customer_id, customer_name, order_no, status,
                                    fulfillment, fulfillment_status, payment_method, total,
                                    self_cashback, buyer_charge, credit_hold_tx, hold_ledger_id)
  VALUES (_u, _cust, 'Net Customer', 'RO-NET-2', 'approved', 'pickup', 'ready', 'credit', 100, 0, 100, 'TXNET2', _hold)
  RETURNING id INTO _o2;
  UPDATE public.retail_orders SET fulfillment_status='delivered' WHERE id=_o2;
  UPDATE public.retail_orders SET fulfillment_status='completed' WHERE id=_o2;
  ASSERT public.retail_award_order_points(_o2) = 10.00, 'no cashback -> 10.00 points';

  -- Cancelled order never earns
  INSERT INTO public.retail_orders (ecosystem_id, customer_id, customer_name, order_no, status,
                                    fulfillment, fulfillment_status, payment_method, total, credit_hold_tx)
  VALUES (_u, _cust, 'Net Customer', 'RO-NET-3', 'cancelled', 'pickup', 'awaiting', 'credit', 50, 'TXNET3')
  RETURNING id INTO _o3;
  ASSERT public.retail_award_order_points(_o3) = 0, 'cancelled order awards nothing';

  -- Retail reversal removes exactly the awarded points, once
  ASSERT public.retail_reverse_order_points(_o, 'test reversal') = 7.00, 'reversal returns the awarded 7.00';
  ASSERT public.retail_reverse_order_points(_o, 'test reversal') = 0, 'second reversal is a no-op';
  SELECT balance INTO _bal FROM public.points_accounts WHERE user_id=_res AND ecosystem_id=_u;
  ASSERT _bal = 0.70, 'after reversal only the voucher points remain, got ' || _bal;

  INSERT INTO diag VALUES ('result', 'points from actual net spend: all assertions passed');
END $$;

SELECT * FROM diag;

ROLLBACK;
