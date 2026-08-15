-- Reseller downline read authorization.
--
-- Rules locked in here:
--   1. A reseller sees ONLY subresellers whose reseller_id is themselves.
--   2. A reseller cannot see another reseller's subresellers.
--   3. A reseller cannot read an arbitrary member's ledger through the
--      subreseller history RPC.
--   4. The existing transfer authorization is unchanged: reseller -> own
--      subreseller works, reseller -> another reseller's subreseller fails.
--
-- Run inside a transaction and roll back:
--   BEGIN; \i supabase/tests/reseller-subreseller-reads.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _eco uuid;
  _res_a uuid := gen_random_uuid();
  _res_b uuid := gen_random_uuid();
  _sub_a uuid := gen_random_uuid();
  _sub_b uuid := gen_random_uuid();
  _cust uuid := gen_random_uuid();
  _rows int;
  _bal numeric;
  _failed boolean;
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price, subscription_state)
  VALUES ('Downline Test Shop', 'downline-test-shop', 'tok-dl', 'Test', 0, 'active')
  RETURNING id INTO _eco;

  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status, reseller_id)
  VALUES (_res_a, _eco, 'Reseller A', 'ra@test.local', '100', 'active', NULL),
         (_res_b, _eco, 'Reseller B', 'rb@test.local', '101', 'active', NULL),
         (_sub_a, _eco, 'Sub of A',   'sa@test.local', '102', 'active', _res_a),
         (_sub_b, _eco, 'Sub of B',   'sb@test.local', '103', 'active', _res_b),
         (_cust,  _eco, 'Customer',   'c@test.local',  '104', 'active', NULL);

  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_res_a, 'reseller', _eco), (_res_b, 'reseller', _eco),
         (_sub_a, 'subreseller', _eco), (_sub_b, 'subreseller', _eco),
         (_cust, 'customer', _eco);

  INSERT INTO public.credit_accounts (user_id, ecosystem_id, balance)
  VALUES (_res_a, _eco, 5000), (_res_b, _eco, 5000),
         (_sub_a, _eco, 250), (_sub_b, _eco, 999), (_cust, _eco, 10)
  ON CONFLICT DO NOTHING;

  -- Act as reseller A
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res_a)::text, true);

  SELECT count(*) INTO _rows FROM public.reseller_list_subresellers();
  ASSERT _rows = 1, 'reseller A must see exactly their own subreseller';

  SELECT balance INTO _bal FROM public.reseller_list_subresellers() LIMIT 1;
  ASSERT _bal = 250, 'the listed balance must be the shop wallet balance';

  ASSERT NOT EXISTS (SELECT 1 FROM public.reseller_list_subresellers() s WHERE s.id = _sub_b),
         'reseller A must never see another reseller''s subreseller';

  -- 3) Arbitrary ledgers are refused
  _failed := false;
  BEGIN
    PERFORM public.reseller_subreseller_ledger(_sub_b, 50);
  EXCEPTION WHEN others THEN _failed := true;
  END;
  ASSERT _failed, 'reading another reseller''s subreseller ledger must fail';

  _failed := false;
  BEGIN
    PERFORM public.reseller_subreseller_ledger(_cust, 50);
  EXCEPTION WHEN others THEN _failed := true;
  END;
  ASSERT _failed, 'reading an arbitrary member ledger must fail';

  -- 4) Transfer authorization unchanged
  PERFORM public.transfer_credits(_sub_a, 100, 'Float');
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _res_a AND ecosystem_id = _eco) = 4900,
         'reseller wallet must be debited';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _sub_a AND ecosystem_id = _eco) = 350,
         'own subreseller must be credited the exact amount (no commission)';

  _failed := false;
  BEGIN
    PERFORM public.transfer_credits(_sub_b, 100, 'Should fail');
  EXCEPTION WHEN others THEN _failed := true;
  END;
  ASSERT _failed, 'transferring to another reseller''s subreseller must fail';

  -- Own ledger read now returns the transfer
  SELECT count(*) INTO _rows FROM public.reseller_subreseller_ledger(_sub_a, 100);
  ASSERT _rows >= 1, 'own subreseller history must be readable';

  -- A subreseller gets no management view at all
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _sub_a)::text, true);
  SELECT count(*) INTO _rows FROM public.reseller_list_subresellers();
  ASSERT _rows = 0, 'subresellers must not get the downline management list';

  RAISE NOTICE 'reseller-subreseller-reads: all assertions passed';
END $$;

ROLLBACK;
