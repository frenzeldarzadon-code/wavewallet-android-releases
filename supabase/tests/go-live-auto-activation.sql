-- Verified payment -> automatic activation, with review-only notifications.
--
-- Run with:
--   BEGIN; \i supabase/tests/go-live-auto-activation.sql ROLLBACK;
--
-- Expectations:
--   1. activate_go_live_request activates the shop on the EXACT plan persisted
--      with the request — no platform-owner approval step is involved.
--   2. The request keeps its selected plan, plan price and monthly rate, so the
--      owner's screens can always show the real plan and its configured price.
--   3. The operator receives a congratulations notification.
--   4. Every platform owner receives an informational "New shop went live"
--      notice that names the plan — and nothing about it gates activation.
--   5. A zero-priced plan activates without payment through the free path and
--      also notifies the platform owners.

BEGIN;

DO $$
DECLARE
  _owner uuid; _op uuid; _plan public.subscription_plans; _free uuid;
  _eco public.ecosystems; _req public.subscription_requests; _res text;
  _owners int; _notices int;
BEGIN
  SELECT user_id INTO _owner FROM public.user_roles WHERE role = 'super_admin' ORDER BY created_at LIMIT 1;
  SELECT p.id INTO _op FROM public.profiles p
   WHERE p.deleted_at IS NULL AND NOT public.is_super_admin(p.id)
   ORDER BY p.created_at LIMIT 1;
  ASSERT _owner IS NOT NULL AND _op IS NOT NULL, 'need a platform owner and one ordinary member';
  SELECT * INTO _plan FROM public.subscription_plans WHERE active AND monthly_price > 0
   ORDER BY display_order LIMIT 1;
  ASSERT _plan.id IS NOT NULL, 'need one paid plan';
  SELECT count(*) INTO _owners FROM public.user_roles WHERE role = 'super_admin';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _op)::text, true);
  SELECT * INTO _eco FROM public.create_review_shop('Demo: QA AutoLive', 'auto activation test');

  INSERT INTO public.subscription_requests
    (ecosystem_id, requested_by, requested_by_name, purpose, plan_id, plan_name, plan_price,
     billing_period, amount_due, amount_paid, months_purchased, monthly_rate, payment_reference,
     status, auto_state)
  VALUES (_eco.id, _op, 'QA operator', 'go_live', _plan.id, _plan.name, _plan.monthly_price,
          'monthly', _plan.monthly_price * 2, _plan.monthly_price * 2, 2, _plan.monthly_price,
          'QA-AUTO-REF', 'pending', 'verified')
  RETURNING * INTO _req;

  -- 1. Automatic activation — no review_subscription_request call anywhere.
  _res := public.activate_go_live_request(_req.id);
  ASSERT _res = 'activated', format('verified payment activates automatically, got %s', _res);

  SELECT * INTO _eco FROM public.ecosystems WHERE id = _eco.id;
  ASSERT NOT _eco.is_review, 'Demo state cleared the moment verification activates the shop';
  ASSERT _eco.subscription_state = 'active', 'shop is active';
  ASSERT _eco.plan_name = _plan.name, 'shop runs the exact plan the operator selected';
  ASSERT _eco.plan_price = _plan.monthly_price, 'the configured plan price is persisted';

  -- 2. The request keeps the selected plan and price.
  SELECT * INTO _req FROM public.subscription_requests WHERE id = _req.id;
  ASSERT _req.status = 'approved' AND _req.plan_id = _plan.id, 'selected plan persisted on the request';
  ASSERT _req.monthly_rate = _plan.monthly_price AND _req.plan_price = _plan.monthly_price,
         'plan price never falls back to zero';
  ASSERT _req.reviewed_by_name = 'WaveWallet GCash listener', 'no manual approver recorded';

  -- 3. Operator congratulations.
  ASSERT EXISTS (SELECT 1 FROM public.member_notifications n
                  WHERE n.user_id = _op AND n.ecosystem_id = _eco.id
                    AND n.title ILIKE 'Congratulations%LIVE%'),
         'operator is congratulated';

  -- 4. Review-only notice for every platform owner.
  SELECT count(*) INTO _notices FROM public.member_notifications n
    JOIN public.user_roles ur ON ur.user_id = n.user_id AND ur.role = 'super_admin'
   WHERE n.ecosystem_id = _eco.id AND n.title = 'New shop went live';
  ASSERT _notices = _owners, format('every platform owner is notified, got %s of %s', _notices, _owners);
  ASSERT EXISTS (SELECT 1 FROM public.member_notifications n
                  WHERE n.ecosystem_id = _eco.id AND n.title = 'New shop went live'
                    AND n.body LIKE '%' || _plan.name || '%'
                    AND n.body ILIKE '%no approval needed%'),
         'the owner notice names the plan and is review-only';

  -- 5. Zero-priced plan: no payment, activation through the free path.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _op)::text, true);
  SELECT * INTO _eco FROM public.create_review_shop('Demo: QA FreeLive', 'zero price test');
  INSERT INTO public.subscription_plans (code, name, monthly_price, coin_allocation, active, display_order)
  VALUES ('qa_free_plan', 'QA Free Plan', 0, 0, true, 999) RETURNING id INTO _free;
  UPDATE public.ecosystems SET plan_price = 0 WHERE id = _eco.id;
  PERFORM public.activate_free_subscription(_eco.id, _free, 1);
  SELECT * INTO _eco FROM public.ecosystems WHERE id = _eco.id;
  ASSERT NOT _eco.is_review AND _eco.subscription_state = 'active', 'free plan activates with no payment';
  ASSERT public.subscription_is_free(_eco.id), 'zero-priced shop stays free of expiry pressure';
  ASSERT EXISTS (SELECT 1 FROM public.member_notifications n
                  WHERE n.ecosystem_id = _eco.id AND n.title = 'New shop went live'),
         'platform owners also see free activations';

  RAISE NOTICE 'go-live automatic activation OK';
END $$;

ROLLBACK;
