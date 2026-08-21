-- Test scenario: points are earned from the coins ACTUALLY spent, with two
-- decimals of precision, and stay isolated per shop.
--
-- Expectation:
--   * a 10-coin customer purchase at 10:1 earns 1.00 point;
--   * a reseller who actually pays 7 coins for a 10-coin voucher earns 0.70 —
--     never 1.00 derived from the nominal price;
--   * fractions accumulate exactly (7 + 7 + 6 coins = 2.00 points);
--   * a configured 5:1 ratio is honoured and snapshotted per sale;
--   * Shop A and Shop B points never mix;
--   * a failed purchase (no codes) awards nothing.
--
-- Run inside a transaction and roll back so no test data is persisted:
--   BEGIN; \i supabase/tests/points-actual-spend.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _a uuid; _b uuid;
  _cust uuid := gen_random_uuid();
  _res  uuid := gen_random_uuid();
  _pa uuid; _pb uuid;
  _r record;
  _bal numeric;
BEGIN
  -- Two independent shops with different ratios ---------------------------
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price, credits_per_point, subscription_state)
  VALUES ('Spend Shop A', 'spend-shop-a', 'tok-a', 'Test', 0, 10, 'active') RETURNING id INTO _a;
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price, credits_per_point, subscription_state)
  VALUES ('Spend Shop B', 'spend-shop-b', 'tok-b', 'Test', 0, 5, 'active') RETURNING id INTO _b;

  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status)
  VALUES (_cust, _a, 'Spend Customer', 'spend-cust@test.local', '000', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id) VALUES (_cust, 'customer', _a);
  INSERT INTO public.credit_accounts (user_id, ecosystem_id, balance) VALUES (_cust, _a, 1000) ON CONFLICT DO NOTHING;
  INSERT INTO public.points_accounts (user_id, ecosystem_id, balance) VALUES (_cust, _a, 0) ON CONFLICT DO NOTHING;

  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_a, '10 coin voucher', 'test', 10, true) RETURNING id INTO _pa;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _a, _pa, 'A-' || g, 'unused' FROM generate_series(1, 6) g;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);

  -- 10 coins actually spent at 10:1 -> exactly 1.00 point
  SELECT * INTO _r FROM public.purchase_voucher(_pa, 1);
  ASSERT _r.points_earned = 1.00, 'customer 10-coin purchase should earn 1.00, got ' || _r.points_earned;
  ASSERT _r.sale_price = 10, 'customer pays the full price';

  -- A reseller with a 30% discount actually pays 7 coins -----------------
  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status, discount_percent)
  VALUES (_res, _a, 'Spend Reseller', 'spend-res@test.local', '001', 'active', 30);
  INSERT INTO public.user_roles (user_id, role, ecosystem_id) VALUES (_res, 'reseller', _a);
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state, discount_percent)
  VALUES (_res, _a, 'reseller', 'active', 30) ON CONFLICT DO NOTHING;
  INSERT INTO public.credit_accounts (user_id, ecosystem_id, balance) VALUES (_res, _a, 1000) ON CONFLICT DO NOTHING;
  INSERT INTO public.points_accounts (user_id, ecosystem_id, balance) VALUES (_res, _a, 0) ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _r FROM public.purchase_voucher(_pa, 1);
  ASSERT _r.sale_price = 7, 'reseller should actually pay 7 coins, paid ' || _r.sale_price;
  ASSERT _r.points_earned = 0.70,
         'points must follow the 7 coins actually spent (0.70), got ' || _r.points_earned;
  ASSERT (SELECT credits_basis FROM public.points_ledger WHERE sale_id = _r.sale_id AND entry_type = 'earn') = 7,
         'the ledger basis must be the actual coins spent';

  -- Fractional accumulation: 7 + 7 + 6 coins -> 2.00 points ---------------
  SELECT * INTO _r FROM public.purchase_voucher(_pa, 1);            -- another 7 coins
  UPDATE public.profiles SET discount_percent = 40 WHERE id = _res; -- 6 coins next
  UPDATE public.ecosystem_memberships SET discount_percent = 40 WHERE user_id = _res AND ecosystem_id = _a;
  SELECT * INTO _r FROM public.purchase_voucher(_pa, 1);
  ASSERT _r.sale_price = 6, 'third reseller purchase should cost 6 coins, cost ' || _r.sale_price;

  SELECT balance INTO _bal FROM public.points_accounts WHERE user_id = _res AND ecosystem_id = _a;
  ASSERT _bal = 2.00, '0.70 + 0.70 + 0.60 must accumulate to exactly 2.00, got ' || _bal;

  -- Second shop, configured 5:1, fully isolated ---------------------------
  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status)
  VALUES (gen_random_uuid(), _b, 'Shop B Anchor', 'spend-anchor@test.local', '002', 'active');
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  VALUES (_res, _b, 'customer', 'active') ON CONFLICT DO NOTHING;
  INSERT INTO public.credit_accounts (user_id, ecosystem_id, balance) VALUES (_res, _b, 1000) ON CONFLICT DO NOTHING;
  INSERT INTO public.points_accounts (user_id, ecosystem_id, balance) VALUES (_res, _b, 0) ON CONFLICT DO NOTHING;

  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_b, '10 coin voucher B', 'test', 10, true) RETURNING id INTO _pb;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status) VALUES (_b, _pb, 'B-1', 'unused');

  SELECT * INTO _r FROM public.purchase_voucher(_pb, 1);
  ASSERT _r.points_earned = 2.00, 'Shop B at 5:1 should award 2.00 for 10 coins, got ' || _r.points_earned;
  ASSERT (SELECT balance FROM public.points_accounts WHERE user_id = _res AND ecosystem_id = _a) = 2.00,
         'Shop A points must not change when buying in Shop B';
  ASSERT (SELECT balance FROM public.points_accounts WHERE user_id = _res AND ecosystem_id = _b) = 2.00,
         'Shop B keeps its own independent points balance';
  ASSERT (SELECT credits_per_point_used FROM public.points_ledger
           WHERE sale_id = _r.sale_id AND entry_type = 'earn') = 5,
         'each sale snapshots its own shop ratio';

  -- A failed purchase awards nothing (no stock left in Shop B) ------------
  BEGIN
    PERFORM public.purchase_voucher(_pb, 1);
    RAISE EXCEPTION 'a purchase without stock should have failed';
  EXCEPTION WHEN others THEN
    NULL;
  END;
  ASSERT (SELECT balance FROM public.points_accounts WHERE user_id = _res AND ecosystem_id = _b) = 2.00,
         'a failed purchase must not award points';

  -- No double-award: one earn entry per sale (unique index guard) ---------
  ASSERT (SELECT count(*) FROM public.points_ledger l
           JOIN public.voucher_sales v ON v.id = l.sale_id
          WHERE l.entry_type = 'earn' AND v.buyer_id = _res) = 4,
         'exactly one earn entry per completed sale';

  RAISE NOTICE 'points from actual coins spent test passed';
END $$;

ROLLBACK;
