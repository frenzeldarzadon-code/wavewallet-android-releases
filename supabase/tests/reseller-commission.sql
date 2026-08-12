-- Test scenario: reseller credit commission is additive, snapshotted and role-scoped.
--
-- Expectations:
--   1. Admin sends 1,000 to a 20% reseller -> admin -1,000, reseller +1,200.
--   2. Reseller sends 500 to a customer   -> reseller -500, customer +500 (no bonus).
--   3. Changing 20% -> 10% affects only FUTURE admin/super-admin -> reseller transfers.
--
-- Run inside a transaction and roll back so no test data is persisted:
--   BEGIN; \i supabase/tests/reseller-commission.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _eco uuid;
  _admin uuid := gen_random_uuid();
  _res uuid := gen_random_uuid();
  _cust uuid := gen_random_uuid();
  _first_tx text;
  _second_tx text;
  _entry record;
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price, subscription_state)
  VALUES ('Commission Test Shop', 'commission-test-shop', 'tok', 'Test', 0, 'active')
  RETURNING id INTO _eco;

  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status)
  VALUES (_admin, _eco, 'Test Admin', 'admin@test.local', '000', 'active'),
         (_res, _eco, 'Test Reseller', 'reseller@test.local', '001', 'active'),
         (_cust, _eco, 'Test Customer', 'customer@test.local', '002', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_admin, 'admin', _eco), (_res, 'reseller', _eco), (_cust, 'customer', _eco);

  INSERT INTO public.credit_accounts (user_id, ecosystem_id, balance)
  VALUES (_admin, _eco, 100000), (_res, _eco, 0), (_cust, _eco, 0)
  ON CONFLICT DO NOTHING;

  -- Reseller configured at 20% commission
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  PERFORM public.set_reseller_commission(_res, 20);

  -- 1) Admin releases 1,000 credits to the reseller
  _first_tx := public.transfer_credits(_res, 1000, 'Float release');

  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _admin) = 99000,
         'sender must be debited the base amount only';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _res) = 1200,
         'reseller must receive base + 20% bonus';

  SELECT base_amount, commission_percent, commission_amount, amount INTO _entry
    FROM public.credit_ledger WHERE tx_id = _first_tx AND user_id = _res;
  ASSERT _entry.base_amount = 1000, 'base amount snapshot missing';
  ASSERT _entry.commission_percent = 20, 'commission percent snapshot missing';
  ASSERT _entry.commission_amount = 200, 'bonus amount snapshot missing';
  ASSERT _entry.amount = 1200, 'credited total must be 1200';

  -- 2) Reseller -> customer transfer earns no commission
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  PERFORM public.transfer_credits(_cust, 500, 'Customer load');

  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _res) = 700,
         'reseller must be debited exactly 500';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _cust) = 500,
         'customer must receive exactly 500 with no bonus';
  ASSERT (SELECT coalesce(sum(coalesce(commission_amount, 0)), 0)
            FROM public.credit_ledger WHERE user_id = _cust) = 0,
         'customers must never receive commission';

  -- 3) Rate change applies to future transfers only
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  PERFORM public.set_reseller_commission(_res, 10);
  _second_tx := public.transfer_credits(_res, 1000, 'Second float release');

  ASSERT (SELECT commission_percent FROM public.credit_ledger
            WHERE tx_id = _first_tx AND user_id = _res) = 20,
         'historical commission rate was rewritten';
  ASSERT (SELECT commission_amount FROM public.credit_ledger
            WHERE tx_id = _second_tx AND user_id = _res) = 100,
         'new transfer must use the 10% rate';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _res) = 1800,
         'reseller balance should be 700 + 1000 + 100 = 1800';

  RAISE NOTICE 'reseller commission test passed';
END $$;

ROLLBACK;
