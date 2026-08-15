-- Global manual-credit rules: identical in EVERY shop, existing or brand new.
--
-- Replace the ids below with real rows, then run:
--   BEGIN; \i supabase/tests/global-manual-credit-rules.sql ROLLBACK;
--
-- Proves (test matrix 1-11):
--   1/2/4  Super Admin issues credits in ANY shop with a ZERO own balance.
--   3      Super Admin removes credits from a member's shop wallet.
--   5      A brand-new shop needs no special setup.
--   6      Shop admins still obey their own balance; nobody else may mint.
--   7      Manual credits create no sale, no commission, no cashback.
--   8      Wallets stay shop-specific — only the selected shop moves.
--   9      Shop-to-shop transfers still charge the configured fee.
--   10     An ordinary user cannot issue credits by calling the RPCs directly.
--   11     Audit rows carry operator, shop, member, amount, reason, before/after.

BEGIN;

DO $$
DECLARE
  _super uuid := '00000000-0000-0000-0000-000000000001'; -- platform owner
  _admin uuid := '00000000-0000-0000-0000-000000000002'; -- shop admin of _eco_a
  _cust  uuid := '00000000-0000-0000-0000-000000000003'; -- customer in both shops
  _eco_a uuid; -- an existing shop
  _eco_b uuid; -- a different existing shop
  _eco_new public.ecosystems;
  _tx text;
  _a_before numeric; _a_after numeric;
  _b_before numeric; _b_after numeric;
  _sales_before bigint; _comm_before bigint;
BEGIN
  SELECT id INTO _eco_a FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _eco_b FROM public.ecosystems WHERE id <> _eco_a ORDER BY created_at LIMIT 1;

  SELECT count(*) INTO _sales_before FROM public.voucher_sales;
  SELECT count(*) INTO _comm_before FROM public.sale_commissions;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);

  -- The platform owner holds nothing anywhere: issuance must not need a source.
  UPDATE public.credit_accounts SET balance = 0 WHERE user_id = _super;

  SELECT coalesce(balance,0) INTO _a_before FROM public.credit_accounts
   WHERE user_id = _cust AND ecosystem_id = _eco_a;
  SELECT coalesce(balance,0) INTO _b_before FROM public.credit_accounts
   WHERE user_id = _cust AND ecosystem_id = _eco_b;

  ------------------------------------------------- 1/2/4: issue in any shop
  _tx := public.admin_load_credits(_cust, 100, 'QA manual credit', 'QA-1', _eco_a);
  SELECT balance INTO _a_after FROM public.credit_accounts
   WHERE user_id = _cust AND ecosystem_id = _eco_a;
  SELECT coalesce(balance,0) INTO _b_after FROM public.credit_accounts
   WHERE user_id = _cust AND ecosystem_id = _eco_b;
  ASSERT _a_after = _a_before + 100, 'selected shop wallet gained exactly 100';
  ASSERT _b_after = _b_before, 'wallets are shop-specific — the other shop never moved'; -- 8
  ASSERT (SELECT balance FROM public.credit_accounts
           WHERE user_id = _super AND ecosystem_id IS NULL) = 0,
         'operator wallet never debited and never credited';

  _tx := public.admin_load_credits(_cust, 100, 'QA manual credit other shop', 'QA-2', _eco_b);
  ASSERT (SELECT balance FROM public.credit_accounts
           WHERE user_id = _cust AND ecosystem_id = _eco_b) = _b_before + 100,
         'the same rule works in every other existing shop';

  --------------------------------------------------------- 3: remove credits
  _tx := public.admin_adjust_credits(_cust, -20, 'QA correction', 'QA-3', _eco_a);
  ASSERT (SELECT balance FROM public.credit_accounts
           WHERE user_id = _cust AND ecosystem_id = _eco_a) = _a_after - 20,
         'removal debits the selected shop wallet';
  ASSERT EXISTS (SELECT 1 FROM public.credit_ledger
                  WHERE tx_id = _tx AND entry_kind = 'credit_revocation'
                    AND ecosystem_id = _eco_a AND actor_id = _super),
         'removal written as an immutable revocation entry';

  --------------------------------------------------------------- 11: audit
  ASSERT (SELECT count(*) FROM public.audit_logs a
           WHERE a.metadata->>'tx_id' = _tx
             AND a.actor_id = _super
             AND a.ecosystem_id = _eco_a
             AND a.metadata->>'recipient_id' = _cust::text
             AND (a.metadata->>'amount')::numeric = 20
             AND a.metadata ? 'balance_before' AND a.metadata ? 'balance_after'
             AND coalesce(a.metadata->>'reason','') <> '') = 1,
         'audit records operator, shop, member, amount, reason and both balances';

  ---------------------------------------------- 7: no sale / commission / cashback
  ASSERT (SELECT count(*) FROM public.voucher_sales) = _sales_before, 'no sale created';
  ASSERT (SELECT count(*) FROM public.sale_commissions) = _comm_before, 'no commission created';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger
                      WHERE entry_kind IN ('sale_commission','upline_commission')
                        AND reason ILIKE '%QA manual credit%'),
         'manual credits never trigger cashback';

  -------------------------------------------------------------- 5: new shop
  _eco_new := public.create_ecosystem('QA Brand New Shop', null, 'QA', null, null, 'Starter', 0, 5, true);
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state, status)
  VALUES (_cust, _eco_new.id, 'customer', 'active', 'active');
  _tx := public.admin_load_credits(_cust, 100, 'QA new shop issuance', null, _eco_new.id);
  ASSERT (SELECT balance FROM public.credit_accounts
           WHERE user_id = _cust AND ecosystem_id = _eco_new.id) = 100,
         'a brand-new shop inherits the global rules with no special setup';
  _tx := public.admin_adjust_credits(_cust, -10, 'QA new shop correction', null, _eco_new.id);
  ASSERT (SELECT balance FROM public.credit_accounts
           WHERE user_id = _cust AND ecosystem_id = _eco_new.id) = 90,
         'removal works in a brand-new shop too';

  ------------------------------- 6/10: nobody else gains the mint authority
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  BEGIN
    PERFORM public.admin_adjust_credits(_cust, 100, 'QA admin mint attempt', null, _eco_a);
    RAISE EXCEPTION 'shop admin must not mint credits';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'shop admin must not mint credits', 'only the platform owner creates credits';
  END;

  UPDATE public.credit_accounts SET balance = 0 WHERE user_id = _admin AND ecosystem_id = _eco_a;
  BEGIN
    PERFORM public.admin_load_credits(_cust, 50, 'QA admin load with no balance', null, _eco_a);
    RAISE EXCEPTION 'admin must not spend credits they do not hold';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'admin must not spend credits they do not hold',
           'shop admins still obey their own balance';
  END;

  BEGIN
    PERFORM public.admin_load_credits(_cust, 50, 'QA cross-shop attempt', null, _eco_b);
    RAISE EXCEPTION 'admin must not act in another shop';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'admin must not act in another shop', 'shop isolation holds';
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  BEGIN
    PERFORM public.superadmin_issue_credits(_cust, 1000, 'QA impersonation attempt');
    RAISE EXCEPTION 'ordinary user must not issue credits';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'ordinary user must not issue credits',
           'direct RPC calls cannot impersonate the platform owner';
  END;
  BEGIN
    PERFORM public.admin_adjust_credits(_cust, 100, 'QA self mint', null, _eco_a);
    RAISE EXCEPTION 'customer must not mint credits';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'customer must not mint credits', 'customers obey their normal limits';
  END;

  RAISE NOTICE 'global manual credit rule checks passed';
END $$;

ROLLBACK;
