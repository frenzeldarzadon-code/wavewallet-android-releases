-- Final production audit for coin loans and restricted (loaned) coins.
--
-- Drives the REAL RPCs: request/review/cancel/repay loan, interest accrual,
-- voucher purchase at an affiliated / frozen / archived / unaffiliated shop,
-- Universe coin transfer, shop-to-shop transfer, social credit purchase,
-- cash out request, top up repayment and the wallet integrity check.
--
-- Run inside a transaction and roll back so no test data is persisted:
--   BEGIN; \i supabase/tests/coin-loans-production-audit.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _mine uuid; _frozen uuid; _away uuid;
  _res uuid := gen_random_uuid(); _peer uuid := gen_random_uuid(); _owner uuid := gen_random_uuid();
  _acct uuid; _loan public.coin_loans; _err text;
  _p_mine uuid; _p_frozen uuid; _p_away uuid;
  _bal numeric; _restricted numeric; _out numeric; _n integer; _rows integer;
BEGIN
  -- Shops -------------------------------------------------------------------
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price,
                                 credits_per_point, subscription_state, shop_kind, store_voucher_enabled)
  VALUES ('Audit Home', 'audit-home', 'tok-ah', 'Test', 0, 10, 'active', 'universe', true),
         ('Audit Frozen', 'audit-frozen', 'tok-af', 'Test', 0, 10, 'active', 'universe', true),
         ('Audit Away', 'audit-away', 'tok-aw', 'Test', 0, 10, 'active', 'universe', true);
  SELECT id INTO _mine FROM public.ecosystems WHERE slug = 'audit-home';
  SELECT id INTO _frozen FROM public.ecosystems WHERE slug = 'audit-frozen';
  SELECT id INTO _away FROM public.ecosystems WHERE slug = 'audit-away';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES (_res,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aud-res@test.local', '', now(), now()),
         (_peer,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aud-peer@test.local', '', now(), now()),
         (_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aud-own@test.local', '', now(), now());

  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  VALUES (_res, _mine, 'reseller', 'active'),
         (_res, _frozen, 'reseller', 'active'),
         (_peer, _mine, 'customer', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_res, 'reseller', _mine), (_peer, 'customer', _mine);
  INSERT INTO public.user_roles (user_id, role) VALUES (_owner, 'super_admin');
  UPDATE public.profiles SET ecosystem_id = _mine, status = 'active' WHERE id IN (_res, _peer);

  UPDATE public.platform_settings
     SET loans_enabled = true, loan_auto_base_credits = 1000,
         loan_free_balance_multiplier = 3, loan_monthly_interest_percent = 2,
         loan_first_month_upfront = true
   WHERE id = 1;

  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_mine, 'Home 10', 'test', 10, true) RETURNING id INTO _p_mine;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _mine, _p_mine, 'AH-' || g, 'unused' FROM generate_series(1, 20) g;
  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_frozen, 'Frozen 10', 'test', 10, true) RETURNING id INTO _p_frozen;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _frozen, _p_frozen, 'AF-' || g, 'unused' FROM generate_series(1, 20) g;
  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_away, 'Away 10', 'test', 10, true) RETURNING id INTO _p_away;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _away, _p_away, 'AW-' || g, 'unused' FROM generate_series(1, 20) g;

  PERFORM public.ensure_global_wallet(_res);
  PERFORM public.ensure_global_wallet(_peer);
  SELECT id INTO _acct FROM public.credit_accounts WHERE user_id = _res AND ecosystem_id IS NULL;

  -- 1. Auto approval limit = MAX(base, multiplier x free balance) ------------
  ASSERT public.coin_loan_auto_limit(_res) = 1000, 'limit floors at the configured base';
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _res, NULL, 'credit', 500, 'seed free coins', 'admin_cash_in', _res);
  ASSERT public.coin_loan_auto_limit(_res) = 1500, '3 x 500 free coins beats the base';
  ASSERT public.free_coin_balance(_res) = 500, 'free balance excludes nothing yet';

  -- 2. Over the limit needs the platform owner -------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _loan FROM public.request_coin_loan(5000);
  ASSERT _loan.status = 'pending', 'over limit stays pending';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 500, 'pending loan releases nothing';

  -- a borrower cannot approve their own loan
  BEGIN
    PERFORM public.review_coin_loan(_loan.id, true, NULL);
    RAISE EXCEPTION 'borrower approved their own loan';
  EXCEPTION WHEN others THEN
    _err := SQLERRM;
    ASSERT _err LIKE '%platform owner%', 'self approval refused: ' || _err;
  END;

  -- one open loan at a time
  BEGIN
    PERFORM public.request_coin_loan(100);
    RAISE EXCEPTION 'second loan allowed';
  EXCEPTION WHEN others THEN
    _err := SQLERRM;
    ASSERT _err LIKE '%already have a loan%', 'one open loan only: ' || _err;
  END;

  -- owner rejects it; nothing is released
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  SELECT * INTO _loan FROM public.review_coin_loan(_loan.id, false, 'too big');
  ASSERT _loan.status = 'rejected', 'rejected';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _acct) = 500, 'rejection releases nothing';

  -- 3. Within the limit releases immediately, less upfront interest ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _loan FROM public.request_coin_loan(1000);
  ASSERT _loan.status = 'active', 'auto released';
  ASSERT _loan.first_month_interest = 20, '2% upfront interest';
  ASSERT _loan.released_amount = 980, '980 coins reach the wallet';
  ASSERT _loan.outstanding = 1000, 'the full principal is owed';
  SELECT balance, restricted_balance INTO _bal, _restricted FROM public.credit_accounts WHERE id = _acct;
  ASSERT _bal = 1480, 'wallet holds 500 free + 980 loaned';
  ASSERT _restricted = 980, '980 coins are restricted';
  ASSERT public.free_coin_balance(_res) = 500, 'free balance excludes loaned coins';

  -- 4. Loaned coins cannot leave the wallet ----------------------------------
  BEGIN
    PERFORM public.transfer_universe_coins(_peer, 800, 'gift');
    RAISE EXCEPTION 'loaned coins were gifted';
  EXCEPTION WHEN others THEN
    _err := SQLERRM;
    ASSERT _err LIKE '%Loaned coins%' OR _err LIKE '%Insufficient%', 'gift blocked: ' || _err;
  END;

  BEGIN
    PERFORM public.request_withdrawal(800, 'ewallet', 'Res', '09170000000', NULL, NULL, 'superadmin', 'universe');
    RAISE EXCEPTION 'loaned coins were cashed out';
  EXCEPTION WHEN others THEN
    _err := SQLERRM;
    ASSERT _err LIKE '%Loaned coins%' OR _err LIKE '%Insufficient%', 'cash out blocked: ' || _err;
  END;

  -- loaned coins cannot be pushed into a shop wallet either
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
    VALUES (_acct, _res, NULL, 'debit', 800, 'shop transfer', 'shop_transfer_out', _res);
    RAISE EXCEPTION 'loaned coins moved to a shop wallet';
  EXCEPTION WHEN others THEN
    _err := SQLERRM;
    ASSERT _err LIKE '%Loaned coins%' OR _err LIKE '%Insufficient%', 'shop transfer blocked: ' || _err;
  END;

  -- free coins still move freely
  PERFORM public.transfer_universe_coins(_peer, 100, 'free coins');
  ASSERT public.free_coin_balance(_res) = 400, 'free coins are still spendable';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 980, 'restriction untouched';

  -- 5. Buying at an unaffiliated shop is refused -----------------------------
  BEGIN
    PERFORM public.purchase_voucher(_p_away, 100, NULL);
    RAISE EXCEPTION 'loaned coins spent at an unaffiliated shop';
  EXCEPTION WHEN others THEN
    _err := SQLERRM;
    ASSERT _err LIKE '%Loaned coins%' OR _err LIKE '%Insufficient%' OR _err LIKE '%member%',
      'unaffiliated shop blocked: ' || _err;
  END;

  -- 6. Frozen and archived affiliated shops do not unlock loaned coins -------
  UPDATE public.ecosystems SET operations_frozen = true, frozen_at = now() WHERE id = _frozen;
  ASSERT public.loan_spend_allowed_in(_res, _frozen) = false, 'frozen shop cannot consume loaned coins';
  UPDATE public.ecosystems SET operations_frozen = false, archived_at = now() WHERE id = _frozen;
  ASSERT public.loan_spend_allowed_in(_res, _frozen) = false, 'archived shop cannot consume loaned coins';
  UPDATE public.ecosystems SET archived_at = NULL WHERE id = _frozen;
  ASSERT public.loan_spend_allowed_in(_res, _frozen) = true, 'an open affiliated shop can';
  ASSERT public.loan_spend_allowed_in(_res, _away) = false, 'no membership, no spending';
  ASSERT public.loan_spend_allowed_in(_res, NULL) = false, 'a missing shop id never passes';

  -- 7. Buying at the affiliated shop consumes loaned coins -------------------
  PERFORM public.purchase_voucher(_p_mine, 50, NULL);   -- 50 x 10 credits = 500
  SELECT balance, restricted_balance INTO _bal, _restricted FROM public.credit_accounts WHERE id = _acct;
  ASSERT _bal = 880, 'wallet charged for the purchase: ' || _bal;
  ASSERT _restricted = 880, 'free coins go first, then loaned coins: ' || _restricted;
  ASSERT public.free_coin_balance(_res) = 0, 'free coins are used up';

  -- 8. Interest accrual is idempotent per period -----------------------------
  UPDATE public.coin_loans SET released_at = now() - interval '65 days' WHERE id = _loan.id;
  SELECT public.accrue_coin_loan_interest() INTO _n;
  ASSERT _n = 2, 'two monthly periods accrued, got ' || _n;
  SELECT outstanding INTO _out FROM public.coin_loans WHERE id = _loan.id;
  ASSERT _out = 1040.40, 'interest on the unpaid balance: ' || _out;
  SELECT public.accrue_coin_loan_interest() INTO _n;
  ASSERT _n = 0, 'a retry adds nothing';
  SELECT outstanding INTO _out FROM public.coin_loans WHERE id = _loan.id;
  ASSERT _out = 1040.40, 'outstanding unchanged after the retry: ' || _out;
  SELECT count(*) INTO _rows FROM public.coin_loan_entries
   WHERE loan_id = _loan.id AND kind = 'interest';
  ASSERT _rows = 2, 'exactly one entry per period';

  -- 9. A top up repays the loan first, the rest becomes free coins -----------
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _res, NULL, 'credit', 200, 'top up', 'cash_in', _res);
  SELECT outstanding INTO _out FROM public.coin_loans WHERE id = _loan.id;
  ASSERT _out = 840.40, 'top up repaid 200: ' || _out;
  SELECT balance, restricted_balance INTO _bal, _restricted FROM public.credit_accounts WHERE id = _acct;
  ASSERT _bal = 880, 'repayment leaves the wallet: ' || _bal;
  ASSERT _restricted = 880, 'restriction follows the balance: ' || _restricted;

  -- a large top up settles the loan and leaves the excess free
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
  VALUES (_acct, _res, NULL, 'credit', 1000, 'big top up', 'cash_in', _res);
  SELECT status, outstanding INTO _loan.status, _out FROM public.coin_loans WHERE id = _loan.id;
  ASSERT _loan.status = 'settled', 'loan settled by the top up';
  ASSERT _out = 0, 'nothing left owing';
  SELECT balance, restricted_balance INTO _bal, _restricted FROM public.credit_accounts WHERE id = _acct;
  ASSERT _restricted = 0, 'no coins stay restricted: ' || _restricted;
  ASSERT _bal = 1039.60, 'the excess stays as free coins: ' || _bal;
  ASSERT public.free_coin_balance(_res) = 1039.60, 'all of it is free';

  -- the settled loan no longer blocks a new request
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT * INTO _loan FROM public.request_coin_loan(500);
  ASSERT _loan.status = 'active', 'a new loan may be taken once settled';
  PERFORM public.repay_coin_loan(500);
  ASSERT (SELECT status FROM public.coin_loans WHERE id = _loan.id) = 'settled', 'manual repayment settles';
  ASSERT (SELECT restricted_balance FROM public.credit_accounts WHERE id = _acct) = 0, 'restriction cleared';

  -- 10. Wallet and ledger still agree, and nothing is negative ---------------
  SELECT balance INTO _bal FROM public.credit_accounts WHERE id = _acct;
  SELECT coalesce(sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)
    INTO _out FROM public.credit_ledger WHERE account_id = _acct;
  ASSERT _bal = _out, 'wallet matches its ledger: ' || _bal || ' vs ' || _out;
  ASSERT _bal >= 0, 'no negative balance';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  SELECT count(*) INTO _rows FROM public.wallet_integrity_check() WHERE kind = 'loaned coins';
  ASSERT _rows = 0, 'no restricted coin mismatches reported';

  -- 11. Loans switched off stop new requests ---------------------------------
  UPDATE public.platform_settings SET loans_enabled = false WHERE id = 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  BEGIN
    PERFORM public.request_coin_loan(100);
    RAISE EXCEPTION 'loan taken while loans are off';
  EXCEPTION WHEN others THEN
    _err := SQLERRM;
    ASSERT _err LIKE '%not available%', 'loans off: ' || _err;
  END;

  RAISE NOTICE 'coin loan production audit passed';
END $$;

ROLLBACK;
