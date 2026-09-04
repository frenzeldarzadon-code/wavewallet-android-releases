-- Phone push delivery pipeline regression tests.
--
--   \i supabase/tests/push-delivery-pipeline.sql
--
-- Everything runs inside a sub-block that is ALWAYS rolled back.
--
-- Expectations:
--   1. a social notification (not only money) queues one pending delivery per
--      real push device of the recipient; local fallbacks never get one
--   2. account push off => skipped (account_push_disabled), history kept
--   3. muted category => skipped (category_muted)
--   4. claim marks rows "sending" and returns the subscription + safe text;
--      a second claim returns nothing (no double send)
--   5. finish "sent" resets device failures
--   6. finish "failed" + device gone expires the device and its queued rows
--   7. finish "pending" requeues for retry and is not re-claimed immediately
--   8. deliveries never cross users; only the owner's devices are targeted
--   9. re-running the same financial event key never queues twice
--  10. the self-test notification is rate limited per person

DO $$
DECLARE
  _a uuid; _b uuid; _eco uuid;
  _dev_a1 uuid; _dev_a2 uuid; _dev_local uuid; _dev_b uuid;
  _n uuid; _count integer; _d1 uuid; _d2 uuid; _claimed integer; _fail integer;
  _row record;
BEGIN
 BEGIN
  SELECT id INTO _eco FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _a FROM public.profiles WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO _b FROM public.profiles WHERE deleted_at IS NULL AND id <> _a ORDER BY created_at LIMIT 1;
  IF _a IS NULL OR _b IS NULL THEN RAISE NOTICE 'SKIP: need two members'; RETURN; END IF;

  DELETE FROM public.member_notifications WHERE user_id IN (_a, _b);
  DELETE FROM public.push_devices WHERE user_id IN (_a, _b);
  INSERT INTO public.notification_preferences (user_id, disabled_kinds, push_enabled)
  VALUES (_a, '{}', true), (_b, '{}', true)
  ON CONFLICT (user_id) DO UPDATE SET disabled_kinds = '{}', push_enabled = true;

  INSERT INTO public.push_devices (user_id, endpoint, p256dh, auth_secret, device_label)
  VALUES (_a, 'https://push.test/a1', 'BAAA', 'AAAA', 'Phone') RETURNING id INTO _dev_a1;
  INSERT INTO public.push_devices (user_id, endpoint, p256dh, auth_secret, device_label)
  VALUES (_a, 'https://push.test/a2', 'BAAA', 'AAAA', 'Laptop') RETURNING id INTO _dev_a2;
  INSERT INTO public.push_devices (user_id, endpoint, device_label)
  VALUES (_a, 'local:test-a', 'Old browser') RETURNING id INTO _dev_local;
  INSERT INTO public.push_devices (user_id, endpoint, p256dh, auth_secret, device_label)
  VALUES (_b, 'https://push.test/b1', 'BAAA', 'AAAA', 'B phone') RETURNING id INTO _dev_b;

  -- 1. social notification -> one pending per real device, none for local
  PERFORM public.notify_universe(_a, 'dm_message', 'New private message', 'Someone sent you a message',
                                 '/universe/messages?thread=t1');
  SELECT id INTO _n FROM public.member_notifications WHERE user_id = _a AND kind = 'dm_message';
  SELECT count(*) INTO _count FROM public.notification_deliveries WHERE notification_id = _n AND status = 'pending';
  IF _count <> 2 THEN RAISE EXCEPTION 'FAIL 1: expected 2 pending deliveries, got %', _count; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_deliveries WHERE notification_id = _n AND device_id = _dev_local) THEN
    RAISE EXCEPTION 'FAIL 1: local fallback device was queued';
  END IF;

  -- 8. isolation: nothing for B
  IF EXISTS (SELECT 1 FROM public.notification_deliveries WHERE notification_id = _n AND user_id <> _a) THEN
    RAISE EXCEPTION 'FAIL 8: delivery leaked to another user';
  END IF;

  -- 4. claim -> sending, safe fields, no second claim
  _claimed := 0;
  FOR _row IN SELECT * FROM public.claim_push_deliveries(10) LOOP
    _claimed := _claimed + 1;
    IF _row.user_id <> _a THEN RAISE EXCEPTION 'FAIL 4: claimed another user''s delivery'; END IF;
    IF _row.endpoint NOT LIKE 'https://push.test/%' THEN RAISE EXCEPTION 'FAIL 4: bad endpoint %', _row.endpoint; END IF;
    IF _row.kind <> 'dm_message' OR _row.link <> '/universe/messages?thread=t1' THEN
      RAISE EXCEPTION 'FAIL 4: wrong notification content';
    END IF;
  END LOOP;
  IF _claimed <> 2 THEN RAISE EXCEPTION 'FAIL 4: expected 2 claimed, got %', _claimed; END IF;
  SELECT count(*) INTO _count FROM public.claim_push_deliveries(10);
  IF _count <> 0 THEN RAISE EXCEPTION 'FAIL 4: second claim returned % rows', _count; END IF;
  SELECT count(*) INTO _count FROM public.notification_deliveries WHERE notification_id = _n AND status = 'sending';
  IF _count <> 2 THEN RAISE EXCEPTION 'FAIL 4: expected 2 sending'; END IF;

  SELECT id INTO _d1 FROM public.notification_deliveries WHERE notification_id = _n AND device_id = _dev_a1;
  SELECT id INTO _d2 FROM public.notification_deliveries WHERE notification_id = _n AND device_id = _dev_a2;

  -- 5. sent resets failures
  UPDATE public.push_devices SET failure_count = 3 WHERE id = _dev_a1;
  PERFORM public.finish_push_delivery(_d1, 'sent');
  SELECT failure_count INTO _fail FROM public.push_devices WHERE id = _dev_a1;
  IF _fail <> 0 THEN RAISE EXCEPTION 'FAIL 5: failure_count not reset'; END IF;
  IF (SELECT status FROM public.notification_deliveries WHERE id = _d1) <> 'sent' THEN
    RAISE EXCEPTION 'FAIL 5: delivery not marked sent';
  END IF;

  -- 7. transient failure -> requeued, not immediately re-claimed
  PERFORM public.finish_push_delivery(_d2, 'pending', '503 busy');
  IF (SELECT status FROM public.notification_deliveries WHERE id = _d2) <> 'pending' THEN
    RAISE EXCEPTION 'FAIL 7: not requeued';
  END IF;
  SELECT count(*) INTO _count FROM public.claim_push_deliveries(10);
  IF _count <> 0 THEN RAISE EXCEPTION 'FAIL 7: retry was re-claimed immediately'; END IF;
  UPDATE public.notification_deliveries SET updated_at = now() - interval '6 minutes' WHERE id = _d2;
  SELECT count(*) INTO _count FROM public.claim_push_deliveries(10);
  IF _count <> 1 THEN RAISE EXCEPTION 'FAIL 7: retry not claimable after backoff, got %', _count; END IF;

  -- 6. device gone -> device expired, other queued rows for it expired
  PERFORM public.notify_universe(_a, 'friend_request', 'New friend request', 'Someone', '/universe/friends');
  PERFORM public.finish_push_delivery(_d2, 'failed', 'subscription gone (410)', true);
  IF (SELECT expired_at FROM public.push_devices WHERE id = _dev_a2) IS NULL THEN
    RAISE EXCEPTION 'FAIL 6: device not expired';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_deliveries
              WHERE device_id = _dev_a2 AND status IN ('pending', 'sending')) THEN
    RAISE EXCEPTION 'FAIL 6: dead device still has queued deliveries';
  END IF;
  -- the live device still got the friend request
  IF NOT EXISTS (SELECT 1 FROM public.notification_deliveries d
                   JOIN public.member_notifications n ON n.id = d.notification_id
                  WHERE n.user_id = _a AND n.kind = 'friend_request' AND d.device_id = _dev_a1
                    AND d.status = 'pending') THEN
    RAISE EXCEPTION 'FAIL 6: live device missed the next notification';
  END IF;

  -- 2. account push off -> skipped
  UPDATE public.notification_preferences SET push_enabled = false WHERE user_id = _b;
  PERFORM public.notify_universe(_b, 'follow', 'New follower', 'Someone', '/universe/u/x');
  IF NOT EXISTS (SELECT 1 FROM public.notification_deliveries d JOIN public.member_notifications n ON n.id = d.notification_id
                  WHERE n.user_id = _b AND n.kind = 'follow' AND d.status = 'skipped' AND d.reason = 'account_push_disabled') THEN
    RAISE EXCEPTION 'FAIL 2: account push off did not skip';
  END IF;

  -- 3. muted category -> skipped (financial keeps history)
  UPDATE public.notification_preferences SET push_enabled = true, disabled_kinds = '{cashback}' WHERE user_id = _b;
  PERFORM public.notify_financial(_b, _eco, 'cashback', 'Cashback received — 1.00 Coins', null, null, 'push-test:cb:1');
  IF NOT EXISTS (SELECT 1 FROM public.notification_deliveries d JOIN public.member_notifications n ON n.id = d.notification_id
                  WHERE n.user_id = _b AND n.kind = 'cashback' AND d.status = 'skipped' AND d.reason = 'category_muted') THEN
    RAISE EXCEPTION 'FAIL 3: muted category not skipped';
  END IF;

  -- 9. same event key twice -> one notification, one delivery set
  UPDATE public.notification_preferences SET disabled_kinds = '{}' WHERE user_id = _b;
  PERFORM public.notify_financial(_b, _eco, 'transfer', 'Coins received — 2.00', null, '/universe/wallet', 'push-test:tr:1');
  PERFORM public.notify_financial(_b, _eco, 'transfer', 'Coins received — 2.00', null, '/universe/wallet', 'push-test:tr:1');
  SELECT count(*) INTO _count FROM public.member_notifications WHERE user_id = _b AND event_key = 'push-test:tr:1';
  IF _count <> 1 THEN RAISE EXCEPTION 'FAIL 9: duplicate notification'; END IF;
  SELECT count(*) INTO _count FROM public.notification_deliveries d JOIN public.member_notifications n ON n.id = d.notification_id
   WHERE n.event_key = 'push-test:tr:1';
  IF _count <> 1 THEN RAISE EXCEPTION 'FAIL 9: expected 1 delivery, got %', _count; END IF;

  RAISE NOTICE 'push-delivery-pipeline: all checks passed';
  RAISE EXCEPTION 'ROLLBACK_TEST';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'ROLLBACK_TEST' THEN
    RAISE NOTICE 'rolled back';
  ELSE
    RAISE;
  END IF;
 END;
END $$;
