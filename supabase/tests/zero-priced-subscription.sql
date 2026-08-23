-- Zero-priced (free) subscriptions.
--
-- Run with:
--   BEGIN; \i supabase/tests/zero-priced-subscription.sql ROLLBACK;
--
-- Expectations:
--   1. A live shop whose monthly price the platform owner set to 0 is FREE:
--      `subscription_is_free` is true.
--   2. A free shop stays operational (`subscription_ok`) even long after its
--      period end and grace period have passed.
--   3. The nightly `run_subscription_expiry` job never expires or freezes it.
--   4. No payment can be requested for it — `submit_go_live_payment` refuses.
--   5. `activate_free_subscription` activates/renews it with no reference, no
--      screenshot and no approval, and records amount 0.
--   6. A priced shop (> 0) still expires, still freezes and still pays.

BEGIN;

DO $$
DECLARE
  _free uuid; _paid uuid; _plan public.subscription_plans; _sub public.shop_subscriptions;
BEGIN
  select * into _plan from public.subscription_plans where active order by monthly_price desc limit 1;
  if _plan.id is null then raise exception 'No active subscription plan to test with'; end if;

  insert into public.ecosystems (name, slug, shop_kind, is_review, plan_name, plan_price,
                                 grace_period_days, subscription_state, current_period_end)
  values ('ZeroTest Free', 'zerotest-free-' || substr(gen_random_uuid()::text,1,8), 'subscription', false,
          _plan.name, 0, 5, 'active', now() - interval '90 days')
  returning id into _free;

  insert into public.ecosystems (name, slug, shop_kind, is_review, plan_name, plan_price,
                                 grace_period_days, subscription_state, current_period_end)
  values ('ZeroTest Paid', 'zerotest-paid-' || substr(gen_random_uuid()::text,1,8), 'subscription', false,
          _plan.name, 150, 5, 'active', now() - interval '90 days')
  returning id into _paid;

  -- 1 + 6
  if not public.subscription_is_free(_free) then raise exception 'FAIL: zero-priced shop not recognised as free'; end if;
  if public.subscription_is_free(_paid) then raise exception 'FAIL: priced shop treated as free'; end if;

  -- 2 + 6
  if not public.subscription_ok(_free) then raise exception 'FAIL: free shop must stay operational past its period end'; end if;
  if public.subscription_ok(_paid) then raise exception 'FAIL: expired priced shop must not stay operational'; end if;

  -- 3
  insert into public.shop_subscriptions (ecosystem_id, plan_id, state, period_end)
  values (_free, _plan.id, 'active', now() - interval '90 days'),
         (_paid, _plan.id, 'active', now() - interval '90 days')
  on conflict (ecosystem_id) do update set state = 'active', period_end = excluded.period_end;

  perform public.run_subscription_expiry(false);

  if (select state from public.shop_subscriptions where ecosystem_id = _free) <> 'active' then
    raise exception 'FAIL: free shop subscription was expired by the nightly job';
  end if;
  if (select coalesce(operations_frozen, false) from public.ecosystems where id = _free) then
    raise exception 'FAIL: free shop was frozen for non-payment';
  end if;
  if (select state from public.shop_subscriptions where ecosystem_id = _paid) <> 'expired' then
    raise exception 'FAIL: expired priced shop should have been expired';
  end if;

  -- 5: free activation needs no payment evidence at all.
  _sub := public.activate_free_subscription(_free, _plan.id, 3);
  if _sub.state <> 'active' then raise exception 'FAIL: free activation did not activate'; end if;
  if _sub.period_end <= now() then raise exception 'FAIL: free activation did not extend the period'; end if;
  if not exists (select 1 from public.subscription_events
                  where ecosystem_id = _free and coalesce(amount_php, 0) = 0) then
    raise exception 'FAIL: free activation should record a zero amount';
  end if;
  if exists (select 1 from public.subscription_requests where ecosystem_id = _free) then
    raise exception 'FAIL: a free subscription must never create a payment request';
  end if;

  RAISE NOTICE 'zero-priced-subscription: all assertions passed';
END $$;

-- 4: paying for a free shop is refused (expected to raise).
DO $$
DECLARE _free uuid; _plan public.subscription_plans; _ok boolean := false;
BEGIN
  select id into _free from public.ecosystems where name = 'ZeroTest Free' limit 1;
  select * into _plan from public.subscription_plans where active limit 1;
  BEGIN
    perform public.submit_go_live_payment(_free, _plan.id, '09171234567', 'ZEROTEST1', 1, 0, 'x/y.jpg', null);
  EXCEPTION WHEN others THEN
    _ok := true;
  END;
  if not _ok then raise exception 'FAIL: a zero-priced shop must not be able to submit a payment'; end if;
  RAISE NOTICE 'zero-priced-subscription: payment correctly refused for a free shop';
END $$;

ROLLBACK;
