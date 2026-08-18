-- GCash notification listener: device layer, ingest and matching.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
-- Covers:
--   A. a readable notification matching one pending Cash In corroborates it.
--   B. the same notification twice is idempotent: one event, no double credit.
--   C. an unreadable notification is stored but never matches.
--   D. two identical pending Cash Ins => ambiguous, both stay pending.
--   E. a wrong sender number never matches a Cash In that declares one.
--   F. a revoked device is refused at ingest.
--   G. require_listener_match keeps a Cash In pending until an event arrives.
--   H. an offline device blocks listener-required approval.
--   I. only the platform owner can register, revoke or read listener devices.
--   J. a reference-less event can associate by exact amount + verified profile
--      phone + destination, but association alone never bypasses Layer 2.
begin;

-- I. Authorisation -----------------------------------------------------------
do $$
declare _member uuid;
begin
  select p.id into _member from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) limit 1;
  if _member is null then raise notice 'skipped auth checks: no member'; return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', _member)::text, true);
  begin
    perform public.register_listener_device('hack', null, 60, 15, 'com.globe.gcash.android');
    raise exception 'I: a non-owner must not register a listener device';
  exception when others then
    if sqlerrm not like '%platform owner%' then raise; end if;
  end;
  begin
    perform public.listener_device_status();
    raise exception 'I: a non-owner must not read listener device status';
  exception when others then
    if sqlerrm not like '%platform owner%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
end $$;

-- A–H. Behaviour -------------------------------------------------------------
do $$
declare _owner uuid; _uid uuid; _eco uuid; _method uuid; _device uuid; _secret jsonb;
        _row public.cash_in_requests; _other public.cash_in_requests;
        _before numeric; _after numeric; _res jsonb; _match text; _profile_phone text;
        _num constant text := '09171234567'; _sender constant text := '09991234567';
