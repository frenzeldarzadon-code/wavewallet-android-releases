-- Cash In: SUPER ADMIN APPROVES; THE REQUESTING MEMBER RECEIVES.
--
-- Run inside a transaction; the final RAISE rolls everything back:
--   BEGIN; \i supabase/tests/cash-in-recipient.sql
--
-- Proves, with two DISTINCT user ids in the real database flow:
--   * a customer's cash in request stores that customer as user_id
--   * approval by the platform owner credits the CUSTOMER's standard credit
--     balance by exactly the requested credits
--   * the approving platform owner's balance is completely unchanged
--   * the credit lot carries the MEMBER's ecosystem, never the approver's
--   * the platform issuance records operator = super admin, recipient = member
--   * a second approval of the same request is refused (no double credit)
--   * the platform owner cannot submit a cash in request for themselves
--
-- Verified live on 2026-08-14: customer 10.00 -> 1010.00, super admin
-- 1000.00 -> 1000.00 (unchanged), then rolled back.

DO $$
DECLARE _cust uuid;
        _super uuid;
        _m uuid; _req public.cash_in_requests; _cb numeric; _ca numeric; _sb numeric; _sa numeric;
        _lot public.credit_lots; _iss public.platform_credit_issuances; _err text;
BEGIN
  SELECT p.id INTO _cust FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id
   WHERE p.status = 'active' AND r.role = 'customer' AND p.ecosystem_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO _super FROM public.user_roles WHERE role = 'super_admin' LIMIT 1;
  SELECT id INTO _m FROM public.payment_methods WHERE active LIMIT 1;
  IF _m IS NULL OR _cust IS NULL OR _super IS NULL THEN RAISE EXCEPTION 'missing fixtures'; END IF;

  -- the member submits
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  _req := public.request_cash_in(_m, 1000, 'QA', 'QA test', 'QA-' || gen_random_uuid()::text);
  ASSERT _req.user_id = _cust, 'request belongs to the submitting member';
  ASSERT _req.status = 'pending', 'a new request is pending';

  SELECT coalesce(balance, 0) INTO _cb FROM public.credit_accounts WHERE user_id = _cust;
  SELECT coalesce(balance, 0) INTO _sb FROM public.credit_accounts WHERE user_id = _super;

  -- the platform owner approves
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  _req := public.review_cash_in(_req.id, 'approve', null);

  SELECT balance INTO _ca FROM public.credit_accounts WHERE user_id = _cust;
  SELECT balance INTO _sa FROM public.credit_accounts WHERE user_id = _super;
  ASSERT _ca = coalesce(_cb, 0) + _req.credits, format('member credited: %s -> %s', _cb, _ca);
  ASSERT _sa = _sb, format('approver untouched: %s -> %s', _sb, _sa);

  SELECT * INTO _lot FROM public.credit_lots WHERE ledger_id = _req.ledger_id;
  ASSERT _lot.user_id = _cust, 'lot belongs to the member';
  ASSERT _lot.ecosystem_id = (SELECT ecosystem_id FROM public.profiles WHERE id = _cust),
         'lot carries the member ecosystem';

  SELECT * INTO _iss FROM public.platform_credit_issuances
   WHERE request_key = 'cash_in:' || _req.id::text;
  ASSERT _iss.recipient_id = _cust AND _iss.operator_id = _super, 'dual identity audit';

  -- no double credit
  BEGIN
    PERFORM public.review_cash_in(_req.id, 'approve', null);
    RAISE EXCEPTION 'duplicate approval was allowed';
  EXCEPTION WHEN others THEN
    _err := SQLERRM;
    IF _err = 'duplicate approval was allowed' THEN RAISE; END IF;
  END;

  -- the platform owner holds no member balance and may not cash in
  BEGIN
    PERFORM public.request_cash_in(_m, 1000, null, null, 'QA-SUPER-' || gen_random_uuid()::text);
    RAISE EXCEPTION 'super admin cash in was allowed';
  EXCEPTION WHEN others THEN
    _err := SQLERRM;
    IF _err = 'super admin cash in was allowed' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'ALL_ASSERTIONS_PASSED__ROLLING_BACK (member % -> %, super % -> %)', _cb, _ca, _sb, _sa;
END $$;
