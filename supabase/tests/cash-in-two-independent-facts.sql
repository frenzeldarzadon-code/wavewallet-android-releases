-- Cash In: two INDEPENDENT agreeing facts, in either arrival order.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
--
-- Rules under test:
--   1) the number the member typed is supporting evidence only: a notification
--      sent from a different account still approves when the exact amount AND
--      the reference agree (two independent facts);
--   2) a receipt whose receiving account is masked or simply absent from the
--      notification is informational and must never block;
--   3) the notification arriving BEFORE the cash in is submitted still links;
--   4) the notification arriving AFTER the cash in is submitted still links;
--   5) only one agreeing fact keeps the cash in pending for a person;
--   6) a reference that already settled a cash in never credits again.
begin;

do $$
declare _uid uuid; _eco uuid; _method uuid; _dev uuid; _acct text;
        _row public.cash_in_requests; _evt uuid;
              _typed constant text := '09171234567';
        _other constant text := '09998887777';
        _ref text;
begin
  select p.id, p.ecosystem_id into _uid, _eco
    from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) and p.ecosystem_id is not null
   limit 1;
  select id, account_number into _method, _acct from public.payment_methods where active limit 1;
  if _uid is null or _method is null then
    raise notice 'skipped: no active member with a shop, or no payment method';
    return;
  end if;

  update public.ecosystems set cash_in_gcash_number = _acct where id = _eco;
  delete from public.cash_in_auto_rules where ecosystem_id is not distinct from _eco;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                         amount_tolerance_php, expected_amount_php,
                                         max_auto_amount_php, require_listener_match)
  values (_eco, true, true, 0, null, 5000, true);

  insert into public.listener_devices (label, ecosystem_id, secret_key_hash, status, package_name,
                                       match_window_minutes, offline_after_minutes, last_seen_at)
  values ('independent facts listener', _eco, repeat('f', 64), 'active',
          'com.globe.gcash.android', 60, 30, now())
  returning id into _dev;

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  ------------------------------------------------------------------ 1 + 2 + 3
  -- The notification arrives FIRST, from an account the member did not type,
  -- and prints no receiving account at all. Amount + reference agree.
  _ref := 'IND-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number_key, gcash_reference, posted_at, created_at,
                                      outcome, details)
  values (_dev, 'evt-ind-1', 'com.globe.gcash.android', 750,
          public.normalize_ph_mobile(_other), _ref,
          now() - interval '4 minutes', now(), 'accepted',
          jsonb_build_object('receiving_account', _acct));

  _row := public.request_cash_in(_method, 750, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/ind-1.jpg', _typed, null,
                                 now() - interval '4 minutes',
                                 jsonb_build_object('provider_name', 'GCash'));
  -- The receipt is read exactly as the upload pipeline does it: the receiving
  -- account on the sender-side receipt is MASKED.
  perform public.apply_cash_in_receipt_ocr(_row.id, _ref, 750, _typed, true, null,
                                           now() - interval '4 minutes', '····' || right(_acct, 4), 'GCash',
                                           null, null, null, repeat('1', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'approved' or _row.approval_method <> 'automatic' then
    raise exception '1/2/3: amount + reference must approve despite a different typed number and a masked receiving account (got % / % / %)',
      _row.status, _row.approval_method, public.cash_in_auth_blockers(_row.id);
  end if;

  ---------------------------------------------------------------------- 4
  -- The cash in is submitted FIRST; the notification arrives afterwards.
  _ref := 'IND-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  _row := public.request_cash_in(_method, 640, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/ind-2.jpg', _typed, null, now(),
                                 jsonb_build_object('provider_name', 'GCash'));
  perform public.apply_cash_in_receipt_ocr(_row.id, _ref, 640, _typed, true, null,
                                           now(), _acct, 'GCash', null, null, null, repeat('2', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'pending' then
    raise exception '4: with no notification yet the cash in must wait (got %)', _row.status;
  end if;

  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number_key, gcash_reference, posted_at, created_at,
                                      outcome, details)
  values (_dev, 'evt-ind-2', 'com.globe.gcash.android', 640,
          public.normalize_ph_mobile(_typed), _ref, now(), now(), 'accepted',
          jsonb_build_object('receiving_account', _acct))
  returning id into _evt;
  perform public.match_listener_event(_evt);

  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'approved' then
    raise exception '4: a notification arriving after the request must still settle it (got % / %)',
      _row.status, public.cash_in_auth_blockers(_row.id);
  end if;

  ---------------------------------------------------------------------- 5
  -- Only the amount agrees: different sender, no reference on the notification.
  _ref := 'IND-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      sender_number_key, posted_at, created_at, outcome, details)
  values (_dev, 'evt-ind-3', 'com.globe.gcash.android', 310,
          public.normalize_ph_mobile(_other), now(), now(), 'accepted',
          jsonb_build_object('receiving_account', _acct));
  _row := public.request_cash_in(_method, 310, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/ind-3.jpg', _typed, null, now(),
                                 jsonb_build_object('provider_name', 'GCash'));
  perform public.apply_cash_in_receipt_ocr(_row.id, _ref, 310, _typed, true, null,
                                           now(), _acct, 'GCash', null, null, null, repeat('3', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'pending' then
    raise exception '5: one agreeing fact must stay pending for a person (got %)', _row.status;
  end if;

  ---------------------------------------------------------------------- 6
  -- The reference that already settled case 1 can never credit again.
  begin
    _row := public.request_cash_in(_method, 750,
                                   (select payer_reference from public.cash_in_requests
                                     where proof_path = _uid::text || '/ind-1.jpg'),
                                   null, gen_random_uuid()::text, _uid::text || '/ind-4.jpg',
                                   _typed, null, now(), jsonb_build_object('provider_name', 'GCash'));
    if _row.status = 'approved' then
      raise exception '6: a reference that already credited must never credit again';
    end if;
  exception when others then
    if sqlerrm not ilike '%already%' then raise; end if;
  end;

  raise notice 'two independent facts settle a cash in in either arrival order';
end $$;

rollback;
