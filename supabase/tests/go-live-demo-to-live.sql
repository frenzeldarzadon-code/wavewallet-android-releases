-- New Generation Shop: Demo -> Live state transition.
--
-- Run with:
--   BEGIN; \i supabase/tests/go-live-demo-to-live.sql ROLLBACK;
--
-- Expectations:
--   1. A freshly created review shop is persisted as Demo (is_review, timer, demo wallets).
--   2. Manual platform-owner approval of a Go Live request performs the SAME
--      authoritative activation as the automatic listener path.
--   3. After activation the persisted state is Live: is_review false, no review
--      timer, sign-ups open, demo wallets/ledger/vouchers deleted.
--   4. A persisted "Demo:" name prefix is normalised away on the live transition.
--   5. The plan's real Coin allocation is granted exactly once (re-applying the
--      same plan adds nothing), and no contradictory Demo state remains for any
--      later session, device or reload — the assertions read the persisted row.
--   6. Legacy shops are untouched by this path.

BEGIN;

DO $$
DECLARE
  _owner uuid; _op uuid; _plan public.subscription_plans;
  _eco public.ecosystems; _req public.subscription_requests;
  _alloc numeric; _alloc2 numeric; _legacy_before jsonb; _legacy_after jsonb;
BEGIN
  SELECT user_id INTO _owner FROM public.user_roles WHERE role = 'super_admin' ORDER BY created_at LIMIT 1;
  SELECT p.id INTO _op FROM public.profiles p
   WHERE p.deleted_at IS NULL AND NOT public.is_super_admin(p.id)
     AND NOT EXISTS (SELECT 1 FROM public.ecosystems e
                      JOIN public.ecosystem_memberships m ON m.ecosystem_id = e.id
                     WHERE e.is_review AND e.archived_at IS NULL AND m.user_id = p.id AND m.role = 'admin')
   ORDER BY p.created_at LIMIT 1;
  ASSERT _owner IS NOT NULL AND _op IS NOT NULL, 'need a platform owner and one ordinary member';
  SELECT * INTO _plan FROM public.subscription_plans WHERE active ORDER BY display_order LIMIT 1;

  SELECT jsonb_build_object('kind', shop_kind, 'review', is_review, 'name', name)
    INTO _legacy_before FROM public.ecosystems WHERE shop_kind <> 'subscription' ORDER BY created_at LIMIT 1;

  -- 1. Demo before payment.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _op)::text, true);
  SELECT * INTO _eco FROM public.create_review_shop('Demo: QA Wave', 'state transition test');
  ASSERT _eco.is_review, 'new review shop is persisted as Demo';
  ASSERT _eco.review_ends_at IS NOT NULL, 'Demo timer exists before activation';
  ASSERT (SELECT count(*) FROM public.demo_wallets WHERE ecosystem_id = _eco.id) > 0, 'demo wallets seeded';
  ASSERT (SELECT jsonb_typeof(public.my_review_shop())) = 'object', 'Demo banner data is served while Demo';

  INSERT INTO public.subscription_requests
    (ecosystem_id, requested_by, requested_by_name, purpose, plan_id, plan_name, plan_price,
     billing_period, amount_due, amount_paid, months_purchased, monthly_rate, payment_reference, status)
  VALUES (_eco.id, _op, 'QA operator', 'go_live', _plan.id, _plan.name, _plan.monthly_price,
          'monthly', _plan.monthly_price, _plan.monthly_price, 1, _plan.monthly_price, 'QA-TEST-REF', 'pending')
  RETURNING * INTO _req;

  -- 2. Manual platform-owner approval.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  SELECT * INTO _req FROM public.review_subscription_request(_req.id, 'approved', 'QA manual approval');
  ASSERT _req.status = 'approved', 'request approved';
  ASSERT _req.auto_state = 'activated', 'approved request reports activation, never a pending state';

  SELECT * INTO _eco FROM public.ecosystems WHERE id = _eco.id;

  -- 3. Persisted Live state — what any reload, re-login or other device reads.
  ASSERT NOT _eco.is_review, 'shop is persisted Live after activation';
  ASSERT _eco.review_ends_at IS NULL, 'Demo timer cleared';
  ASSERT _eco.signup_enabled, 'sign-ups open once live';
  ASSERT _eco.subscription_state = 'active', 'subscription state active';
  ASSERT (SELECT count(*) FROM public.demo_wallets WHERE ecosystem_id = _eco.id) = 0, 'demo wallets removed';
  ASSERT (SELECT count(*) FROM public.demo_ledger WHERE ecosystem_id = _eco.id) = 0, 'demo ledger removed';
  ASSERT (SELECT count(*) FROM public.demo_vouchers WHERE ecosystem_id = _eco.id) = 0, 'demo vouchers removed';

  -- Demo banner source of truth agrees for the operator's own session.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _op)::text, true);
  ASSERT (SELECT jsonb_typeof(public.my_review_shop())) = 'null', 'no Demo banner after activation';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);

  -- 4. Demo name prefix normalised.
  ASSERT _eco.name = 'QA Wave', format('Demo prefix removed on live transition, got %s', _eco.name);
  ASSERT public.live_shop_name('Demo - Foo') = 'Foo' AND public.live_shop_name('Foo') = 'Foo',
         'name normaliser only strips a leading Demo prefix';

  -- 5. Allocation applied exactly once.
  SELECT allocation_total INTO _alloc FROM public.shop_subscriptions WHERE ecosystem_id = _eco.id;
  ASSERT _alloc = _plan.coin_allocation, 'plan allocation applied';
  PERFORM public.apply_subscription_plan(_eco.id, _plan.id, 1, _plan.monthly_price, 'QA-TEST-REF-2', 'QA re-apply');
  SELECT allocation_total INTO _alloc2 FROM public.shop_subscriptions WHERE ecosystem_id = _eco.id;
  ASSERT _alloc2 = _alloc, 'renewing the same plan never duplicates the allocation';

  -- 6. Legacy shops untouched.
  SELECT jsonb_build_object('kind', shop_kind, 'review', is_review, 'name', name)
    INTO _legacy_after FROM public.ecosystems WHERE shop_kind <> 'subscription' ORDER BY created_at LIMIT 1;
  ASSERT _legacy_before IS NOT DISTINCT FROM _legacy_after, 'legacy shop behaviour unchanged';

  RAISE NOTICE 'go-live demo->live transition OK';
END $$;

ROLLBACK;
