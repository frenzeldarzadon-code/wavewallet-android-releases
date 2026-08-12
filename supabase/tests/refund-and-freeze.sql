-- Refund workflow + emergency freeze.
--
-- Replace the ids below with real rows from the target database, then run:
--   BEGIN; \i supabase/tests/refund-and-freeze.sql ROLLBACK;
--
-- Expectations:
--   Refund: buyer is repaid, earned points reversed, credit-back clawed back,
--           released codes voided, sale flagged (never edited), second refund refused,
--           wallet balance still equals the sum of remaining credit lots.
--   Freeze: only the platform owner can freeze; a frozen shop refuses every
--           money-moving RPC; unfreezing restores normal operation.

BEGIN;

DO $$
DECLARE
  _admin uuid := '6b045d74-c678-4f49-822a-ce81efb89cba';
  _sale  uuid := '3c92f01d-3a3f-4041-80ef-4f2c241112a8';
  _buyer uuid := '04c82e4d-2079-458d-805a-43b9b8b7a484';
  _cred_before numeric; _cred_after numeric;
  _pts_before integer; _pts_after integer;
  _r record;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  SELECT balance INTO _cred_before FROM public.credit_accounts WHERE user_id = _buyer;
  SELECT balance INTO _pts_before FROM public.points_accounts WHERE user_id = _buyer;

  SELECT * INTO _r FROM public.refund_voucher_sale(_sale, 'QA refund test');

  SELECT balance INTO _cred_after FROM public.credit_accounts WHERE user_id = _buyer;
  SELECT balance INTO _pts_after FROM public.points_accounts WHERE user_id = _buyer;
  ASSERT _cred_after = _cred_before + _r.credits_refunded, 'credits returned to buyer wallet';
  ASSERT _pts_after = _pts_before - _r.points_reversed + _r.points_refunded, 'points reconciled';
  ASSERT (SELECT count(*) FROM public.voucher_codes WHERE sale_id = _sale AND status = 'sold') = 0,
         'released codes must be voided';
  ASSERT (SELECT refunded_at FROM public.voucher_sales WHERE id = _sale) IS NOT NULL, 'sale flagged refunded';
  ASSERT (SELECT count(*) FROM public.sale_commissions WHERE sale_id = _sale AND reversed_at IS NULL) = 0,
         'credit-back reversed';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _buyer) =
         coalesce((SELECT sum(remaining) FROM public.credit_lots WHERE user_id = _buyer), 0),
         'wallet must still equal remaining credit lots';

  BEGIN
    PERFORM public.refund_voucher_sale(_sale, 'second attempt');
    RAISE EXCEPTION 'double refund should have failed';
  EXCEPTION WHEN others THEN
    IF position('already refunded' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  RAISE NOTICE 'refund tests passed';
END $$;

DO $$
DECLARE
  _super uuid := '4f8c8e50-16f6-441d-9619-121c72ba3387';
  _res   uuid := '1ef6ecac-af2d-45bb-8bd8-64bff332b812';
  _cus   uuid := '04c82e4d-2079-458d-805a-43b9b8b7a484';
  _eco   uuid := '8b4fc15e-f6b3-444b-89f6-51a145fe874f';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  BEGIN
    PERFORM public.set_ecosystem_freeze(_eco, true, 'nope');
    RAISE EXCEPTION 'reseller must not be able to freeze a shop';
  EXCEPTION WHEN others THEN
    IF position('platform owner' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  PERFORM public.set_ecosystem_freeze(_eco, true, 'QA freeze test');
  ASSERT (SELECT operations_frozen FROM public.ecosystems WHERE id = _eco), 'shop should be frozen';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  BEGIN
    PERFORM public.transfer_credits(_cus, 10, 'should be blocked');
    RAISE EXCEPTION 'frozen shop must block transfers';
  EXCEPTION WHEN others THEN
    IF position('frozen' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  PERFORM public.set_ecosystem_freeze(_eco, false, null);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  PERFORM public.transfer_credits(_cus, 10, 'allowed after unfreeze');

  RAISE NOTICE 'freeze tests passed';
END $$;

ROLLBACK;
