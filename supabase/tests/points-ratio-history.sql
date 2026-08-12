-- Test scenario: the points earning ratio is historical and snapshotted per purchase.
--
-- Expectation: an award made under a 10:1 ratio is never recalculated when the
-- admin later switches the shop to 20:1. Only purchases completed AFTER the
-- change use the new ratio.
--
-- Run inside a transaction and roll back so no test data is persisted:
--   BEGIN; \i supabase/tests/points-ratio-history.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _eco uuid;
  _admin uuid := gen_random_uuid();
  _cust uuid := gen_random_uuid();
  _prod uuid;
  _first record;
  _second record;
  _first_after record;
BEGIN
  -- Shop starting at 10 credits = 1 point
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price, credits_per_point, subscription_state)
  VALUES ('Ratio Test Shop', 'ratio-test-shop', 'tok', 'Test', 0, 10, 'active')
  RETURNING id INTO _eco;

  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status)
  VALUES (_cust, _eco, 'Test Customer', 'cust@test.local', '000', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id) VALUES (_cust, 'customer', _eco);
  INSERT INTO public.credit_accounts (user_id, ecosystem_id, balance) VALUES (_cust, _eco, 1000)
    ON CONFLICT DO NOTHING;
  INSERT INTO public.points_accounts (user_id, ecosystem_id, balance) VALUES (_cust, _eco, 0)
    ON CONFLICT DO NOTHING;

  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_eco, '100 credit voucher', 'test', 100, true) RETURNING id INTO _prod;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  VALUES (_eco, _prod, 'CODE-A', 'unused'), (_eco, _prod, 'CODE-B', 'unused');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);

  -- Purchase #1 under 10:1 -> 10 points
  SELECT * INTO _first FROM public.purchase_voucher(_prod);
  ASSERT _first.points_earned = 10, 'expected 10 points at 10:1, got ' || _first.points_earned;

  -- Admin changes the ratio to 20:1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status)
  VALUES (_admin, _eco, 'Test Admin', 'admin@test.local', '000', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id) VALUES (_admin, 'admin', _eco);
  PERFORM public.set_points_rule(_eco, 20);

  -- The first award is untouched: same points, same snapshotted ratio
  SELECT amount, credits_per_point_used INTO _first_after
    FROM public.points_ledger WHERE sale_id = _first.sale_id AND entry_type = 'earn';
  ASSERT _first_after.amount = 10, 'historical award was mutated';
  ASSERT _first_after.credits_per_point_used = 10, 'historical ratio snapshot was rewritten';

  -- Purchase #2 uses the new ratio -> 5 points
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  SELECT * INTO _second FROM public.purchase_voucher(_prod);
  ASSERT _second.points_earned = 5, 'expected 5 points at 20:1, got ' || _second.points_earned;
  ASSERT (SELECT credits_per_point_used FROM public.points_ledger
           WHERE sale_id = _second.sale_id AND entry_type = 'earn') = 20,
         'second sale did not snapshot the new ratio';

  -- Balance is the sum of both awards, not a recalculation
  ASSERT (SELECT balance FROM public.points_accounts WHERE user_id = _cust) = 15,
         'points balance should be 10 + 5 = 15';

  RAISE NOTICE 'points ratio history test passed';
END $$;

ROLLBACK;
