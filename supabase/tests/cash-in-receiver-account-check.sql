-- Cash In: mandatory receiving-account protection layer.
--
-- The expected account is the RECEIVER (payee) account saved by the responsible
-- Admin / Super Admin: payment_methods.account_number for the method chosen on
-- the request (platform methods for Universe, the shop's own methods for a shop
-- cash in) or the shop's legacy cash_in_gcash_number. Only receiver-side fields
-- are compared: the receipt's "Sent to / Paid to" and the notification's
-- "Received by". The payer's own account is never treated as the receiver.
--
-- Rolled back at the end: nothing is kept.
--
--   1. correct account on the receipt only + 2 matches           => approved once
--   2. correct account on the notification only + 2 matches      => approved once
--   3. wrong receiver account on the receipt                     => disapproved, no credit
--   4. wrong receiver account on the notification                => disapproved, no credit
--   5. payer's own account differs and is labelled as sender      => approved (not falsely disapproved)
--   6. "Sent to" on the receipt = "Received by" on the notification => matched on both
--   7. duplicate of an already-credited payment                  => disapproved, no second credit
--   8. no receiving-account evidence on either source            => manual review, not approved
--   9. Universe expected account = platform saved method;
--      shop expected account = that shop's own saved method; the platform
--      account on a shop receipt is a mismatch and shop wallets stay untouched
begin;

do $$
declare _uid uuid; _eco uuid; _super uuid; _gcash uuid; _dev uuid; _shop_dev uuid; _reg jsonb; _shop_method uuid;
        _row public.cash_in_requests; _second public.cash_in_requests; _ev uuid; _res text; _ref text;
        _global uuid; _g0 numeric; _g1 numeric; _shop0 numeric; _shop1 numeric; _acct text; _tail text; _x jsonb;
        _wrong_tail text; _shop_num constant text := '09181110000';
        _sender constant text := '09171234567';
