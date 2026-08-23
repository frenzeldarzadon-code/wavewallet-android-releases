-- Go Live reconciliation: bank-to-wallet payments and misread receipt dates.
--
-- Run with:
--   BEGIN; \i supabase/tests/go-live-bank-transfer-match.sql ROLLBACK;
--
-- Expectations:
--   1. go_live_match_anchor trusts a plausible receipt timestamp and falls back
--      to the submission time when the receipt date is years away (OCR year).
--   2. A GCash notification for a MariBank -> GCash InstaPay payment, which
--      never carries the payer's bank account number, still activates the shop
--      on reference + amount (two independent signals, reference is strong).
--   3. Amount alone still never approves anything.
--   4. A notification already consumed by another request is never reused.

BEGIN;

DO $$
DECLARE
  _op uuid; _plan public.subscription_plans; _dev uuid;
  _eco public.ecosystems; _req public.subscription_requests; _req2 public.subscription_requests;
  _res text; _anchor timestamptz; _ev uuid;
BEGIN
  SELECT p.id INTO _op FROM public.profiles p
   WHERE p.deleted_at IS NULL AND NOT public.is_super_admin(p.id)
   ORDER BY p.created_at LIMIT 1;
  SELECT * INTO _plan FROM public.subscription_plans WHERE active AND monthly_price > 0
   ORDER BY display_order LIMIT 1;
  ASSERT _op IS NOT NULL AND _plan.id IS NOT NULL, 'need a member and one paid plan';

  SELECT id INTO _dev FROM public.listener_devices
   WHERE owner_role = 'platform' AND status = 'active' ORDER BY created_at LIMIT 1;
  ASSERT _dev IS NOT NULL, 'need an active platform listener device';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _op)::text, true);
  SELECT * INTO _eco FROM public.create_review_shop('Demo: QA BankPay', 'bank transfer match test');

  INSERT INTO public.subscription_requests
    (ecosystem_id, requested_by, requested_by_name, purpose, plan_id, plan_name, plan_price,
     billing_period, amount_due, amount_paid, months_purchased, monthly_rate,
     payment_reference, payer_number, payer_number_key, payer_reference_key,
     receipt_reference_key, receipt_sender_key, receipt_amount_php, receipt_paid_at,
     receipt_check, status)
  VALUES (_eco.id, _op, 'QA operator', 'go_live', _plan.id, _plan.name, _plan.monthly_price,
          'monthly', _plan.monthly_price, _plan.monthly_price, 1, _plan.monthly_price,
          'QA-BANK-777777', '15976553427', '15976553427', 'QA-BANK-777777',
          'QA-BANK-777777', '15976553427', _plan.monthly_price,
          -- OCR misread the year: two years before the request was submitted.
          now() - interval '2 years', 'matched', 'pending')
  RETURNING * INTO _req;

  -- 1. Implausible receipt date falls back to the submission time.
  _anchor := public.go_live_match_anchor(_req);
  ASSERT _anchor = _req.created_at,
         'a receipt date years from submission is not trusted as the match anchor';
  UPDATE public.subscription_requests SET receipt_paid_at = created_at - interval '2 hours'
   WHERE id = _req.id RETURNING * INTO _req2;
  ASSERT public.go_live_match_anchor(_req2) = _req2.receipt_paid_at,
         'a plausible receipt date is still used as the match anchor';
  -- Restore the misread date: the rest of the test proves matching survives it.
  UPDATE public.subscription_requests SET receipt_paid_at = now() - interval '2 years'
   WHERE id = _req.id RETURNING * INTO _req;

  -- 3. Amount alone never approves: no reference, no sender.
  INSERT INTO public.listener_events
    (device_id, event_uid, package_name, raw_text, amount_php, outcome, posted_at)
  VALUES (_dev, 'qa-amount-only', 'com.globe.gcash.android', 'You received PHP',
          _plan.monthly_price, 'accepted', now())
  RETURNING id INTO _ev;
  SELECT * INTO _req FROM public.subscription_requests WHERE id = _req.id;
  ASSERT _req.status = 'pending' AND _req.auto_state = 'pending',
         'an amount-only notification never approves a payment';

  -- 2. Bank -> GCash InstaPay: the notification carries the reference and the
  --    amount, but NOT the payer's bank account number.
  INSERT INTO public.listener_events
    (device_id, event_uid, package_name, raw_text, amount_php, gcash_reference, reference_key,
     outcome, posted_at)
  VALUES (_dev, 'qa-bank-instapay', 'com.globe.gcash.android',
          'You have received PHP via InstaPay. Ref. No. QA-BANK-777777',
          _plan.monthly_price, 'QA-BANK-777777', 'QA-BANK-777777', 'accepted', now())
  RETURNING id INTO _ev;

  SELECT * INTO _req FROM public.subscription_requests WHERE id = _req.id;
  ASSERT _req.status = 'approved',
         format('reference + amount from a bank transfer activates the shop, got %s/%s',
                _req.status, _req.auto_state);
  ASSERT _req.listener_event_id = _ev, 'the matching notification is recorded on the request';

  SELECT * INTO _eco FROM public.ecosystems WHERE id = _eco.id;
  ASSERT NOT _eco.is_review AND _eco.subscription_state = 'active', 'the shop went live';

  -- 4. The consumed notification cannot approve a second request.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _op)::text, true);
  SELECT * INTO _eco FROM public.create_review_shop('Demo: QA BankPay 2', 'reuse guard');
  INSERT INTO public.subscription_requests
    (ecosystem_id, requested_by, requested_by_name, purpose, plan_id, plan_name, plan_price,
     billing_period, amount_due, amount_paid, months_purchased, monthly_rate,
     payment_reference, payer_number, payer_number_key, payer_reference_key,
     receipt_reference_key, receipt_amount_php, receipt_check, status)
  VALUES (_eco.id, _op, 'QA operator', 'go_live', _plan.id, _plan.name, _plan.monthly_price,
          'monthly', _plan.monthly_price, _plan.monthly_price, 1, _plan.monthly_price,
          'QA-BANK-777777', '15976553427', '15976553427', 'QA-BANK-777777',
          'QA-BANK-777777', _plan.monthly_price, 'matched', 'pending')
  RETURNING * INTO _req2;
  _res := public.reconcile_go_live_request(_req2.id);
  ASSERT _res = 'no_match', format('a consumed notification is never reused, got %s', _res);
  SELECT * INTO _eco FROM public.ecosystems WHERE id = _eco.id;
  ASSERT _eco.is_review, 'the second shop stays Demo';

  RAISE NOTICE 'go-live bank transfer matching OK';
END $$;

ROLLBACK;
