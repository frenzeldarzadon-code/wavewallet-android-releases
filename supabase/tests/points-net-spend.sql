-- Points come from the coins the member ACTUALLY parted with.
--
-- Universe shops give resellers no price discount: they pay the full price and
-- their own share comes straight back as cashback in the same transaction, so
-- the points basis is the net charge (buyer_charge), never the gross total.
--
--   * Universe voucher, 10 coins with 3 coins self cashback -> 0.70 pt
--   * Universe voucher, no cashback (plain customer)        -> 1.00 pt
--   * Universe retail order, 100 with 30 self cashback      -> 7.00 pt
--   * Universe retail order, no cashback                    -> 10.00 pt
--   * unfinished / rejected / cancelled retail order        -> nothing
--   * repeated award call                                   -> awarded once
--   * reversal removes exactly what was awarded
--
--   BEGIN; \i supabase/tests/points-net-spend.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _u uuid; _res uuid := gen_random_uuid(); _cust uuid := gen_random_uuid();
  _prod uuid; _r record; _bal numeric; _earn numeric; _o uuid; _o2 uuid; _o3 uuid;
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind)
  VALUES ('Net Spend Universe', 'net-spend-universe', 'tok-net', 'Test', 0, 10, 'active', 'universe')
  RETURNING id INTO _u;

  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status)
  VALUES (_res, _u, 'Net Reseller', 'net-res@test.local', '900', 'active'),
         (_cust, _u, 'Net Customer', 'net-cust@test.local', '901', 'active');
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state, cashback_percent)
  VALUES (_res, _u, 'reseller', 'active', 30) ON CONFLICT DO NOTHING;
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  VALUES (_cust, _u, 'customer', 'active') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role, ecosystem_id) VALUES (_res, 'reseller', _u), (_cust, 'customer', _u);

  PERFORM public.ensure_global_wallet(_res);
  PERFORM public.ensure_global_wallet(_cust);
  UPDATE public.credit_accounts SET balance = 5000 WHERE user_id in (_res, _cust);

  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_u, '10 coin universe voucher', 'test', 10, true) RETURNING id INTO _prod;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _u, _prod, 'U-' || g, 'unused' FROM generate_series(1, 4) g;

  -- Universe reseller: pays 10, gets 3 back, so 7 coins actually spent -----
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _r FROM public.purchase_voucher(_prod, 1);
  ASSERT _r.sale_price = 10, 'Universe price is never discounted';
  ASSERT _r.points_earned = 0.70,
    'points must follow the net 7 coins charged, got ' || _r.points_earned;
  ASSERT (SELECT credits_basis FROM public.points_ledger WHERE sale_id = _r.sale_id AND entry_type = 'earn') = 7,
    'the ledger basis must be the net charge';
  ASSERT (SELECT points_earned FROM public.voucher_sales WHERE id = _r.sale_id) = 0.70,
    'the sale row records the same points';

  -- Reversal removes exactly the points awarded --------------------------
  _earn := _r.points_earned;
  ASSERT (SELECT balance FROM public.points_accounts WHERE user_id = _res AND ecosystem_id = _u) = 0.70,
    'balance after the earn';

  -- Plain customer: no cashback, full price is the basis ------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  SELECT * INTO _r FROM public.purchase_voucher(_prod, 1);
  ASSERT _r.points_earned = 1.00, 'a customer with no cashback earns the full 1.00, got ' || _r.points_earned;
  ASSERT (SELECT credits_basis FROM public.points_ledger WHERE sale_id = _r.sale_id AND entry_type = 'earn') = 10,
    'customer basis is the full price';

  -- Universe retail order with self cashback ------------------------------
  INSERT INTO public.retail_orders (ecosystem_id, customer_id, customer_name, order_no, status,
                                    fulfillment, fulfillment_status, payment_method, subtotal, total,
                                    self_cashback, buyer_charge, credit_hold_tx)
  VALUES (_u, _res, 'Net Reseller', 'RO-NET-1', 'approved', 'pickup', 'ready', 'credit', 100, 100,
          30, 70, 'TXNET1') RETURNING id INTO _o;

  ASSERT public.retail_award_order_points(_o) = 0, 'an unfinished order earns nothing';

  UPDATE public.retail_orders SET fulfillment_status = 'completed' WHERE id = _o;
  ASSERT public.retail_award_order_points(_o) = 7.00,
    '100 with 30 cashback is 70 actually spent -> 7.00 points';
  PERFORM public.retail_award_order_points(_o);   -- retry must not double-award
  ASSERT (SELECT count(*) FROM public.points_ledger WHERE retail_order_id = _o AND entry_type = 'earn') = 1,
    'exactly one earn entry per retail order';
  ASSERT (SELECT credits_basis FROM public.points_ledger WHERE retail_order_id = _o AND entry_type = 'earn') = 70,
    'the retail basis is the net charge';

  -- Retail order with no cashback ----------------------------------------
  INSERT INTO public.retail_orders (ecosystem_id, customer_id, customer_name, order_no, status,
                                    fulfillment, fulfillment_status, payment_method, subtotal, total,
                                    self_cashback, buyer_charge, credit_hold_tx)
  VALUES (_u, _cust, 'Net Customer', 'RO-NET-2', 'approved', 'pickup', 'completed', 'credit', 100, 100,
          0, 100, 'TXNET2') RETURNING id INTO _o2;
  ASSERT public.retail_award_order_points(_o2) = 10.00, 'no cashback -> the full 10.00 points';

  -- Rejected / cancelled orders earn nothing ------------------------------
  INSERT INTO public.retail_orders (ecosystem_id, customer_id, customer_name, order_no, status,
                                    fulfillment, fulfillment_status, payment_method, subtotal, total,
                                    credit_hold_tx)
  VALUES (_u, _cust, 'Net Customer', 'RO-NET-3', 'cancelled', 'pickup', 'completed', 'credit', 50, 50, 'TXNET3')
  RETURNING id INTO _o3;
  ASSERT public.retail_award_order_points(_o3) = 0, 'a cancelled order never awards points';
  UPDATE public.retail_orders SET status = 'rejected' WHERE id = _o3;
  ASSERT public.retail_award_order_points(_o3) = 0, 'a rejected order never awards points';

  -- Retail reversal removes exactly what was awarded ----------------------
  SELECT balance INTO _bal FROM public.points_accounts WHERE user_id = _res AND ecosystem_id = _u;
  ASSERT _bal = 7.70, 'voucher 0.70 + retail 7.00 = 7.70, got ' || _bal;
  ASSERT public.retail_reverse_order_points(_o, 'test reversal') = 7.00, 'the reversal returns the awarded points';
  ASSERT public.retail_reverse_order_points(_o, 'test reversal') = 0, 'a second reversal is a no-op';
  SELECT balance INTO _bal FROM public.points_accounts WHERE user_id = _res AND ecosystem_id = _u;
  ASSERT _bal = 0.70, 'after the reversal only the voucher points remain, got ' || _bal;

  RAISE NOTICE 'points from actual net spend test passed';
END $$;

ROLLBACK;
