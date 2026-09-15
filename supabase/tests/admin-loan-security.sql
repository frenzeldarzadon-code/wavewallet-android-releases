-- Admin shop loan security.
--
-- A Universe shop admin's own free (global) coins secure what the members of
-- that shop still owe on their loans, interest included. Only the excess may
-- leave the admin's protected scope: purchases at other shops, cash out and
-- transfers/gifts outside the shop. Own-shop purchases and allocations to the
-- shop's own members remain allowed.
--
-- Run inside a transaction and ROLLBACK: no data is kept.
BEGIN;

DO $$
DECLARE
  _shop uuid; _other uuid; _adm uuid := gen_random_uuid(); _res uuid := gen_random_uuid();
  _res2 uuid := gen_random_uuid(); _adm2 uuid := gen_random_uuid();
  _acct uuid; _res_acct uuid; _loan public.coin_loans; _err text; _n int;
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind)
  VALUES ('Sec Shop', 'sec-shop', 'tok-sec', 'Test', 0, 10, 'active', 'universe')
  RETURNING id INTO _shop;
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind)
  VALUES ('Sec Other', 'sec-other', 'tok-sec2', 'Test', 0, 10, 'active', 'universe')
  RETURNING id INTO _other;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES (_adm,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec-adm@test.local', '', now(), now()),
         (_adm2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec-adm2@test.local', '', now(), now()),
         (_res,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec-res@test.local', '', now(), now()),
         (_res2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec-res2@test.local', '', now(), now());

  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  VALUES (_adm, _shop, 'admin', 'active'),
         (_res, _shop, 'reseller', 'active'),
         (_adm, _other, 'customer', 'active'),
         (_adm2, _other, 'admin', 'active'),
         (_res2, _other, 'reseller', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_adm, 'admin', _shop), (_res, 'reseller', _shop),
         (_adm2, 'admin', _other), (_res2, 'reseller', _other);
  UPDATE public.profiles SET ecosystem_id = _shop, status = 'active' WHERE id IN (_adm, _res);
  UPDATE public.profiles SET ecosystem_id = _other, status = 'active' WHERE id IN (_adm2, _res2);

  UPDATE public.platform_settings
     SET loans_enabled = true, loan_auto_base_credits = 100000,
         loan_free_balance_multiplier = 3, loan_monthly_interest_percent = 2,
         loan_first_month_upfront = false
   WHERE id = 1;

  _acct := public.ensure_global_wallet(_adm);
  _res_acct := public.ensure_global_wallet(_res);
  PERFORM public.ensure_global_wallet(_res2);
  UPDATE public.credit_accounts SET balance = 10000 WHERE id = _acct;

  -- No loans yet: nothing is secured.
  ASSERT public.admin_secured_loan_exposure(_adm) = 0, 'no loans -> no exposure';
  ASSERT public.admin_unsecured_balance(_adm) = 10000, 'all coins usable';

  -- A member of the shop borrows 6,000.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _loan FROM public.request_coin_loan(6000);
  ASSERT _loan.status = 'active', 'loan released, got ' || _loan.status;
  ASSERT _loan.secured_ecosystem_id = _shop, 'loan secured against the borrower''s shop';
  ASSERT _loan.secured_admin_id = _adm, 'loan secured by that shop''s admin';

  -- 1. 10,000 admin coins vs 6,000 owed -> 4,000 usable outside the shop.
  ASSERT public.admin_secured_loan_exposure(_adm) = 6000, 'exposure 6000, got ' || public.admin_secured_loan_exposure(_adm);
  ASSERT public.admin_unsecured_balance(_adm) = 4000, 'usable 4000';
  ASSERT public.admin_secured_loan_exposure(_res) = 0, 'a reseller secures nothing';
  ASSERT public.admin_secured_loan_exposure(_adm2) = 0, 'another shop''s admin secures nothing';

  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _adm, _other, 'debit', 4000, 'purchase at another shop', 'purchase', _adm);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 6000, 'spent exactly the excess';

  -- 2. One coin more may not leave the shop.
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _adm, _other, 'debit', 1, 'one coin too many', 'purchase', _adm);
    RAISE EXCEPTION 'the secured reserve must not be spendable outside the shop';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%reserved to secure%', 'clear reason given: ' || _err;
  END;

  -- 5,000 held vs 6,000 owed -> nothing may leave.
  UPDATE public.credit_accounts SET balance = 5000 WHERE id = _acct;
  ASSERT public.admin_unsecured_balance(_adm) = 0, 'below the exposure nothing is usable';
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _adm, _other, 'debit', 10, 'outside purchase', 'purchase', _adm);
    RAISE EXCEPTION 'under-secured admin must not spend outside';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 3. The admin may still buy at their own shop with the secured coins.
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _adm, _shop, 'debit', 1000, 'purchase at own shop', 'purchase', _adm);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 4000, 'own-shop purchase allowed';

  -- 4. Allocation to a member of the admin's own shop is allowed...
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _adm, _shop, 'debit', 500, 'allocation to own member', 'general', _adm);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_res_acct, _res, _shop, 'credit', 500, 'allocation received', 'general', _adm);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 3500, 'allocation left the admin wallet';

  -- 5. ...and does not release the reserve for outside spending.
  ASSERT public.admin_secured_loan_exposure(_adm) = 6000, 'exposure unchanged by allocation';
  ASSERT public.admin_unsecured_balance(_adm) = 0, 'still nothing usable outside';
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _adm, _other, 'debit', 100, 'outside purchase', 'purchase', _adm);
    RAISE EXCEPTION 'allocation must not be a bypass';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 9. Cash out and external gifts cannot consume the reserve.
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _adm, 'debit', 100, 'cash out hold', 'withdrawal_hold', _adm);
    RAISE EXCEPTION 'secured coins must not be cashable';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _adm, 'debit', 100, 'gift outside the shop', 'general', _adm);
    RAISE EXCEPTION 'secured coins must not be gifted away';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 7. Accrued interest raises the secured amount.
  UPDATE public.credit_accounts SET balance = 10000 WHERE id = _acct;
  ASSERT public.admin_unsecured_balance(_adm) = 4000, 'baseline 4000 usable';
  UPDATE public.coin_loans SET released_at = now() - interval '35 days' WHERE id = _loan.id;
  SELECT public.accrue_coin_loan_interest() INTO _n;
  ASSERT _n = 1, 'one month accrued';
  ASSERT public.admin_secured_loan_exposure(_adm) = 6120, 'interest included, got ' || public.admin_secured_loan_exposure(_adm);
  ASSERT public.admin_unsecured_balance(_adm) = 3880, 'usable drops with interest';

  -- 6. Repayment lowers the secured amount.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  UPDATE public.credit_accounts SET balance = 10000, restricted_balance = 6000 WHERE id = _res_acct;
  PERFORM public.repay_coin_loan(2000);
  ASSERT public.admin_secured_loan_exposure(_adm) = 4120, 'exposure after repayment, got ' || public.admin_secured_loan_exposure(_adm);
  ASSERT public.admin_unsecured_balance(_adm) = 5880, 'more coins freed up';

  -- 10. The member leaves the shop: the exposure stays secured.
  UPDATE public.ecosystem_memberships SET membership_state = 'removed'
   WHERE user_id = _res AND ecosystem_id = _shop;
  ASSERT public.admin_secured_loan_exposure(_adm) = 4120, 'leaving does not release the security';

  -- 11. The admin leaves the shop: the lock persists until the loan is settled.
  UPDATE public.ecosystem_memberships SET membership_state = 'removed'
   WHERE user_id = _adm AND ecosystem_id = _shop;
  ASSERT public.admin_secured_loan_exposure(_adm) = 4120, 'the admin stays liable after leaving';
  UPDATE public.credit_accounts SET balance = 4120 WHERE id = _acct;
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _adm, 'debit', 10, 'cash out after leaving', 'withdrawal_hold', _adm);
    RAISE EXCEPTION 'a departing admin must not withdraw the secured coins';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.ecosystem_memberships SET membership_state = 'active'
   WHERE user_id IN (_adm, _res) AND ecosystem_id = _shop;

  -- 12. Two shops, two loans: no double counting.
  UPDATE public.ecosystem_memberships SET role = 'admin' WHERE user_id = _adm AND ecosystem_id = _other;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res2)::text, true);
  PERFORM public.request_coin_loan(1000);
  ASSERT public.admin_secured_loan_exposure(_adm) = 5120,
         'each loan counted once, got ' || public.admin_secured_loan_exposure(_adm);

  -- 13. Settling the loan releases the security.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  UPDATE public.credit_accounts SET balance = 20000, restricted_balance = 0 WHERE id = _res_acct;
  PERFORM public.repay_coin_loan(100000);
  ASSERT (SELECT status FROM public.coin_loans WHERE id = _loan.id) = 'settled', 'loan settled';
  ASSERT public.admin_secured_loan_exposure(_adm) = 1000, 'only the other shop''s loan remains';

  -- 14. A plain member with no shop to secure is unaffected.
  ASSERT public.admin_secured_loan_exposure(_res) = 0, 'non-admin behaviour unchanged';

  RAISE NOTICE 'admin loan security: all assertions passed';
END $$;

ROLLBACK;
