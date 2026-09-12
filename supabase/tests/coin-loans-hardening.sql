-- Coin loans, production paths.
--
-- Unlike coin-loans.sql (which exercises the rules through the ledger), this
-- suite drives the REAL money RPCs a member can call: voucher purchase,
-- Universe coin transfer, cash out request, platform credit adjustment and
-- top ups, and it checks the refund path cannot turn loaned coins into free
-- coins.
--
-- Run inside a transaction and roll back so no test data is persisted:
--   BEGIN; \i supabase/tests/coin-loans-hardening.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _mine uuid; _other uuid;
  _res uuid := gen_random_uuid(); _cust uuid := gen_random_uuid(); _owner uuid := gen_random_uuid();
  _acct uuid; _loan public.coin_loans; _err text; _r record;
  _p_mine uuid; _p_other uuid;
  _before numeric; _restricted numeric; _bal numeric; _sum numeric;
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind, store_voucher_enabled)
  VALUES ('Loan Home Shop', 'loan-home-shop', 'tok-lh', 'Test', 0, 10, 'active', 'universe', true)
  RETURNING id INTO _mine;
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind, store_voucher_enabled)
  VALUES ('Loan Away Shop', 'loan-away-shop', 'tok-la', 'Test', 0, 10, 'active', 'universe', true)
  RETURNING id INTO _other;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES (_res,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lh-res@test.local', '', now(), now()),
         (_cust,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lh-cus@test.local', '', now(), now()),
         (_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lh-own@test.local', '', now(), now());

  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  VALUES (_res, _mine, 'reseller', 'active'), (_cust, _mine, 'customer', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_res, 'reseller', _mine), (_cust, 'customer', _mine);
  INSERT INTO public.user_roles (user_id, role) VALUES (_owner, 'super_admin');
  UPDATE public.profiles SET ecosystem_id = _mine, status = 'active' WHERE id IN (_res, _cust);

  UPDATE public.platform_settings
     SET loans_enabled = true, loan_auto_base_credits = 1000,
         loan_free_balance_multiplier = 3, loan_monthly_interest_percent = 2,
         loan_first_month_upfront = true
   WHERE id = 1;

  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_mine, 'Home 10', 'test', 10, true) RETURNING id INTO _p_mine;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _mine, _p_mine, 'H-' || g, 'unused' FROM generate_series(1, 20) g;
  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_other, 'Away 10', 'test', 10, true) RETURNING id INTO _p_other;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _other, _p_other, 'A-' || g, 'unused' FROM generate_series(1, 20) g;

  PERFORM public.ensure_global_wallet(_res);
  PERFORM public.ensure_global_wallet(_cust);
  SELECT id INTO _acct FROM public.credit_accounts WHERE user_id = _res AND ecosystem_id IS NULL;

  -- Borrow 1000 -> 980 restricted coins ---------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _loan FROM public.request_coin_loan(1000);
  ASSERT _loan.status = 'active', 'loan released';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 980, 'all 980 restricted';
  ASSERT public.free_coin_balance(_res) = 0, 'no free coins';

  -- 1. Real voucher purchase in the shop the borrower belongs to --------------
  SELECT balance INTO _before FROM public.credit_accounts WHERE id = _acct;
  SELECT * INTO _r FROM public.purchase_voucher(_p_mine, 2, NULL);
  SELECT balance, restricted_balance INTO _bal, _restricted
    FROM public.credit_accounts WHERE id = _acct;
  ASSERT _bal < _before, 'the purchase was paid from the wallet';
  ASSERT _restricted = _bal, 'restricted follows the balance down, got ' || _restricted || ' vs ' || _bal;

  -- 2. Real voucher purchase in a shop the borrower has no position in --------
  BEGIN
    PERFORM public.purchase_voucher(_p_other, 1, NULL);
    RAISE EXCEPTION 'loaned coins must not buy from an unaffiliated shop';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%', 'unaffiliated purchase refused: ' || _err;
  END;

  -- ... but free coins can buy anywhere ---------------------------------------
  INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _res, 'credit', 200, 'gift received', 'general', _res);
  ASSERT public.free_coin_balance(_res) = 200, 'the gift is free to spend';
  SELECT * INTO _r FROM public.purchase_voucher(_p_other, 1, NULL);
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = _restricted,
         'an away purchase never eats into the loaned coins';

  -- 3. Universe coin transfer is refused while coins are loaned ---------------
  BEGIN
    PERFORM public.transfer_universe_coins(_cust, 500, 'gift', gen_random_uuid()::text);
    RAISE EXCEPTION 'loaned coins must not be transferable';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%' OR _err LIKE '%balance%',
           'transfer refused: ' || _err;
  END;

  -- 4. Cash out is refused while coins are loaned -----------------------------
  BEGIN
    PERFORM public.request_withdrawal(500, 'ewallet', 'Res', '09171234567', NULL,
                                      gen_random_uuid()::text, NULL, 'universe');
    RAISE EXCEPTION 'loaned coins must not be cashed out';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%' OR _err LIKE '%balance%' OR _err LIKE '%available%',
           'cash out refused: ' || _err;
  END;

  -- 5. Retail cart holds follow the same rule ---------------------------------
  SELECT restricted_balance INTO _restricted FROM public.credit_accounts WHERE id = _acct;
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                      reason, entry_kind, actor_id)
    VALUES (_acct, _res, _other, 'debit', 600, 'retail order hold', 'retail_hold', _res);
    RAISE EXCEPTION 'a retail order in an unaffiliated shop must not use loaned coins';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%', 'unaffiliated retail hold refused: ' || _err;
  END;

  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    reason, entry_kind, actor_id)
  VALUES (_acct, _res, _mine, 'debit', 100, 'retail order hold', 'retail_hold', _res);
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) <= _restricted,
         'an affiliated retail hold is allowed and reduces the loaned portion';

  -- 6. A refund of loan-funded spending comes back as loaned coins ------------
  SELECT balance, restricted_balance INTO _bal, _restricted
    FROM public.credit_accounts WHERE id = _acct;
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    reason, entry_kind, actor_id)
  VALUES (_acct, _res, _mine, 'credit', 100, 'retail order refunded', 'retail_refund', _res);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = _bal + 100, 'refund credited';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct)
         = least(_restricted + 100, (SELECT outstanding FROM public.coin_loans WHERE id = _loan.id)),
         'the refund is restricted again, got '
         || (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct);
  BEGIN
    PERFORM public.transfer_universe_coins(_cust, public.free_coin_balance(_res) + 100, 'gift',
                                           gen_random_uuid()::text);
    RAISE EXCEPTION 'refunded loan coins must still not be transferable';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    ASSERT _err LIKE '%Loaned coins%' OR _err LIKE '%balance%', 'refund laundering blocked: ' || _err;
  END;

  -- Restriction never exceeds what is still owed ------------------------------
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct)
         <= (SELECT outstanding FROM public.coin_loans WHERE id = _loan.id),
         'restricted coins never exceed the amount owed';

  -- 7. The platform owner can still take coins back ---------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  SELECT balance INTO _bal FROM public.credit_accounts WHERE id = _acct;
  PERFORM public.admin_adjust_credits(_res, -50, 'Correction', NULL, NULL);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = _bal - 50,
         'the owner adjustment went through';

  -- 8. Platform issued coins pay the loan down first --------------------------
  SELECT outstanding INTO _before FROM public.coin_loans WHERE id = _loan.id;
  INSERT INTO public.credit_ledger (account_id, user_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _res, 'credit', 100, 'platform credit', 'credit_issue', _owner);
  ASSERT (SELECT outstanding FROM public.coin_loans WHERE id = _loan.id) = _before - 100,
         'issued coins repaid the loan first, outstanding '
         || (SELECT outstanding FROM public.coin_loans WHERE id = _loan.id);

  -- 9. Wallet integrity: the account still equals its ledger ------------------
  SELECT coalesce(sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)
    INTO _sum FROM public.credit_ledger WHERE account_id = _acct;
  SELECT balance, restricted_balance INTO _bal, _restricted
    FROM public.credit_accounts WHERE id = _acct;
  ASSERT _bal = _sum, 'wallet balance matches the ledger: ' || _bal || ' vs ' || _sum;
  ASSERT _restricted >= 0 AND _restricted <= _bal, 'restricted portion stays within the balance';

  -- 10. Loan tables are not directly writable by app users --------------------
  ASSERT NOT has_table_privilege('authenticated', 'public.coin_loans', 'UPDATE'),
         'members cannot write loans directly';
  ASSERT NOT has_table_privilege('authenticated', 'public.coin_loan_entries', 'INSERT'),
         'members cannot write loan events directly';
  ASSERT NOT has_table_privilege('authenticated', 'public.credit_accounts', 'UPDATE'),
         'members cannot write wallets directly';
  ASSERT NOT has_function_privilege('authenticated', 'public.release_coin_loan(uuid)', 'EXECUTE'),
         'members cannot release their own loan';
  ASSERT NOT has_function_privilege('authenticated', 'public.apply_loan_repayment(uuid,numeric,text)', 'EXECUTE'),
         'members cannot rewrite repayments';
  ASSERT NOT has_function_privilege('authenticated', 'public.guard_restricted_coins()', 'EXECUTE'),
         'the guard is internal only';

  RAISE NOTICE 'coin loan production paths: all assertions passed';
END $$;

ROLLBACK;
