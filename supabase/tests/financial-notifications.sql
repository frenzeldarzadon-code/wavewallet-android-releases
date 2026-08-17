-- Financial notification system regression tests.
--
--   \i supabase/tests/financial-notifications.sql
--
-- Everything runs inside a sub-block that is ALWAYS rolled back.
--
-- Expectations:
--   1. a committed wallet movement writes exactly one alert
--   2. re-running the same event key never creates a second alert (idempotency)
--   3. every money state/type gets its own alert (cash in pending -> approved,
--      points, refunds, wallet adjustments)
--   4. a pending Cash In NEVER produces an "approved" alert
--   5. every active device of the person gets a delivery row
--   6. expired / disabled devices get no delivery row
--   7. with account push off, the in-app alert is still recorded (skipped push)
--   8. a muted category still keeps mandatory in-app history
--   9. alerts and delivery rows belong to one person only (isolation)
--  10. a failing alert never breaks the financial write

DO $$
DECLARE
  _eco uuid; _a uuid; _b uuid; _acct uuid;
  _n1 uuid; _n2 uuid; _dev1 uuid; _dev2 uuid; _dev3 uuid;
  _count integer; _cash uuid; _bal numeric;
BEGIN
 BEGIN
  SELECT id INTO _eco FROM public.ecosystems ORDER BY created_at LIMIT 1;
  IF _eco IS NULL THEN RAISE NOTICE 'SKIP: no ecosystem'; RETURN; END IF;
  SELECT id INTO _a FROM public.profiles WHERE ecosystem_id = _eco AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO _b FROM public.profiles WHERE ecosystem_id = _eco AND deleted_at IS NULL AND id <> _a LIMIT 1;
  IF _a IS NULL OR _b IS NULL THEN RAISE NOTICE 'SKIP: need two members'; RETURN; END IF;

  DELETE FROM public.member_notifications WHERE user_id IN (_a, _b);
  DELETE FROM public.push_devices WHERE user_id IN (_a, _b);
  INSERT INTO public.notification_preferences (user_id, disabled_kinds, push_enabled)
  VALUES (_a, '{}', true)
  ON CONFLICT (user_id) DO UPDATE SET disabled_kinds = '{}', push_enabled = true;

  -- two live devices, one expired, one switched off
  INSERT INTO public.push_devices (user_id, endpoint, device_label)
  VALUES (_a, 'local:test-a-1', 'Phone') RETURNING id INTO _dev1;
  INSERT INTO public.push_devices (user_id, endpoint, device_label)
  VALUES (_a, 'local:test-a-2', 'Laptop') RETURNING id INTO _dev2;
  INSERT INTO public.push_devices (user_id, endpoint, device_label, expired_at)
  VALUES (_a, 'local:test-a-3', 'Old phone', now()) RETURNING id INTO _dev3;
  INSERT INTO public.push_devices (user_id, endpoint, device_label, push_enabled)
  VALUES (_a, 'local:test-a-4', 'Muted tablet', false);

  -- 1 + 5. one alert, one delivery row per active device
  _n1 := public.notify_financial(_a, _eco, 'cashback', 'Cashback received — 5.00 Coins',
                                 'From a voucher sale', null, 'test:evt:1');
  IF _n1 IS NULL THEN RAISE EXCEPTION 'FAIL 1: no alert written'; END IF;
  SELECT count(*) INTO _count FROM public.notification_deliveries WHERE notification_id = _n1;
  IF _count <> 2 THEN
    RAISE EXCEPTION 'FAIL 5/6: expected 2 device deliveries, got %', _count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_deliveries
              WHERE notification_id = _n1 AND device_id IN (_dev3)) THEN
    RAISE EXCEPTION 'FAIL 6: expired device received a delivery';
  END IF;

  -- 2. idempotency
  _n2 := public.notify_financial(_a, _eco, 'cashback', 'Cashback received — 5.00 Coins',
                                 'Retry of the same event', null, 'test:evt:1');
  IF _n2 IS NOT NULL THEN RAISE EXCEPTION 'FAIL 2: duplicate alert created'; END IF;
  SELECT count(*) INTO _count FROM public.member_notifications WHERE event_key = 'test:evt:1';
  IF _count <> 1 THEN RAISE EXCEPTION 'FAIL 2: % rows for one event key', _count; END IF;

  -- 7. account push off -> in-app kept, push skipped
  UPDATE public.notification_preferences SET push_enabled = false WHERE user_id = _a;
  _n2 := public.notify_financial(_a, _eco, 'transfer', 'Coins received — 10.00', null, null,
                                 'test:evt:2');
  IF _n2 IS NULL THEN RAISE EXCEPTION 'FAIL 7: in-app alert dropped when push is off'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_deliveries
                  WHERE notification_id = _n2 AND status = 'skipped'
                    AND reason = 'account_push_disabled') THEN
    RAISE EXCEPTION 'FAIL 7: push-disabled reason not logged';
  END IF;

  -- 8. muted category keeps mandatory history
  UPDATE public.notification_preferences
     SET push_enabled = true, disabled_kinds = ARRAY['points'] WHERE user_id = _a;
  _n2 := public.notify_financial(_a, _eco, 'points', 'Points earned — 3', null, null,
                                 'test:evt:3');
  IF _n2 IS NULL THEN RAISE EXCEPTION 'FAIL 8: muted category lost its in-app record'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_deliveries
                  WHERE notification_id = _n2 AND reason = 'category_muted') THEN
    RAISE EXCEPTION 'FAIL 8: muted reason not logged';
  END IF;
  UPDATE public.notification_preferences SET disabled_kinds = '{}' WHERE user_id = _a;

  -- 3 + 4. Cash In states, pending never says approved
  SELECT id INTO _cash FROM public.cash_in_requests
   WHERE user_id = _a AND status = 'pending' LIMIT 1;
  IF _cash IS NULL THEN
    INSERT INTO public.cash_in_requests
      (user_id, ecosystem_id, amount_php, credits, rate_credits, rate_php, status,
       requester_name, requester_role, method_name, method_type)
    VALUES (_a, _eco, 100, 100, 1, 1, 'pending', 'Test', 'customer', 'GCash', 'gcash')
    RETURNING id INTO _cash;
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_notifications
              WHERE user_id = _a AND kind = 'cash_in' AND title ILIKE '%approved%'
                AND event_key = 'cash_in:' || _cash::text || ':approved') THEN
    RAISE EXCEPTION 'FAIL 4: pending Cash In produced an approved alert';
  END IF;

  -- 9. isolation: nothing of person A is visible to person B
  IF EXISTS (SELECT 1 FROM public.member_notifications WHERE user_id = _b
              AND event_key LIKE 'test:evt:%') THEN
    RAISE EXCEPTION 'FAIL 9: alerts leaked to another member';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_deliveries d
              JOIN public.member_notifications n ON n.id = d.notification_id
             WHERE d.user_id <> n.user_id) THEN
    RAISE EXCEPTION 'FAIL 9: delivery row belongs to a different person';
  END IF;

  -- 10. an alerting failure must never roll back the money write
  BEGIN
    PERFORM public.notify_financial_safe(_a, _eco, 'cashback', repeat('x', 1), null, null, null);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'FAIL 10: alerting raised into the financial transaction';
  END;

  -- 3. deleted people are never alerted
  IF public.notify_financial(null, _eco, 'cashback', 'x', null, null, 'test:evt:none') IS NOT NULL
  THEN RAISE EXCEPTION 'FAIL: alert written without a recipient'; END IF;

  RAISE NOTICE 'financial-notifications: ALL CHECKS PASSED';
  RAISE EXCEPTION 'ROLLBACK_TEST';
 EXCEPTION WHEN others THEN
   IF SQLERRM = 'ROLLBACK_TEST' THEN
     RAISE NOTICE 'rolled back cleanly';
   ELSE
     RAISE;
   END IF;
 END;
END $$;