begin
  select p.id into _super from public.profiles p where public.is_super_admin(p.id) and p.status = 'active' limit 1;
  select p.id, p.ecosystem_id into _uid, _eco from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) and p.ecosystem_id is not null
     and coalesce(p.is_demo, false) = false limit 1;
  if _uid is null or _super is null then raise notice 'skipped: no member / super admin'; return; end if;

  update public.listener_devices set status = 'revoked' where status <> 'revoked';
  select id, account_number into _gcash, _acct from public.payment_methods
   where ecosystem_id is null and active and method_type = 'ewallet' limit 1;
  if _gcash is null then
    insert into public.payment_methods (ecosystem_id, name, method_type, account_number, account_name, active, sort_order)
    values (null, 'GCash test', 'ewallet', '09541230072', 'WaveWallet', true, 1) returning id, account_number into _gcash, _acct;
  end if;
  _tail := right(regexp_replace(_acct, '[^0-9]', '', 'g'), 4);
  _wrong_tail := case when _tail = '9999' then '8888' else '9999' end;

  perform set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  _reg := public.register_listener_device('Platform phone', null, 60, 30, 'com.globe.gcash.android', null);
  _dev := (_reg->>'device_id')::uuid;
  update public.listener_devices set status = 'active', last_seen_at = now(), last_event_at = now() where id = _dev;
  delete from public.cash_in_auto_rules where ecosystem_id is null;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match, amount_tolerance_php,
                                         expected_amount_php, max_auto_amount_php, require_listener_match)
  values (null, true, true, 0, null, 10000, true);

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  select ca.id, ca.balance into _global, _g0 from public.credit_accounts ca where ca.user_id = _uid and ca.ecosystem_id is null;
  select coalesce(sum(balance), 0) into _shop0 from public.credit_accounts where user_id = _uid and ecosystem_id is not null;

  -- 1) Receipt shows "Sent to ****<tail>"; notification has no receiving info. ref + sender agree.
  _ref := 'RA1' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  perform public.record_listener_event(_dev, 'ra-evt-1', 'com.globe.gcash.android',
      'You have received PHP 500.00 of GCash from ' || _sender || '. Ref. No. ' || _ref,
      500, _sender, null, now() - interval '2 minutes', 'v2', _ref, 'gcash', 'GCash',
      jsonb_build_object('viewpoint', 'receiver'));
  _row := public.request_cash_in(_gcash, 500, null, null, gen_random_uuid()::text, _uid::text || '/ra1.jpg', _sender, 'platform',
                                 now() - interval '2 minutes', null, 'universe');
  _res := public.apply_cash_in_receipt_ocr(_row.id, _ref, 500, _sender, true,
            jsonb_build_object('viewpoint', 'sender', 'fields', jsonb_build_object('Sent to', 'WA**E W. ****' || _tail)),
            now() - interval '2 minutes', null, 'GCash', null, null, '****' || _tail, repeat('a', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'approved' then
    raise exception '1: correct account on receipt only + 2 matches must approve (got % / %)', _row.status, public.cash_in_auth_blockers(_row.id);
  end if;
  select balance into _g1 from public.credit_accounts where id = _global;
  if _g1 - _g0 <> _row.credits then raise exception '1: credited exactly once'; end if;
  _g0 := _g1;

  -- 2) Notification shows "Received by ****<tail>"; receipt has no receiving field. ref + sender agree.
  _ref := 'RA2' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  perform public.record_listener_event(_dev, 'ra-evt-2', 'com.globe.gcash.android',
      'You have received PHP 600.00 from ' || _sender || '. Ref. No. ' || _ref || '. Received by ****' || _tail,
      600, _sender, null, now() - interval '2 minutes', 'v2', _ref, 'gcash', 'GCash',
      jsonb_build_object('viewpoint', 'receiver', 'receiving_account', '****' || _tail));
  _row := public.request_cash_in(_gcash, 600, null, null, gen_random_uuid()::text, _uid::text || '/ra2.jpg', _sender, 'platform',
                                 now() - interval '2 minutes', null, 'universe');
  perform public.apply_cash_in_receipt_ocr(_row.id, _ref, 600, _sender, true, null,
            now() - interval '2 minutes', null, 'GCash', null, null, null, repeat('b', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'approved' then
    raise exception '2: correct account on notification only + 2 matches must approve (got % / %)', _row.status, public.cash_in_auth_blockers(_row.id);
  end if;
  select balance into _g1 from public.credit_accounts where id = _global;
  if _g1 - _g0 <> _row.credits then raise exception '2: credited exactly once'; end if;
  _g0 := _g1;

  -- 3) Wrong receiver account on the receipt => disapproved, no credit.
  _ref := 'RA3' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  perform public.record_listener_event(_dev, 'ra-evt-3', 'com.globe.gcash.android',
      'You have received PHP 700.00 from ' || _sender || '. Ref. No. ' || _ref,
      700, _sender, null, now() - interval '2 minutes', 'v2', _ref, 'gcash', 'GCash', null);
  _row := public.request_cash_in(_gcash, 700, null, null, gen_random_uuid()::text, _uid::text || '/ra3.jpg', _sender, 'platform',
                                 now() - interval '2 minutes', null, 'universe');
  _res := public.apply_cash_in_receipt_ocr(_row.id, _ref, 700, _sender, true, null,
            now() - interval '2 minutes', null, 'GCash', null, null, '****' || _wrong_tail, repeat('c', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'rejected' or _res <> 'receiving_mismatch_rejected' then
    raise exception '3: wrong receiver account on receipt must be disapproved (got % / %)', _row.status, _res;
  end if;
  if (select balance from public.credit_accounts where id = _global) <> _g0 then raise exception '3: no credit'; end if;
  if not exists (select 1 from public.payment_match_records where cash_in_id = _row.id and decision = 'receiver_mismatch_rejected') then
    raise exception '3: receiver mismatch must be recorded';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'Disapproved cash in: receiving account mismatch'
                   and (metadata->>'cash_in_id')::uuid = _row.id) then
    raise exception '3: receiver mismatch must be audited';
  end if;

  -- 4) Wrong receiver account on the notification (receipt silent) => disapproved, no credit.
  _ref := 'RA4' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  perform public.record_listener_event(_dev, 'ra-evt-4', 'com.globe.gcash.android',
      'You have received PHP 750.00 from ' || _sender || '. Ref. No. ' || _ref || '. Received by ****' || _wrong_tail,
      750, _sender, null, now() - interval '2 minutes', 'v2', _ref, 'gcash', 'GCash',
      jsonb_build_object('receiving_account', '****' || _wrong_tail));
  _row := public.request_cash_in(_gcash, 750, null, null, gen_random_uuid()::text, _uid::text || '/ra4.jpg', _sender, 'platform',
                                 now() - interval '2 minutes', null, 'universe');
  _res := public.apply_cash_in_receipt_ocr(_row.id, _ref, 750, _sender, true, null,
            now() - interval '2 minutes', null, 'GCash', null, null, null, repeat('d', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'rejected' then
    raise exception '4: wrong receiver account on notification must be disapproved (got % / %)', _row.status, _res;
  end if;
  if (select balance from public.credit_accounts where id = _global) <> _g0 then raise exception '4: no credit'; end if;

  -- 5) Payer's own account ("Paid from ****4567") differs from the receiver and is correctly
  --    labelled as sender; receiver on receipt is correct => must approve.
  _ref := 'RA5' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  perform public.record_listener_event(_dev, 'ra-evt-5', 'com.globe.gcash.android',
      'You have received PHP 800.00 from ' || _sender || '. Ref. No. ' || _ref,
      800, _sender, null, now() - interval '2 minutes', 'v2', _ref, 'gcash', 'GCash', null);
  _row := public.request_cash_in(_gcash, 800, null, null, gen_random_uuid()::text, _uid::text || '/ra5.jpg', _sender, 'platform',
                                 now() - interval '2 minutes', null, 'universe');
  perform public.apply_cash_in_receipt_ocr(_row.id, _ref, 800, _sender, true,
            jsonb_build_object('fields', jsonb_build_object('Paid from', '****4567', 'Sent to', '****' || _tail)),
            now() - interval '2 minutes', null, 'GCash', null, '****4567', '****' || _tail, repeat('e', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'approved' then
    raise exception '5: a differing SENDER account must not be mistaken for the receiver (got % / %)', _row.status, public.cash_in_auth_blockers(_row.id);
  end if;
  select balance into _g1 from public.credit_accounts where id = _global;
  if _g1 - _g0 <> _row.credits then raise exception '5: credited exactly once'; end if;
  _g0 := _g1;

  -- 6) "Sent to" on the receipt and "Received by" on the notification both name the account.
  _ref := 'RA6' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  perform public.record_listener_event(_dev, 'ra-evt-6', 'com.globe.gcash.android',
      'You have received PHP 850.00. Ref. No. ' || _ref || '. Received by ****' || _tail,
      850, null, null, now() - interval '2 minutes', 'v2', _ref, 'gcash', 'GCash',
      jsonb_build_object('receiving_account', '****' || _tail));
  _row := public.request_cash_in(_gcash, 850, null, null, gen_random_uuid()::text, _uid::text || '/ra6.jpg', _sender, 'platform',
                                 now() - interval '2 minutes', null, 'universe');
  perform public.apply_cash_in_receipt_ocr(_row.id, _ref, 850, _sender, true,
            jsonb_build_object('fields', jsonb_build_object('Sent to', 'WA**E W. ****' || _tail)),
            now() - interval '2 minutes', null, 'GCash', null, null, '****' || _tail, repeat('f', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'approved' then
    raise exception '6: Sent to = Received by must be valid (got % / %)', _row.status, public.cash_in_auth_blockers(_row.id);
  end if;
  _x := public.cash_in_receiver_account_check(_row, (select e from public.listener_events e where e.id = _row.listener_event_id));
  if _x->>'status' <> 'matched' or _x->>'matched_source' <> 'both' then
    raise exception '6: both sides must match the configured receiver (got %)', _x;
  end if;
  select balance into _g1 from public.credit_accounts where id = _global;
  if _g1 - _g0 <> _row.credits then raise exception '6: credited exactly once'; end if;
  _g0 := _g1;

  -- 7) Duplicate of the credited payment from step 6 (same reference, correct account) => disapproved.
  _second := public.request_cash_in(_gcash, 850, null, null, gen_random_uuid()::text, _uid::text || '/ra7.jpg', _sender, 'platform',
                                    now() - interval '2 minutes', null, 'universe');
  _res := public.apply_cash_in_receipt_ocr(_second.id, _ref, 850, _sender, true, null,
            now() - interval '2 minutes', null, 'GCash', null, null, '****' || _tail, repeat('1', 64));
  select * into _second from public.cash_in_requests where id = _second.id;
  if _second.status <> 'rejected' or _res <> 'duplicate_credited' then
    raise exception '7: duplicate already credited must be disapproved (got % / %)', _second.status, _res;
  end if;
  if (select balance from public.credit_accounts where id = _global) <> _g0 then raise exception '7: no second credit'; end if;

  -- 8) No receiving-account evidence anywhere, otherwise 2 matches => manual review, NOT approved.
  _ref := 'RA8' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  perform public.record_listener_event(_dev, 'ra-evt-8', 'com.globe.gcash.android',
      'You have received PHP 900.00 from ' || _sender || '. Ref. No. ' || _ref,
      900, _sender, null, now() - interval '2 minutes', 'v2', _ref, 'gcash', 'GCash', null);
  _row := public.request_cash_in(_gcash, 900, null, null, gen_random_uuid()::text, _uid::text || '/ra8.jpg', _sender, 'platform',
                                 now() - interval '2 minutes', null, 'universe');
  perform public.apply_cash_in_receipt_ocr(_row.id, _ref, 900, _sender, true, null,
            now() - interval '2 minutes', null, 'GCash', null, null, null, repeat('2', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'pending' then
    raise exception '8: without receiver-account evidence the request must wait for manual review (got %)', _row.status;
  end if;
  if not ('no_receiving_evidence' = any(public.cash_in_auth_blockers(_row.id))) then
    raise exception '8: blocker must name the missing receiver evidence (got %)', public.cash_in_auth_blockers(_row.id);
  end if;
  if (select balance from public.credit_accounts where id = _global) <> _g0 then raise exception '8: no credit'; end if;
  -- Super Admin explanation carries the check.
  perform set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  _x := public.cash_in_match_explanation(_row.id);
  if _x->'receiver_account_check'->>'status' <> 'absent' then raise exception '8: explanation must show the receiver check'; end if;
  if _x->'receiver_account_check'->'expected'->0->>'masked' <> '····' || _tail then raise exception '8: expected account shown masked'; end if;

  -- 9) Universe expected account = platform saved method. Shop uses its own saved method.
  if not exists (select 1 from public.cash_in_expected_receiving_accounts(_row) a where a.source = 'method' and a.account = _acct) then
    raise exception '9: Universe must use the platform saved receiving details';
  end if;
  insert into public.payment_methods (ecosystem_id, name, method_type, account_number, account_name, active, sort_order)
  values (_eco, 'Shop GCash', 'ewallet', _shop_num, 'Shop Owner', true, 1) returning id into _shop_method;
  insert into public.listener_devices (label, owner_role, ecosystem_id, secret_key_hash, status, last_seen_at)
  values ('shop phone', 'admin', _eco, repeat('9', 64), 'active', now()) returning id into _shop_dev;
  delete from public.cash_in_auto_rules where ecosystem_id = _eco;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, amount_tolerance_php, require_listener_match, require_receipt_match, verification_mode)
  values (_eco, true, 0, true, false, 'active');
  _ref := 'RA9' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.cash_in_requests (user_id, ecosystem_id, method_id, method_name, method_type,
                                       amount_php, credits, rate_php, rate_credits, net_php,
                                       status, requester_name, sender_number, sender_number_key,
                                       payer_reference, payer_reference_key, proof_path)
  values (_uid, _eco, _shop_method, 'Shop GCash', 'ewallet', 250, 250, 1000, 1000, 250,
          'pending', 'Test Member', _sender, public.normalize_ph_mobile(_sender), _ref, _ref, 'proof9.jpg')
  returning * into _row;
  if exists (select 1 from public.cash_in_expected_receiving_accounts(_row) a where a.account = _acct)
     or not exists (select 1 from public.cash_in_expected_receiving_accounts(_row) a where a.account = _shop_num) then
    raise exception '9: shop cash in must use only that shop''s saved receiving details';
  end if;
  insert into public.listener_events (device_id, outcome, amount_php, sender_number, sender_number_key, posted_at, raw_text, reference_key, gcash_reference)
  values (_shop_dev, 'accepted', 250, _sender, public.normalize_ph_mobile(_sender), now(), 'shop pay', _ref, _ref);
  -- Receipt names the PLATFORM account: wrong receiver for a shop cash in.
  _res := public.apply_cash_in_receipt_ocr(_row.id, _ref, 250, _sender, true, null, now(), null, 'GCash', null, null, '****' || _tail, repeat('3', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'rejected' then
    raise exception '9: platform account on a shop receipt must be disapproved (got % / %)', _row.status, _res;
  end if;
  select coalesce(sum(balance), 0) into _shop1 from public.credit_accounts where user_id = _uid and ecosystem_id is not null;
  if _shop1 <> _shop0 then raise exception '9: shop wallets must be untouched'; end if;
  if (select balance from public.credit_accounts where id = _global) <> _g0 then raise exception '9: universe wallet untouched by shop flow'; end if;

  raise notice 'receiver-account protection layer holds';
end $$;

rollback;
