-- Cash In: a notification captured LATE must still approve.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
--
-- The non-negotiable rule under test:
--   * automatic approval needs >= 2 independent agreeing signals between the
--     customer's receipt and the phone's notification, at least one of them a
--     strong identity signal (reference or sender account);
--   * the amount alone is never enough;
--   * the time the phone captured/delivered the notification is NEVER one of
--     those signals and must never fail an otherwise valid payment;
--   * a durable match record stores which signals agreed, with the listener's
--     received time kept separately as metadata.
--
-- Covers:
--   A. the notification is posted 3 hours before the request and only reaches
--      the server now (captured late) => still approves, match record written.
--   B. the same late payment with only the amount agreeing => stays pending.
begin;

do $$
declare _uid uuid; _eco uuid; _method uuid; _dev uuid; _row public.cash_in_requests;
        _ev uuid; _rec public.payment_match_records;
        _sender constant text := '09995550031';
        _other  constant text := '09995550032';
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
  values (_eco, true, true, 0, null, 2000, true);

  insert into public.listener_devices (label, ecosystem_id, secret_key_hash, status, package_name,
                                       match_window_minutes, offline_after_minutes, last_seen_at)
  values ('late capture device', _eco, repeat('b', 64), 'active', 'com.globe.gcash.android',
          60, 30, now())
  returning id into _dev;

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  -- A. Payment happened 3 hours ago, the phone only delivered it now ---------
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number, sender_number_key, posted_at, created_at,
                                      outcome, provider_id)
  values (_dev, 'evt-late-a', 'com.globe.gcash.android', 1500, _sender,
          public.normalize_ph_mobile(_sender), now() - interval '3 hours', now(),
          'accepted', 'gcash')
  returning id into _ev;

  _ref := 'GC-' || gen_random_uuid()::text;
  _row := public.request_cash_in(_method, 1500, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/late-a.jpg', '+63 999 555 0031',
                                 null, now() - interval '3 hours');

  if _row.status <> 'approved' or _row.approval_method <> 'automatic' then
    raise exception 'A: a notification captured 3 hours after the payment must still approve (got % / %)',
      _row.status, _row.approval_method;
  end if;
  if _row.listener_event_id is distinct from _ev then
    raise exception 'A: the late notification must be the one that was consumed';
  end if;

  select * into _rec from public.payment_match_records
   where cash_in_id = _row.id and decision = 'auto_approved';
  if _rec.id is null then
    raise exception 'A: an auditable match record must be written on approval';
  end if;
  if _rec.signal_count < 2 or not _rec.strong_signal then
    raise exception 'A: the record must show >= 2 signals with a strong one (got % / %)',
      _rec.signal_count, _rec.strong_signal;
  end if;
  if (select count(*) from jsonb_array_elements(_rec.signals) s
       where (s->>'agreed')::boolean and s->>'strength' <> 'veto') < 2 then
    raise exception 'A: the record must name at least two agreeing signals';
  end if;
  if exists (select 1 from jsonb_array_elements(_rec.signals) s
              where s->>'signal' in ('listener_received_at', 'time', 'timestamp')) then
    raise exception 'A: capture time must never be recorded as a matching signal';
  end if;
  if _rec.timing->>'listener_received_at' is null
     or _rec.timing->>'notification_posted_at' is null then
    raise exception 'A: the listener received time must be kept as timing metadata';
  end if;
  if coalesce((_rec.timing->>'capture_delay_minutes')::int, 0) < 150 then
    raise exception 'A: the recorded capture delay should reflect the late delivery (got %)',
      _rec.timing->>'capture_delay_minutes';
  end if;

  -- B. Late capture, amount agrees but nothing else => never approves --------
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number, sender_number_key, posted_at, created_at,
                                      outcome, provider_id)
  values (_dev, 'evt-late-b', 'com.globe.gcash.android', 1500, _other,
          public.normalize_ph_mobile(_other), now() - interval '4 hours', now(),
          'accepted', 'gcash');

  _row := public.request_cash_in(_method, 1500, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/late-b.jpg',
                                 _sender, null, now() - interval '4 hours');
  if _row.status <> 'pending' or _row.listener_event_id is not null then
    raise exception 'B: the amount alone must never approve a payment (got %)', _row.status;
  end if;
  if exists (select 1 from public.payment_match_records
              where cash_in_id = _row.id and decision = 'auto_approved') then
    raise exception 'B: no approval record may exist for an unapproved payment';
  end if;

  raise notice 'late-notification capture rules hold';
end $$;

rollback;
