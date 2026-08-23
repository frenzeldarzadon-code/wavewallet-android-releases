-- Super Admin review of payments the listener approved on its own.
--
-- Run with:
--   BEGIN; \i supabase/tests/auto-approved-payment-review.sql ROLLBACK;
--
-- Expectations:
--   1. Automatic activation opens a review record in "Pending Super Admin Review".
--   2. Only a platform owner may review; an ordinary operator is rejected.
--   3. Marking Invalid requires a reason, holds the shop's paid entitlements,
--      freezes operations, notifies the operator persistently and is audited.
--   4. Marking Verified releases the hold, unfreezes the shop, notifies the
--      operator and is audited. The shop and its history are never deleted.
--   5. The owner listing shows the real plan, months and total — never 0/month.

BEGIN;

DO $$
DECLARE
  _owner uuid; _op uuid; _plan public.subscription_plans;
  _eco public.ecosystems; _req public.subscription_requests; _res text;
  _row record; _blocked boolean := false;
BEGIN
  SELECT user_id INTO _owner FROM public.user_roles WHERE role = 'super_admin' ORDER BY created_at LIMIT 1;
  SELECT p.id INTO _op FROM public.profiles p
   WHERE p.deleted_at IS NULL AND NOT public.is_super_admin(p.id)
   ORDER BY p.created_at LIMIT 1;
  ASSERT _owner IS NOT NULL AND _op IS NOT NULL, 'need a platform owner and one ordinary member';
  SELECT * INTO _plan FROM public.subscription_plans WHERE active AND monthly_price > 0
   ORDER BY display_order LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _op)::text, true);
  SELECT * INTO _eco FROM public.create_review_shop('Demo: QA AutoReview', 'auto review test');

  INSERT INTO public.subscription_requests
    (ecosystem_id, requested_by, requested_by_name, purpose, plan_id, plan_name, plan_price,
     billing_period, amount_due, amount_paid, months_purchased, monthly_rate, payment_reference,
     status, auto_state)
  VALUES (_eco.id, _op, 'QA operator', 'go_live', _plan.id, _plan.name, _plan.monthly_price,
          'monthly', _plan.monthly_price * 3, _plan.monthly_price * 3, 3, _plan.monthly_price,
          'QA-REVIEW-REF', 'pending', 'verified')
  RETURNING * INTO _req;

  -- 1. Automatic activation opens the review.
  _res := public.activate_go_live_request(_req.id);
  ASSERT _res = 'activated', 'verified payment still activates automatically';
  SELECT * INTO _req FROM public.subscription_requests WHERE id = _req.id;
  ASSERT _req.super_review_state = 'pending', 'auto-approved payment enters Pending Super Admin Review';
  ASSERT NOT _req.entitlement_hold, 'no hold before a decision';

  -- 2. Non-owners cannot review.
  BEGIN
    PERFORM public.review_auto_approved_payment(_req.id, 'verified', NULL);
  EXCEPTION WHEN others THEN _blocked := true;
  END;
  ASSERT _blocked, 'an ordinary operator cannot review automatic payments';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);

  -- 3a. Invalid needs a reason.
  _blocked := false;
  BEGIN
    PERFORM public.review_auto_approved_payment(_req.id, 'invalid', '   ');
  EXCEPTION WHEN others THEN _blocked := true;
  END;
  ASSERT _blocked, 'marking invalid requires a reason';

  -- 3b. Invalid holds the entitlements and notifies the operator.
  _res := public.review_auto_approved_payment(_req.id, 'invalid', 'No matching payment received');
  ASSERT _res = 'invalid', 'invalid decision recorded';
  SELECT * INTO _req FROM public.subscription_requests WHERE id = _req.id;
  ASSERT _req.entitlement_hold, 'paid entitlements go on hold';
  ASSERT _req.super_reviewed_by = _owner AND _req.super_reviewed_at IS NOT NULL, 'reviewer recorded';
  ASSERT _req.super_review_reason = 'No matching payment received', 'reason recorded';
  SELECT * INTO _eco FROM public.ecosystems WHERE id = _eco.id;
  ASSERT _eco.operations_frozen, 'the shop can no longer move money while invalid';
  ASSERT _eco.id IS NOT NULL, 'the shop and its history are kept';
  ASSERT EXISTS (SELECT 1 FROM public.member_notifications n
                  WHERE n.user_id = _op AND n.ecosystem_id = _eco.id
                    AND n.title ILIKE '%invalid%'),
         'operator keeps a readable notification about the invalid payment';
  ASSERT EXISTS (SELECT 1 FROM public.audit_logs a
                  WHERE a.ecosystem_id = _eco.id AND a.action = 'Marked automatic payment invalid'),
         'invalid decision is audited';

  -- 4. Verified releases the hold.
  _res := public.review_auto_approved_payment(_req.id, 'verified', NULL);
  ASSERT _res = 'verified', 'verified decision recorded';
  SELECT * INTO _req FROM public.subscription_requests WHERE id = _req.id;
  ASSERT NOT _req.entitlement_hold, 'hold released on verification';
  SELECT * INTO _eco FROM public.ecosystems WHERE id = _eco.id;
  ASSERT NOT _eco.operations_frozen AND _eco.frozen_reason IS NULL, 'shop is fully active again';
  ASSERT _eco.subscription_state = 'active', 'the live subscription is untouched';
  ASSERT EXISTS (SELECT 1 FROM public.member_notifications n
                  WHERE n.user_id = _op AND n.title ILIKE '%verified%'),
         'operator is told the payment is verified';
  ASSERT EXISTS (SELECT 1 FROM public.audit_logs a
                  WHERE a.ecosystem_id = _eco.id AND a.action = 'Verified automatic payment'),
         'verification is audited';

  -- 5. The owner listing shows the real plan and total.
  SELECT * INTO _row FROM public.auto_approved_payments(NULL) WHERE id = _req.id;
  ASSERT _row.plan_name = _plan.name, 'the listing names the selected plan';
  ASSERT _row.monthly_rate = _plan.monthly_price AND _row.months_purchased = 3,
         'rate and months never default to zero';
  ASSERT _row.review_state = 'verified', 'listing reflects the current review state';

  RAISE NOTICE 'auto-approved payment review OK';
END $$;

ROLLBACK;
