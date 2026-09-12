-- Coin loans: automatic limit, upfront interest, restricted coins, top-up
-- repayment priority, affiliated-only spending, monthly accrual, one loan rule.
-- Run inside a transaction and ROLLBACK: no data is kept.
BEGIN;

DO $$
DECLARE
  _uni uuid; _other uuid; _res uuid := gen_random_uuid(); _cust uuid := gen_random_uuid();
  _adm uuid := gen_random_uuid(); _loan public.coin_loans; _acct uuid; _err text;
  _prod uuid; _r record; _paid numeric; _n int;
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind)
  VALUES ('Loan Universe', 'loan-universe', 'tok-loan', 'Test', 0, 10, 'active', 'universe')
  RETURNING id INTO _uni;
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind)
  VALUES ('Loan Other', 'loan-other', 'tok-loan2', 'Test', 0, 10, 'active', 'universe')
  RETURNING id INTO _other;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES (_adm,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'loan-adm@test.local', '', now(), now()),
         (_res,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'loan-res@test.local', '', now(), now()),
         (_cust, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'loan-cus@test.local', '', now(), now());

  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  VALUES (_adm, _uni, 'admin', 'active'),
         (_res, _uni, 'reseller', 'active'),
         (_cust, _uni, 'customer', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_adm, 'admin', _uni), (_res, 'reseller', _uni), (_cust, 'customer', _uni);
  UPDATE public.profiles SET ecosystem_id = _uni, status = 'active' WHERE id IN (_adm, _res, _cust);

  UPDATE public.platform_settings
     SET loans_enabled = true, loan_auto_base_credits = 1000,
         loan_free_balance_multiplier = 3, loan_monthly_interest_percent = 2,
         loan_first_month_upfront = true
   WHERE id = 1;

  PERFORM public.ensure_global_wallet(_res);
  PERFORM public.ensure_global_wallet(_cust);
  SELECT id INTO _acct FROM public.credit_accounts WHERE user_id = _res AND ecosystem_id IS NULL;

  -- 1. Automatic limit -------------------------------------------------------
  ASSERT public.coin_loan_auto_limit(_res) = 1000, 'zero free balance -> base 1000';
  UPDATE public.credit_accounts SET balance = 200 WHERE id = _acct;
  ASSERT public.coin_loan_auto_limit(_res) = 1000, '200 free -> still 1000';
  UPDATE public.credit_accounts SET balance = 500 WHERE id = _acct;
  ASSERT public.coin_loan_auto_limit(_res) = 1500, '500 free -> 1500';
  UPDATE public.credit_accounts SET balance = 2000 WHERE id = _acct;
  ASSERT public.coin_loan_auto_limit(_res) = 6000, '2000 free -> 6000';

  -- Restricted coins never count toward the 3x calculation
  UPDATE public.credit_accounts SET balance = 2000, restricted_balance = 1900 WHERE id = _acct;
  ASSERT public.free_coin_balance(_res) = 100, 'free balance excludes restricted';
  ASSERT public.coin_loan_auto_limit(_res) = 1000, 'restricted coins do not raise the limit';
  UPDATE public.credit_accounts SET balance = 0, restricted_balance = 0 WHERE id = _acct;

  -- 2. Only positions may borrow --------------------------------------------
  ASSERT public.has_loan_position(_res), 'reseller holds a position';
  ASSERT public.has_loan_position(_adm), 'admin holds a position';
  ASSERT NOT public.has_loan_position(_cust), 'plain customer does not';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  BEGIN
    PERFORM public.request_coin_loan(500);
    RAISE EXCEPTION 'customer should not be able to borrow';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%admin, reseller or subreseller%', 'customer refused: ' || _err;
  END;

  -- 3. Automatic release with upfront interest -------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _loan FROM public.request_coin_loan(1000);
  ASSERT _loan.status = 'active', 'within the limit -> released, got ' || _loan.status;
  ASSERT _loan.approval_mode = 'automatic', 'automatic mode';
  ASSERT _loan.first_month_interest = 20, '2% of 1000 = 20, got ' || _loan.first_month_interest;
  ASSERT _loan.released_amount = 980, '980 released, got ' || _loan.released_amount;
  ASSERT _loan.outstanding = 1000, '1000 owed, got ' || _loan.outstanding;
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 980, 'wallet holds 980';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 980, 'all 980 restricted';
  ASSERT public.free_coin_balance(_res) = 0, 'no free coins yet';

  -- 4. One active loan at a time --------------------------------------------
  BEGIN
    PERFORM public.request_coin_loan(100);
    RAISE EXCEPTION 'a second loan should be refused';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%already have a loan%', 'one loan only: ' || _err;
  END;

  -- 5. Restricted coins cannot be transferred, gifted or cashed out ----------
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _res, 'debit', 100, 'gift', 'general', _res);
    RAISE EXCEPTION 'restricted coins must not move as a transfer';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%', 'transfer refused: ' || _err;
  END;
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _res, 'debit', 100, 'cash out hold', 'withdrawal_hold', _res);
    RAISE EXCEPTION 'restricted coins must not be cashed out';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%', 'cash out refused: ' || _err;
  END;

  -- 6. Purchases: affiliated shop yes, unaffiliated no ------------------------
  ASSERT public.loan_spend_allowed_in(_res, _uni), 'affiliated shop allowed';
  ASSERT NOT public.loan_spend_allowed_in(_res, _other), 'unaffiliated shop not allowed';
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _res, _other, 'debit', 100, 'purchase elsewhere', 'purchase', _res);
    RAISE EXCEPTION 'loan coins must not buy from an unaffiliated shop';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%', 'unaffiliated purchase refused: ' || _err;
  END;

  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _res, _uni, 'debit', 300, 'purchase at own shop', 'purchase', _res);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 680, 'balance 680 after spending';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 680,
         'restricted follows the balance down';

  -- 7. Top-up repays the loan first, the excess is free ----------------------
  INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _res, 'credit', 400, 'cash in', 'cash_in', _res);
  -- 680 + 400 = 1080, 400 repaid -> 680 balance, outstanding 600
  ASSERT (SELECT outstanding FROM public.coin_loans WHERE id = _loan.id) = 600,
         'partial top up repaid 400, got ' || (SELECT outstanding FROM public.coin_loans WHERE id = _loan.id);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 680, 'balance back to 680';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 680, 'restricted unchanged';
  ASSERT (SELECT count(*) FROM public.coin_loan_entries WHERE loan_id = _loan.id AND kind = 'repayment') = 1,
         'the repayment is its own ledger-linked record';

  -- 8. Monthly interest accrual is idempotent --------------------------------
  UPDATE public.coin_loans SET released_at = now() - interval '65 days' WHERE id = _loan.id;
  SELECT public.accrue_coin_loan_interest() INTO _n;
  ASSERT _n = 2, 'two months accrued, got ' || _n;
  -- 600 -> 612 -> 624.24
  ASSERT (SELECT outstanding FROM public.coin_loans WHERE id = _loan.id) = 624.24,
         'compounded to 624.24, got ' || (SELECT outstanding FROM public.coin_loans WHERE id = _loan.id);
  SELECT public.accrue_coin_loan_interest() INTO _n;
  ASSERT _n = 0, 'a second run charges nothing again';
  ASSERT (SELECT outstanding FROM public.coin_loans WHERE id = _loan.id) = 624.24, 'still 624.24';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 680,
         'interest never becomes spendable loan coins';

  -- 9. Repayment cannot exceed the outstanding amount ------------------------
  SELECT public.repay_coin_loan(100000) INTO _paid;
  ASSERT _paid = 624.24, 'repays only what is owed, got ' || _paid;
  ASSERT (SELECT status FROM public.coin_loans WHERE id = _loan.id) = 'settled', 'loan settled';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 55.76, 'balance 680 - 624.24';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 55.76,
         'restricted clamped to the remaining balance';

  -- Leftover loan coins after settlement are released as free coins
  UPDATE public.credit_accounts SET restricted_balance = 0 WHERE id = _acct;

  -- 10. Above the limit -> manual approval -----------------------------------
  UPDATE public.credit_accounts SET balance = 100 WHERE id = _acct;
  SELECT * INTO _loan FROM public.request_coin_loan(5000);
  ASSERT _loan.status = 'pending', 'above the limit waits, got ' || _loan.status;
  ASSERT _loan.approval_mode = 'manual', 'manual mode';
  ASSERT _loan.auto_limit_snapshot = 1000, 'limit snapshot recorded';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 100, 'nothing released yet';

  -- A member cannot approve their own loan
  BEGIN
    PERFORM public.review_coin_loan(_loan.id, true, 'self');
    RAISE EXCEPTION 'only the platform owner may decide';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%platform owner%', 'authorization enforced: ' || _err;
  END;

  -- Platform owner approves
  INSERT INTO public.user_roles (user_id, role) VALUES (_adm, 'super_admin')
    ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _adm)::text, true);
  SELECT * INTO _loan FROM public.review_coin_loan(_loan.id, true, 'ok');
  ASSERT _loan.status = 'active', 'approved and released';
  ASSERT _loan.released_amount = 4900, '5000 less 100 interest, got ' || _loan.released_amount;
  ASSERT _loan.decided_by = _adm, 'approver recorded';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 5000, '100 + 4900';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 4900, 'released coins restricted';
  ASSERT public.free_coin_balance(_res) = 100, 'the original 100 stays free';

  -- Duplicate release attempt is refused
  BEGIN
    PERFORM public.release_coin_loan(_loan.id);
    RAISE EXCEPTION 'a released loan must not be released twice';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%already%', 'double release refused: ' || _err;
  END;

  -- Free coins still move freely while restricted coins stay put
  INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _res, 'debit', 100, 'gift of free coins', 'general', _res);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 4900, 'free coins spent';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 4900, 'restricted intact';

  RAISE NOTICE 'coin loan rules: all assertions passed';
END $$;

ROLLBACK;
