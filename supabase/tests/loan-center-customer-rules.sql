-- Loan Center rules: customers always wait for manual approval, customer loan
-- coins buy from ANY Universe shop while position holders stay shop-restricted,
-- restricted coins can still never be transferred, gifted or cashed out, and a
-- platform-owner manual loan is a real, idempotent loan record.
-- Run inside a transaction and ROLLBACK: no data is kept.
BEGIN;

DO $$
DECLARE
  _shopA uuid; _shopB uuid;
  _cust uuid := gen_random_uuid(); _res uuid := gen_random_uuid();
  _owner uuid := gen_random_uuid();
  _loan public.coin_loans; _loan2 public.coin_loans;
  _acct uuid; _err text; _n int;
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind)
  VALUES ('LC Shop A', 'lc-shop-a', 'tok-lc-a', 'Test', 0, 10, 'active', 'universe')
  RETURNING id INTO _shopA;
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind)
  VALUES ('LC Shop B', 'lc-shop-b', 'tok-lc-b', 'Test', 0, 10, 'active', 'universe')
  RETURNING id INTO _shopB;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES (_cust,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc-cus@test.local', '', now(), now()),
         (_res,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc-res@test.local', '', now(), now()),
         (_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lc-own@test.local', '', now(), now());

  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  VALUES (_cust, _shopA, 'customer', 'active'),
         (_res,  _shopA, 'reseller', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_cust, 'customer', _shopA), (_res, 'reseller', _shopA);
  INSERT INTO public.user_roles (user_id, role) VALUES (_owner, 'super_admin');
  UPDATE public.profiles SET ecosystem_id = _shopA, status = 'active'
   WHERE id IN (_cust, _res);
  UPDATE public.profiles SET status = 'active' WHERE id = _owner;

  UPDATE public.platform_settings
     SET loans_enabled = true, loan_auto_base_credits = 1000,
         loan_free_balance_multiplier = 3, loan_monthly_interest_percent = 2,
         loan_first_month_upfront = true
   WHERE id = 1;

  -- 1. A customer is never auto-approved, whatever the amount ----------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  SELECT * INTO _loan FROM public.request_coin_loan(10);
  ASSERT _loan.status = 'pending', 'tiny customer loan still waits, got ' || _loan.status;
  ASSERT _loan.approval_mode = 'manual', 'customer approval is manual';
  ASSERT _loan.auto_limit_snapshot = 0, 'a customer has no automatic limit';
  ASSERT _loan.borrower_role = 'customer', 'role snapshot recorded';
  ASSERT _loan.universe_spend, 'customer loan spends Universe-wide';
  ASSERT (SELECT coalesce(balance, 0) FROM public.credit_accounts
           WHERE user_id = _cust AND ecosystem_id IS NULL) = 0, 'nothing released to a customer yet';

  -- 2. A position holder within the limit is still released automatically ----
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _loan2 FROM public.request_coin_loan(1000);
  ASSERT _loan2.status = 'active', 'reseller auto approval preserved, got ' || _loan2.status;
  ASSERT _loan2.approval_mode = 'automatic', 'automatic mode preserved';
  ASSERT NOT _loan2.universe_spend, 'position-holder loans stay shop restricted';
  ASSERT public.loan_spend_allowed_in(_res, _shopA), 'reseller may spend in their own shop';
  ASSERT NOT public.loan_spend_allowed_in(_res, _shopB), 'reseller may NOT spend in another shop';

  -- 3. The platform owner approves the customer loan -------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  SELECT * INTO _loan FROM public.review_coin_loan(_loan.id, true, 'approved in test');
  ASSERT _loan.status = 'active', 'customer loan released after approval';
  ASSERT _loan.released_amount = 9.8, '10 less 2% interest, got ' || _loan.released_amount;
  ASSERT _loan.decided_by = _owner, 'approver recorded';

  SELECT id INTO _acct FROM public.credit_accounts
   WHERE user_id = _cust AND ecosystem_id IS NULL;
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 9.8, 'coins credited';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 9.8,
         'all customer loan coins restricted';

  -- 4. Customer loan coins buy from ANY Universe shop ------------------------
  ASSERT public.loan_spend_allowed_in(_cust, _shopA), 'own shop allowed';
  ASSERT public.loan_spend_allowed_in(_cust, _shopB), 'any other Universe shop allowed';
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    reason, entry_kind, actor_id)
  VALUES (_acct, _cust, _shopB, 'debit', 5, 'voucher in another shop', 'purchase', _cust);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 4.8, 'purchase went through';

  -- 5. ...but they can never be transferred, gifted or cashed out ------------
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _cust, 'debit', 1, 'gift', 'general', _cust);
    RAISE EXCEPTION 'a gift of loaned coins must be refused';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%', 'gift refused: ' || _err;
  END;
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _cust, 'debit', 1, 'cash out hold', 'withdrawal_hold', _cust);
    RAISE EXCEPTION 'cashing out loaned coins must be refused';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%', 'cash out refused: ' || _err;
  END;

  -- 6. Repayment lowers the one authoritative balance ------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  PERFORM public.repay_coin_loan(4);
  SELECT * INTO _loan FROM public.coin_loans WHERE id = _loan.id;
  ASSERT _loan.outstanding = 6, 'outstanding 10 - 4, got ' || _loan.outstanding;
  ASSERT (SELECT outstanding FROM public.my_coin_loan_summary()) = 6,
         'the member summary reads the same balance';

  -- 7. Manual loan by the platform owner, idempotent -------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  BEGIN
    PERFORM public.superadmin_create_manual_loan(_cust, 100, 'second loan', 'tok-1');
    RAISE EXCEPTION 'a member with an active loan must not get another';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%already has a loan%', 'one loan at a time: ' || _err;
  END;

  -- settle the customer loan, then book a manual one
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _cust, 'credit', 50, 'top up', 'cash_in', _cust);
  ASSERT (SELECT status FROM public.coin_loans WHERE id = _loan.id) = 'settled',
         'a top up repays the loan first';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  SELECT * INTO _loan FROM public.superadmin_create_manual_loan(_cust, 200, 'goodwill', 'tok-manual-1');
  ASSERT _loan.status = 'active', 'manual loan is released straight away';
  ASSERT _loan.origin = 'super_admin_manual', 'origin recorded';
  ASSERT _loan.created_by = _owner, 'creator recorded';
  ASSERT _loan.reference_note = 'goodwill', 'note recorded';
  ASSERT _loan.released_amount = 196, '200 less 2%, got ' || _loan.released_amount;
  ASSERT _loan.universe_spend, 'a customer manual loan spends Universe-wide';

  -- the same token twice returns the same loan, never a second one
  SELECT * INTO _loan2 FROM public.superadmin_create_manual_loan(_cust, 200, 'goodwill', 'tok-manual-1');
  ASSERT _loan2.id = _loan.id, 'duplicate submit returns the same loan';
  SELECT count(*) INTO _n FROM public.coin_loans
   WHERE user_id = _cust AND origin = 'super_admin_manual';
  ASSERT _n = 1, 'only one manual loan exists, found ' || _n;

  -- it shows in the member's own Loan Center and in the owner's report
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  ASSERT (SELECT count(*) FROM public.my_coin_loans() WHERE id = _loan.id) = 1,
         'manual loan visible to the member';
  ASSERT (SELECT outstanding FROM public.my_coin_loan_summary()) = 200,
         'member sees the manual loan balance';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  ASSERT (SELECT count(*) FROM public.super_coin_loans() WHERE id = _loan.id) = 1,
         'manual loan in the platform report';

  -- 8. Only the platform owner may create a manual loan ----------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  BEGIN
    PERFORM public.superadmin_create_manual_loan(_res, 50, 'self', 'tok-self');
    RAISE EXCEPTION 'a member must not create a loan';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%platform owner%', 'authorization enforced: ' || _err;
  END;

  RAISE NOTICE 'loan center customer rules: all assertions passed';
END $$;

ROLLBACK;
