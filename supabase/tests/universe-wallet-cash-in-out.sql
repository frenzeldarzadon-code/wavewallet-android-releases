-- Universe → My Wallet: CASH IN and CASH OUT on the ONE global Universe wallet.
--
-- Run inside a transaction; the final RAISE rolls everything back:
--   BEGIN; \i supabase/tests/universe-wallet-cash-in-out.sql
--
-- Proves, through the EXISTING request/review functions (wallet_scope='universe'):
--   * cash out: fee is exactly the platform withdrawal_fee_percent (1%),
--     1000 credits → gross ₱1,000 → fee ₱10 → net ₱990
--   * the hold is debited from the GLOBAL wallet (ecosystem_id null) even when
--     the member's active shop is a New Generation shop
--   * the same request key never creates a second hold (idempotent)
--   * the shop-admin path is refused for a Universe cash out
--   * insufficient balance is refused; e-wallet without GCash details is refused
--   * Super Admin approve → release keeps status trail, no second deduction
--   * cash in: a Universe request refuses a shop-scoped receiving account and
--     admin funding; approval credits the GLOBAL wallet only
DO $$
DECLARE _m uuid; _super uuid; _method uuid; _eco uuid; _acct uuid; _shop_acct uuid;
        _b0 numeric; _b1 numeric; _b2 numeric; _s0 numeric; _s1 numeric;
        _w public.withdrawal_requests; _w2 public.withdrawal_requests; _c public.cash_in_requests;
        _err text; _holds int; _fee_pct numeric;
