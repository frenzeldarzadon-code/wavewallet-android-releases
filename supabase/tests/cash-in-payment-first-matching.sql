-- Cash In: payment-first matching against real GCash listener notifications.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
-- Covers:
--   A. the customer pays FIRST and submits the Cash In afterwards => automatic
--      approval, the notification is consumed exactly once.
--   B. a payment from a different sending number => stays pending.
--   C. a payment with a different amount => stays pending.
--   D. a reference already used by another Cash In => rejected duplicate, no credit.
--   E. the same notification delivered twice => one event, no second approval.
--   F. two pending requests that both fit one payment => ambiguous, none approved.
--   G. a payment outside the device's matching window => stays pending.
begin;

do $$
declare _uid uuid; _eco uuid; _method uuid; _dev uuid; _row public.cash_in_requests;
        _ev uuid; _ev2 uuid; _res text; _before numeric; _after numeric;
        _sender constant text := '09070321959';
        _other  constant text := '09181234567';
        _recv   constant text := '09541230072';
        _ref text;
begin
  select p.id, p.ecosystem_id into _uid, _eco
    from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) and p.ecosystem_id is not null
   limit 1;
  select id into _method from public.payment_methods where active limit 1;
  if _uid is null or _method is null then
    raise notice 'skipped: no active member with a shop, or no payment method';
    return;
  end if;

  update public.ecosystems set cash_in_gcash_number = _recv where id = _eco;
  delete from public.cash_in_auto_rules where ecosystem_id is not distinct from _eco;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                         amount_tolerance_php, expected_amount_php,
                                         max_auto_amount_php, require_listener_match)
  values (_eco, true, true, 0, null, 200, true);

  insert into public.listener_devices (label, ecosystem_id, secret_key_hash, status, package_name,
                                       match_window_minutes, offline_after_minutes, last_seen_at)
  values ('test device', _eco, repeat('a', 64), 'active', 'com.globe.gcash.android', 60, 30, now())
  returning id into _dev;

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  select coalesce(sum(balance), 0) into _before from public.credit_accounts where user_id = _uid;

  -- A. Payment first, request afterwards ------------------------------------
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number, sender_number_key, posted_at, outcome)
  values (_dev, 'evt-a', 'com.globe.gcash.android', 100, _sender,
          public.normalize_ph_mobile(_sender), now() - interval '2 minutes', 'accepted')
  returning id into _ev;
  if public.match_listener_event(_ev) <> 'no_pending_match' then
    raise exception 'A: a payment with nothing pending yet must simply wait';
  end if;

  _ref := 'GC-' || gen_random_uuid()::text;
  _row := public.request_cash_in(_method, 100, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/a.jpg', '+63 907 032 1959');
  if _row.status <> 'approved' or _row.approval_method <> 'automatic' then
    raise exception 'A: a request submitted after the payment must approve automatically (got % / %)',
      _row.status, _row.approval_method;
  end if;
  if _row.listener_event_id is distinct from _ev then
    raise exception 'A: the request must be linked to the real notification';
  end if;
  select coalesce(sum(balance), 0) into _after from public.credit_accounts where user_id = _uid;
  if _after - _before <> _row.credits then
    raise exception 'A: exactly one credit of % expected, balance moved %', _row.credits, _after - _before;
  end if;
  if (select count(*) from public.platform_credit_issuances
       where request_key = 'cash_in:' || _row.id::text) <> 1 then
    raise exception 'A: crediting must be booked exactly once';
  end if;

  -- B. Wrong sending number --------------------------------------------------
  _before := _after;
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number, sender_number_key, posted_at, outcome)
  values (_dev, 'evt-b', 'com.globe.gcash.android', 110, _other,
          public.normalize_ph_mobile(_other), now(), 'accepted');
  _row := public.request_cash_in(_method, 110, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/b.jpg', _sender);
  if _row.status <> 'pending' or _row.listener_event_id is not null then
    raise exception 'B: a payment from another number must not match (got %)', _row.status;
  end if;

  -- C. Wrong amount ----------------------------------------------------------
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number, sender_number_key, posted_at, outcome)
  values (_dev, 'evt-c', 'com.globe.gcash.android', 120, _sender,
          public.normalize_ph_mobile(_sender), now(), 'accepted');
  _row := public.request_cash_in(_method, 121, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/c.jpg', _sender);
  if _row.status <> 'pending' or _row.listener_event_id is not null then
    raise exception 'C: a different amount must not match (got %)', _row.status;
  end if;

  -- D. Duplicate reference ---------------------------------------------------
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number, sender_number_key, posted_at, outcome)
  values (_dev, 'evt-d', 'com.globe.gcash.android', 130, _sender,
          public.normalize_ph_mobile(_sender), now(), 'accepted');
  _row := public.request_cash_in(_method, 130, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/d.jpg', _sender);
  if _row.status <> 'rejected' or _row.decision_reason not like 'Duplicate payment reference%' then
    raise exception 'D: a repeated reference must be rejected even with a real payment (got % / %)',
      _row.status, _row.decision_reason;
  end if;

  select coalesce(sum(balance), 0) into _after from public.credit_accounts where user_id = _uid;
  if _after <> _before then
    raise exception 'B/C/D: unmatched or duplicate requests must not credit anything';
  end if;

  -- E. The same notification delivered twice ---------------------------------
  begin
    insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                        sender_number, sender_number_key, posted_at, outcome)
    values (_dev, 'evt-a', 'com.globe.gcash.android', 100, _sender,
            public.normalize_ph_mobile(_sender), now(), 'accepted');
    raise exception 'E: the same notification must not be stored twice';
  exception when unique_violation then
    null; -- expected
  end;
  if public.match_listener_event(_ev) <> 'already_consumed' then
    raise exception 'E: a consumed payment must never be reused';
  end if;

  -- F. Two pending requests that both fit one payment ------------------------
  perform public.request_cash_in(_method, 140, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/f1.jpg', _sender);
  perform public.request_cash_in(_method, 140, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/f2.jpg', _sender);
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number, sender_number_key, posted_at, outcome)
  values (_dev, 'evt-f', 'com.globe.gcash.android', 140, _sender,
          public.normalize_ph_mobile(_sender), now(), 'accepted')
  returning id into _ev2;
  _res := public.match_listener_event(_ev2);
  if _res <> 'ambiguous' then
    raise exception 'F: two possible requests must stay ambiguous (got %)', _res;
  end if;
  if exists (select 1 from public.cash_in_requests
              where user_id = _uid and amount_php = 140 and status <> 'pending') then
    raise exception 'F: an ambiguous payment must approve nothing';
  end if;

  -- G. Outside the matching window -------------------------------------------
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number, sender_number_key, posted_at, outcome)
  values (_dev, 'evt-g', 'com.globe.gcash.android', 150, _sender,
          public.normalize_ph_mobile(_sender), now() - interval '6 hours', 'accepted');
  _row := public.request_cash_in(_method, 150, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/g.jpg', _sender);
  if _row.status <> 'pending' or _row.listener_event_id is not null then
    raise exception 'G: a payment outside the matching window must not match (got %)', _row.status;
  end if;

  select coalesce(sum(balance), 0) into _after from public.credit_accounts where user_id = _uid;
  if _after <> _before then
    raise exception 'B–G: only the single matched payment may ever credit';
  end if;

  raise notice 'cash-in payment-first matching: all cases passed';
end $$;

rollback;
