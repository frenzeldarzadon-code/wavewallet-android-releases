-- Cash In: the corrected automatic approval rule.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
--
-- Rules under test:
--   A) amount + sending number agree => auto approve, even when the phone
--      notification carries no reference at all;
--   B) the receipt reference is customer-side evidence: a notification with a
--      different (or missing) reference must NOT block the approval;
--   C) the amount on its own is one signal and must stay pending;
--   D) reusing a receipt reference that already settled a cash in is declined;
--   E) reusing the same screenshot image is declined;
--   F) a notification captured minutes (or hours) later still approves.
begin;

do $$
declare _uid uuid; _eco uuid; _method uuid; _dev uuid; _row public.cash_in_requests;
        _second public.cash_in_requests; _rec public.payment_match_records;
        _recv constant text := '09541230074';
        _sender constant text := '09171234567';
        _hash constant text := repeat('e', 64);
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
  values (_eco, true, true, 0, null, 5000, true);

  insert into public.listener_devices (label, ecosystem_id, secret_key_hash, status, package_name,
                                       match_window_minutes, offline_after_minutes, last_seen_at)
  values ('two signal listener', _eco, repeat('f', 64), 'active', 'com.globe.gcash.android',
          60, 30, now())
  returning id into _dev;

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  -- A + B + F: amount and sending number agree; the notification carries no
  -- reference and was captured six minutes after the payment.
  _ref := 'REF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number_key, posted_at, created_at, outcome)
  values (_dev, 'evt-two-a', 'com.globe.gcash.android', 1500,
          public.normalize_ph_mobile(_sender),
          now() - interval '6 minutes', now(), 'accepted');

  _row := public.request_cash_in(_method, 1500, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/two-a.jpg', _sender, null,
                                 now() - interval '6 minutes',
                                 jsonb_build_object('provider_name', 'GCash'));

  if _row.status <> 'approved' or _row.approval_method <> 'automatic' then
    raise exception 'A: amount + sender must approve without any listener reference (got % / %)',
      _row.status, _row.approval_method;
  end if;

  select * into _rec from public.payment_match_records
   where cash_in_id = _row.id and decision = 'auto_approved';
  if _rec.id is null or _rec.signal_count < 2 then
    raise exception 'A: the durable record must show >= 2 agreeing signals';
  end if;

  -- C: the amount alone is one signal and can never settle a cash in.
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      posted_at, created_at, outcome)
  values (_dev, 'evt-two-c', 'com.globe.gcash.android', 1500,
          now() - interval '2 minutes', now(), 'accepted');

  _second := public.request_cash_in(_method, 1500,
                                    'REF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
                                    null, gen_random_uuid()::text, _uid::text || '/two-c.jpg',
                                    '09995550000', null, now() - interval '2 minutes',
                                    jsonb_build_object('provider_name', 'GCash'));
  if _second.status <> 'pending' then
    raise exception 'C: the amount alone must never approve a cash in (got %)', _second.status;
  end if;

  -- D: the same receipt reference may never settle a second cash in.
  _second := public.request_cash_in(_method, 1500, _ref, null, gen_random_uuid()::text,
                                    _uid::text || '/two-d.jpg', _sender, null, now(),
                                    jsonb_build_object('provider_name', 'GCash'));
  if _second.status = 'approved' then
    raise exception 'D: a reused receipt reference must never approve again';
  end if;

  -- E: the same screenshot may never settle a second cash in.
  _row := public.request_cash_in(_method, 200,
                                 'RE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
                                 null, gen_random_uuid()::text, _uid::text || '/two-e1.jpg',
                                 _sender, null, now());
  perform public.apply_cash_in_receipt_ocr(_row.id, 'TWO-E-1', 200, null, true, null,
                                           now(), null, 'GCash', null, null, null, _hash);
  _second := public.request_cash_in(_method, 200,
                                    'RE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
                                    null, gen_random_uuid()::text, _uid::text || '/two-e2.jpg',
                                    _sender, null, now());
  perform public.apply_cash_in_receipt_ocr(_second.id, 'TWO-E-2', 200, null, true, null,
                                           now(), null, 'GCash', null, null, null, _hash);

  if not (select duplicate_receipt from public.cash_in_requests where id = _second.id) then
    raise exception 'E: reusing the same screenshot must be flagged as a duplicate receipt';
  end if;
  if (select status from public.cash_in_requests where id = _second.id) = 'approved' then
    raise exception 'E: a reused screenshot must never auto-approve a second cash in';
  end if;

  raise notice 'the corrected two-signal rule holds';
end $$;

rollback;