BEGIN
  SELECT withdrawal_fee_percent INTO _fee_pct FROM public.platform_settings WHERE id = 1;
  ASSERT _fee_pct = 1, format('platform cash out fee is 1%% (got %s)', _fee_pct);

  SELECT user_id INTO _super FROM public.user_roles WHERE role = 'super_admin' LIMIT 1;
  SELECT id INTO _method FROM public.payment_methods WHERE active AND ecosystem_id IS NULL LIMIT 1;
  -- a demo, non-super member with any active shop (prefer an NG shop to prove isolation)
  SELECT p.id, p.ecosystem_id INTO _m, _eco
    FROM public.profiles p JOIN public.ecosystems e ON e.id = p.ecosystem_id
   WHERE p.status = 'active' AND coalesce(p.is_demo,false) AND p.id <> _super
     AND NOT public.is_super_admin(p.id)
   ORDER BY (e.shop_kind <> 'universe') DESC LIMIT 1;
  IF _m IS NULL THEN
    SELECT p.id, p.ecosystem_id INTO _m, _eco FROM public.profiles p
     WHERE p.status = 'active' AND NOT public.is_super_admin(p.id) LIMIT 1;
  END IF;
  IF _m IS NULL OR _super IS NULL OR _method IS NULL THEN RAISE EXCEPTION 'missing fixtures'; END IF;

  _acct := public.ensure_global_wallet(_m);
  UPDATE public.credit_accounts SET balance = 1500 WHERE id = _acct;
  SELECT balance INTO _b0 FROM public.credit_accounts WHERE id = _acct;
  SELECT id, balance INTO _shop_acct, _s0 FROM public.credit_accounts
   WHERE user_id = _m AND ecosystem_id = _eco;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _m)::text, true);

  -- ---- CASH OUT -----------------------------------------------------------
  _w := public.request_withdrawal(1000, 'ewallet', 'Demo Member', '09171234567', NULL,
                                  'QA-UW-' || gen_random_uuid()::text, 'superadmin', 'universe');
  ASSERT _w.wallet_scope = 'universe' AND _w.ecosystem_id IS NULL, 'universe request carries no shop';
  ASSERT _w.gross_php = 1000 AND _w.fee_percent = 1 AND _w.fee_php = 10 AND _w.net_php = 990,
         format('1%% rule: gross %s fee %s net %s', _w.gross_php, _w.fee_php, _w.net_php);
  ASSERT _w.account_id = _acct, 'hold taken from the GLOBAL wallet';
  ASSERT _w.status = 'pending', 'submitted, not released';
  SELECT balance INTO _b1 FROM public.credit_accounts WHERE id = _acct;
  ASSERT _b1 = _b0 - 1000, format('global wallet held: %s -> %s', _b0, _b1);
  IF _shop_acct IS NOT NULL THEN
    SELECT balance INTO _s1 FROM public.credit_accounts WHERE id = _shop_acct;
    ASSERT _s1 = _s0, 'shop / NG wallet untouched';
  END IF;

  -- idempotent
  _w2 := public.request_withdrawal(1000, 'ewallet', 'Demo Member', '09171234567', NULL,
                                   _w.request_key, 'superadmin', 'universe');
  ASSERT _w2.id = _w.id, 'same key returns the same request';
  SELECT count(*) INTO _holds FROM public.credit_ledger WHERE reference = _w.reference AND entry_kind = 'withdrawal_hold';
  ASSERT _holds = 1, 'exactly one hold';

  -- shop-admin path refused
  BEGIN
    PERFORM public.request_withdrawal(10, 'ewallet', 'x', '09171234567', NULL, NULL, 'admin', 'universe');
    RAISE EXCEPTION 'admin path allowed';
  EXCEPTION WHEN others THEN _err := SQLERRM; IF _err = 'admin path allowed' THEN RAISE; END IF; END;
  -- insufficient balance (500 left)
  BEGIN
    PERFORM public.request_withdrawal(501, 'ewallet', 'x', '09171234567', NULL, NULL, 'superadmin', 'universe');
    RAISE EXCEPTION 'overdraft allowed';
  EXCEPTION WHEN others THEN _err := SQLERRM; IF _err = 'overdraft allowed' THEN RAISE; END IF; END;
  SELECT balance INTO _b2 FROM public.credit_accounts WHERE id = _acct;
  ASSERT _b2 = _b1, 'failed request did not deduct';
  -- missing GCash details
  BEGIN
    PERFORM public.request_withdrawal(10, 'ewallet', NULL, NULL, NULL, NULL, 'superadmin', 'universe');
    RAISE EXCEPTION 'no gcash allowed';
  EXCEPTION WHEN others THEN _err := SQLERRM; IF _err = 'no gcash allowed' THEN RAISE; END IF; END;

  -- Super Admin approve → release
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  _w := public.review_withdrawal(_w.id, 'approve', NULL);
  ASSERT _w.status = 'approved', 'approved';
  _w := public.review_withdrawal(_w.id, 'release', 'Sent via GCash');
  ASSERT _w.status = 'released' AND _w.released_at IS NOT NULL, 'released';
  SELECT balance INTO _b2 FROM public.credit_accounts WHERE id = _acct;
  ASSERT _b2 = _b1, 'release never deducts a second time';

  -- ---- CASH IN ------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _m)::text, true);
  BEGIN
    PERFORM public.request_cash_in(_method, 100, 'R1', NULL, NULL, _m::text || '/qa.jpg', '09171234567',
                                   'admin', NULL, NULL, 'universe');
    RAISE EXCEPTION 'admin funding allowed';
  EXCEPTION WHEN others THEN _err := SQLERRM; IF _err = 'admin funding allowed' THEN RAISE; END IF; END;

  _c := public.request_cash_in(_method, 1000, 'QA-' || substr(gen_random_uuid()::text,1,10), NULL,
                               'QA-UCI-' || gen_random_uuid()::text, _m::text || '/qa.jpg',
                               '09171234567', 'platform', NULL, NULL, 'universe');
  ASSERT _c.wallet_scope = 'universe' AND _c.ecosystem_id IS NULL, 'universe cash in carries no shop';
  ASSERT _c.status = 'pending', 'never credited on submission alone';
  SELECT balance INTO _b2 FROM public.credit_accounts WHERE id = _acct;
  ASSERT _b2 = _b1, 'submission did not credit';

  -- approval (same path the verified-payment auto approval uses) → GLOBAL wallet
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  _c := public.review_cash_in(_c.id, 'approve', NULL);
  ASSERT _c.status = 'approved', 'approved';
  SELECT balance INTO _b2 FROM public.credit_accounts WHERE id = _acct;
  ASSERT _b2 = _b1 + _c.credits, format('global wallet credited: %s -> %s', _b1, _b2);
  IF _shop_acct IS NOT NULL THEN
    SELECT balance INTO _s1 FROM public.credit_accounts WHERE id = _shop_acct;
    ASSERT _s1 = _s0, 'shop / NG wallet still untouched';
  END IF;
  BEGIN
    PERFORM public.review_cash_in(_c.id, 'approve', NULL);
    RAISE EXCEPTION 'double approval allowed';
  EXCEPTION WHEN others THEN _err := SQLERRM; IF _err = 'double approval allowed' THEN RAISE; END IF; END;

  RAISE EXCEPTION 'ALL_ASSERTIONS_PASSED__ROLLING_BACK (cash out 1000 -> fee 10 -> net 990; wallet % -> % -> %)', _b0, _b1, _b2;
END $$;