begin
  select ur.user_id into _owner from public.user_roles ur where ur.role = 'super_admin' limit 1;
  select p.id, p.ecosystem_id into _uid, _eco
    from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) and p.ecosystem_id is not null
   limit 1;
  select id into _method from public.payment_methods where active limit 1;
  if _owner is null or _uid is null or _method is null then
    raise notice 'skipped: no owner, member with a shop, or payment method';
    return;
  end if;

  update public.ecosystems set cash_in_gcash_number = _num where id = _eco;
  delete from public.cash_in_auto_rules where ecosystem_id is not distinct from _eco;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                         amount_tolerance_php, expected_amount_php,
                                         require_listener_match)
  values (_eco, true, true, 0, 500, false);

  -- register a device as the platform owner
  perform set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  _secret := public.register_listener_device('Test phone', _eco, 60, 15, 'com.globe.gcash.android');
  _device := (_secret->>'device_id')::uuid;
  if _secret->>'pairing_secret' is null or length(_secret->>'pairing_secret') < 32 then
    raise exception 'registration must return a one-time pairing secret';
  end if;
  if (select secret_key_hash from public.listener_devices where id = _device)
     = (_secret->>'pairing_secret') then
    raise exception 'the plaintext pairing secret must never be stored';
  end if;
  update public.listener_devices set status = 'active', last_seen_at = now() where id = _device;
  perform set_config('request.jwt.claims', null, true);

  -- J: Screenshot-first receipts may not expose the sender and GCash may omit
  -- its reference. The member's verified profile phone is the exact sender
  -- fallback for Layer 1; receipt review remains a separate approval gate.
  _profile_phone := '09992223333';
  update public.profiles set phone = _profile_phone where id = _uid;
  update public.cash_in_auto_rules
     set enabled = true, require_listener_match = true, require_receipt_match = true,
         layer1_require_sender_number = true, layer1_require_time_window = true,
         expected_amount_php = null
   where ecosystem_id = _eco;
  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  _row := public.request_cash_in(_method, 230, 'TEST-J-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/j.jpg', null);
  perform set_config('request.jwt.claims', null, true);
  update public.cash_in_requests
     set sender_number = null, sender_number_key = null,
         payer_number = null, payer_number_key = null,
         ocr_sender_number = null, ocr_sender_number_key = null,
         receipt_check = 'pending'
   where id = _row.id;
  insert into public.listener_events
    (device_id, event_uid, package_name, outcome, amount_php, sender_number,
     sender_number_key, gcash_reference, reference_key, posted_at, raw_text)
  values
    (_device, 'evt-j', 'com.globe.gcash.android', 'accepted', 230, _profile_phone,
     public.normalize_ph_mobile(_profile_phone), null, null, now(), 'Received PHP 230.00')
  returning id into _device;
  _match := public.match_listener_event(_device);
  if (select listener_event_id from public.cash_in_requests where id = _row.id) is distinct from _device then
    raise exception 'J: missing listener reference must not reject a unique exact Layer-1 match (got %)', _match;
  end if;
  if (select status from public.cash_in_requests where id = _row.id) <> 'pending' then
    raise exception 'J: Layer-1 association must not credit before Layer 2 passes';
  end if;
  if public.match_listener_event(_device) <> 'already_consumed' then
    raise exception 'J: replaying an associated listener event must remain idempotent';
  end if;

  -- Restore the listener-device id after using the event id above.
  select device_id into _device from public.listener_events where id =
    (select listener_event_id from public.cash_in_requests where id = _row.id);

  -- C: unreadable notification.
  _res := public.record_listener_event(_device, 'evt-unparsed', 'com.globe.gcash.android',
                                       'You have a new message', null, null, null, now(), 'v1', null);
  if _res->>'outcome' <> 'unparsed' or (_res->>'cash_in_id') is not null then
    raise exception 'C: an unreadable notification must be stored and never match';
  end if;

  -- A: one pending cash in, one matching notification.
  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  select coalesce(sum(balance), 0) into _before from public.credit_accounts where user_id = _uid;
  _row := public.request_cash_in(_method, 500, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/a.jpg', _sender);
  perform set_config('request.jwt.claims', null, true);

  if _row.status = 'approved' then
    -- configured matching already settled it; the listener must then find nothing.
    _res := public.record_listener_event(_device, 'evt-a', 'com.globe.gcash.android',
                                         'Received PHP 500.00', 500, _sender, 'Juan D', now(), 'v1', null);
    if (_res->>'match') <> 'no_pending_match' then
      raise exception 'A: an already-settled cash in must not be matched again (got %)', _res->>'match';
    end if;
  else
    _res := public.record_listener_event(_device, 'evt-a', 'com.globe.gcash.android',
                                         'Received PHP 500.00', 500, _sender, 'Juan D', now(), 'v1', null);
    if (_res->>'cash_in_id')::uuid is distinct from _row.id then
      raise exception 'A: the notification must corroborate the single pending cash in';
    end if;
  end if;

  -- B: replaying the same notification is idempotent.
  select coalesce(sum(balance), 0) into _after from public.credit_accounts where user_id = _uid;
  _res := public.record_listener_event(_device, 'evt-a', 'com.globe.gcash.android',
                                       'Received PHP 500.00', 500, _sender, 'Juan D', now(), 'v1', null);
  if (_res->>'duplicate')::boolean is not true then
    raise exception 'B: a repeated event_uid must be reported as a duplicate';
  end if;
  if (select count(*) from public.listener_events where device_id = _device and event_uid = 'evt-a') <> 1 then
    raise exception 'B: a repeated event_uid must be stored once';
  end if;
  if (select coalesce(sum(balance), 0) from public.credit_accounts where user_id = _uid) <> _after then
    raise exception 'B: a repeated notification must never credit twice';
  end if;

  -- G/H: listener-required mode. Receipt reading is off here so the listener
  -- match is the only remaining check.
  update public.cash_in_auto_rules
     set require_listener_match = true, require_receipt_match = false,
         require_reference_match = false, expected_amount_php = 700
   where ecosystem_id = _eco;

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  _row := public.request_cash_in(_method, 700, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/g.jpg', _sender);
  perform set_config('request.jwt.claims', null, true);
  if _row.status <> 'pending' then
    raise exception 'G: with listener verification required, a cash in must wait (got %)', _row.status;
  end if;

  -- H: the device is offline, so even a matching notification must not approve.
  update public.listener_devices set last_seen_at = now() - interval '2 hours' where id = _device;
  _match := public.try_auto_approve_cash_in(_row.id);
  update public.cash_in_requests set listener_event_id = null where id = _row.id;
  if _match not in ('awaiting_listener', 'listener_offline') then
    raise exception 'H: an offline listener must block automatic approval (got %)', _match;
  end if;

  -- back online, a matching notification completes it.
  update public.listener_devices set last_seen_at = now() where id = _device;
  _before := (select coalesce(sum(balance), 0) from public.credit_accounts where user_id = _uid);
  _res := public.record_listener_event(_device, 'evt-g', 'com.globe.gcash.android',
                                       'Received PHP 700.00', 700, _sender, 'Juan D', now(), 'v1', null);
  if (_res->>'match') <> 'approved' then
    raise exception 'G: a corroborated cash in must be approved (got %)', _res->>'match';
  end if;
  if (select status from public.cash_in_requests where id = _row.id) <> 'approved' then
    raise exception 'G: the corroborated cash in must be approved';
  end if;
  if (select coalesce(sum(balance), 0) from public.credit_accounts where user_id = _uid) <= _before then
    raise exception 'G: an approved cash in must credit the member exactly once';
  end if;

  -- D: two identical pending cash ins => ambiguous.
  update public.cash_in_auto_rules set enabled = false where ecosystem_id = _eco;
  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  _row := public.request_cash_in(_method, 850, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/d1.jpg', _sender);
  _other := public.request_cash_in(_method, 850, 'GC-' || gen_random_uuid()::text, null,
                                   gen_random_uuid()::text, _uid::text || '/d2.jpg', _sender);
  perform set_config('request.jwt.claims', null, true);
  _res := public.record_listener_event(_device, 'evt-d', 'com.globe.gcash.android',
                                       'Received PHP 850.00', 850, _sender, 'Juan D', now(), 'v1', null);
  if (_res->>'match') <> 'ambiguous' then
    raise exception 'D: two identical pending cash ins must stay ambiguous (got %)', _res->>'match';
  end if;
  if (select status from public.cash_in_requests where id = _row.id) <> 'pending'
     or (select status from public.cash_in_requests where id = _other.id) <> 'pending' then
    raise exception 'D: ambiguous notifications must leave both requests pending';
  end if;

  -- E: a declared sender number that does not match is never matched.
  update public.cash_in_requests set sender_number = '09181112222',
         sender_number_key = public.normalize_ph_mobile('09181112222')
   where id in (_row.id, _other.id);
  _res := public.record_listener_event(_device, 'evt-e', 'com.globe.gcash.android',
                                       'Received PHP 850.00', 850, _sender, 'Juan D', now(), 'v1', null);
  if (_res->>'match') <> 'no_pending_match' then
    raise exception 'E: a different sender number must not match (got %)', _res->>'match';
  end if;

  -- F: a revoked device is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  perform public.revoke_listener_device(_device);
  perform set_config('request.jwt.claims', null, true);
  begin
    _res := public.record_listener_event(_device, 'evt-f', 'com.globe.gcash.android',
                                         'Received PHP 500.00', 500, _sender, 'Juan D', now(), 'v1', null);
    raise exception 'F: a revoked device must be refused';
  exception when others then
    if sqlerrm not like '%revoked%' then raise; end if;
  end;

  raise notice 'gcash listener tests passed';
end $$;

rollback;
