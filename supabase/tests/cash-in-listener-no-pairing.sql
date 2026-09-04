-- Payment listener: no per-account pairing, two-signal candidate rule,
-- duplicate-credited disapproval, idempotent crediting.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
--
--   1) a platform phone registers WITHOUT a receiving GCash/MariBank number
--   2) receipt + notification with exactly 2 independent matches => approved (credited once)
--   3) only 1 match (amount) => stays pending for manual review
--   4) no match => stays pending (no_pending_match), nothing credited
--   5) blurry/unreadable receipt => stays pending for manual review
--   6) duplicate receipt image already CREDITED => disapproved, no second credit
--   7) duplicate receipt image only PENDING => verification continues
--   8) repeated (replayed) listener notification cannot double-credit
--   9) two receiving accounts (GCash + bank) match through the same unpaired phone
--  10) Universe cash in credits the global Universe wallet only; shop wallets untouched
begin;

do $$
declare _uid uuid; _eco uuid; _gcash uuid; _bank uuid; _dev uuid; _row public.cash_in_requests;
        _second public.cash_in_requests; _reg jsonb; _ev uuid; _res text;
        _sender constant text := '09171234567';
        _hash constant text := repeat('a', 64);
        _ref text; _global uuid; _g0 numeric; _g1 numeric; _shop_total0 numeric; _shop_total1 numeric;
        _ledger_count int; _super uuid;
begin
  select p.id into _super from public.profiles p where public.is_super_admin(p.id) and p.status = 'active' limit 1;
  select p.id, p.ecosystem_id into _uid, _eco
    from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) and p.ecosystem_id is not null
     and coalesce(p.is_demo, false) = false
   limit 1;
  if _uid is null or _super is null then
    raise notice 'skipped: no active member / super admin'; return;
  end if;

  -- Platform receiving accounts: an e-wallet and a bank, no phone paired to either.
  -- Take existing platform phones out of the picture (rolled back at the end).
  update public.listener_devices set status = 'revoked' where ecosystem_id is null and status <> 'revoked';
  select id into _gcash from public.payment_methods where ecosystem_id is null and active and method_type = 'ewallet' limit 1;
  select id into _bank from public.payment_methods where ecosystem_id is null and active and method_type <> 'ewallet' limit 1;
  if _gcash is null then
    insert into public.payment_methods (ecosystem_id, name, method_type, account_number, account_name, active, sort_order)
    values (null, 'GCash test', 'ewallet', '09541230074', 'WaveWallet', true, 1) returning id into _gcash;
  end if;
  if _bank is null then
    insert into public.payment_methods (ecosystem_id, name, method_type, account_number, account_name, active, sort_order)
    values (null, 'MariBank test', 'bank', '09549998888', 'WaveWallet', true, 2) returning id into _bank;
  end if;

  -- 1) register as Super Admin with NO receiving number
  perform set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  _reg := public.register_listener_device('Platform phone', null, 60, 30, 'com.globe.gcash.android', null);
  _dev := (_reg->>'device_id')::uuid;
  if _dev is null or (_reg->>'receiving_number') is not null then
    raise exception '1: platform phone must register without a receiving number';
  end if;
  update public.listener_devices set status = 'active', last_seen_at = now(), last_event_at = now() where id = _dev;

  -- Platform rule: automatic approval needs a proven listener (the phone above).
  delete from public.cash_in_auto_rules where ecosystem_id is null;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match, amount_tolerance_php,
                                         expected_amount_php, max_auto_amount_php, require_listener_match)
  values (null, true, true, 0, null, 10000, true);

  if (select listener_watching from jsonb_to_record(public.platform_cash_in_readiness()) as r(listener_watching boolean)) is not true then
    raise exception '1: readiness must report the unpaired platform phone as watching';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  select ca.id, ca.balance into _global, _g0 from public.credit_accounts ca
   where ca.user_id = _uid and ca.ecosystem_id is null;
  select coalesce(sum(balance), 0) into _shop_total0 from public.credit_accounts where user_id = _uid and ecosystem_id is not null;

  -- 2) exactly two independent matches: amount + sending number (no reference on the notification)
  _ref := 'NP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.listener_events (device_id, event_uid, package_name, amount_php, sender_number_key, posted_at, created_at, outcome, provider_id)
  values (_dev, 'np-evt-2', 'com.globe.gcash.android', 700, public.normalize_ph_mobile(_sender), now() - interval '3 minutes', now(), 'accepted', 'gcash')
  returning id into _ev;
  _row := public.request_cash_in(_gcash, 700, _ref, null, gen_random_uuid()::text, _uid::text || '/np2.jpg', _sender, 'platform',
                                 now() - interval '3 minutes', jsonb_build_object('provider_name', 'GCash'), 'universe');
  -- The receipt is read (as the upload pipeline does): reference + amount + sender + image hash.
  _res := public.apply_cash_in_receipt_ocr(_row.id, _ref, 700, _sender, true, null, now() - interval '3 minutes',
                                           null, 'GCash', null, null, null, _hash);
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'approved' or _row.approval_method <> 'automatic' then
    raise exception '2: two independent matches must approve (got % / %)', _row.status, _row.approval_method;
  end if;
  if (select signal_count from public.payment_match_records where cash_in_id = _row.id and decision = 'auto_approved') < 2 then
    raise exception '2: match record must show >= 2 signals';
  end if;
  select count(*) into _ledger_count from public.credit_ledger where id = _row.ledger_id;
  if _ledger_count <> 1 then raise exception '2: exactly one ledger entry'; end if;

  -- 10) Universe cash in credited the global wallet only
  select balance into _g1 from public.credit_accounts where id = _global;
  select coalesce(sum(balance), 0) into _shop_total1 from public.credit_accounts where user_id = _uid and ecosystem_id is not null;
  if _g1 - _g0 <> _row.credits then raise exception '10: global wallet must gain exactly % (got %)', _row.credits, _g1 - _g0; end if;
  if _shop_total1 <> _shop_total0 then raise exception '10: shop wallets must be untouched'; end if;
  if _row.ecosystem_id is not null or _row.wallet_scope <> 'universe' then raise exception '10: universe request carries no shop'; end if;

  -- 8) replayed notification: same event_uid is idempotent and cannot credit again
  _res := (public.record_listener_event(_dev, 'np-evt-2', 'com.globe.gcash.android',
            'You have received PHP 700.00 of GCash from J** D. ' || _sender, 700, _sender, null, now(), 'v1', null, 'gcash', 'GCash'))->>'outcome';
  if (select count(*) from public.listener_events where device_id = _dev and event_uid = 'np-evt-2') <> 1 then
    raise exception '8: a replayed notification must not create a second event';
  end if;
  if (select count(*) from public.credit_ledger where id = _row.ledger_id) <> 1
     or (select balance from public.credit_accounts where id = _global) <> _g1 then
    raise exception '8: a replayed notification must never credit again';
  end if;

  -- 3) only one match (amount): stays pending
  insert into public.listener_events (device_id, event_uid, package_name, amount_php, posted_at, created_at, outcome, provider_id)
  values (_dev, 'np-evt-3', 'com.globe.gcash.android', 450, now() - interval '2 minutes', now(), 'accepted', 'gcash');
  _second := public.request_cash_in(_gcash, 450, 'NP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
                                    null, gen_random_uuid()::text, _uid::text || '/np3.jpg', '09995550000', 'platform',
                                    now() - interval '2 minutes', jsonb_build_object('provider_name', 'GCash'), 'universe');
  if _second.status <> 'pending' then raise exception '3: one matching detail must stay in manual review'; end if;

  -- 4) no match at all: stays pending, event unmatched
  _second := public.request_cash_in(_gcash, 333, 'NP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
                                    null, gen_random_uuid()::text, _uid::text || '/np4.jpg', '09990001111', 'platform',
                                    now(), jsonb_build_object('provider_name', 'GCash'), 'universe');
  if _second.status <> 'pending' or _second.listener_event_id is not null then
    raise exception '4: no match must stay pending without a linked notification';
  end if;

  -- 5) blurry receipt: unreadable => pending, reason says so
  _second := public.request_cash_in(_gcash, 500, null, null, gen_random_uuid()::text, _uid::text || '/np5.jpg', _sender, 'platform',
                                    now(), null, 'universe');
  _res := public.apply_cash_in_receipt_ocr(_second.id, null, null, null, false, null, null, null, 'GCash', null, null, null, repeat('b', 64));
  if _res <> 'unreadable' or (select status from public.cash_in_requests where id = _second.id) <> 'pending' then
    raise exception '5: an unreadable receipt must stay in manual review (got %)', _res;
  end if;
  if not ('receipt_unreadable' = any(public.cash_in_auth_blockers(_second.id))) then
    raise exception '5: blocker list must name the unreadable receipt';
  end if;

  -- 6) duplicate receipt image already CREDITED => disapproved automatically
  _second := public.request_cash_in(_gcash, 700, 'NP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
                                    null, gen_random_uuid()::text, _uid::text || '/np6.jpg', _sender, 'platform', now(), null, 'universe');
  _res := public.apply_cash_in_receipt_ocr(_second.id, 'NP-DUP-6', 700, _sender, true, null, now(), null, 'GCash', null, null, null, _hash);
  select * into _second from public.cash_in_requests where id = _second.id;
  if _res <> 'duplicate_credited' or _second.status <> 'rejected' or not _second.duplicate_receipt
     or _second.duplicate_receipt_of <> _row.id or _second.approval_method <> 'automatic' then
    raise exception '6: a credited duplicate receipt must be disapproved (got % / %)', _res, _second.status;
  end if;
  if (select balance from public.credit_accounts where id = _global) <> _g1 then raise exception '6: no second credit'; end if;
  if not exists (select 1 from public.audit_logs where action = 'Disapproved duplicate cash in' and (metadata->>'cash_in_id')::uuid = _second.id) then
    raise exception '6: disapproval must be audited';
  end if;

  -- 6b) duplicate reference already credited => disapproved too
  -- The existing submission guard refuses a credited reference outright (no request, no credit).
  begin
    _second := public.request_cash_in(_gcash, 700, _ref, null, gen_random_uuid()::text, _uid::text || '/np6b.jpg', _sender, 'platform', now(), null, 'universe');
    raise exception '6b: a credited duplicate reference must be refused (got %)', _second.status;
  exception when others then
    if sqlerrm not ilike '%already%' then raise; end if;
  end;
  if (select balance from public.credit_accounts where id = _global) <> _g1 then raise exception '6b: no second credit'; end if;

  -- 7) duplicate receipt image that is only PENDING => verification continues (not blocked)
  _row := public.request_cash_in(_gcash, 200, null, null, gen_random_uuid()::text, _uid::text || '/np7a.jpg', _sender, 'platform', now(), null, 'universe');
  perform public.apply_cash_in_receipt_ocr(_row.id, 'NP-7A', 200, _sender, true, null, now(), null, 'GCash', null, null, null, repeat('c', 64));
  _second := public.request_cash_in(_gcash, 200, null, null, gen_random_uuid()::text, _uid::text || '/np7b.jpg', _sender, 'platform', now(), null, 'universe');
  _res := public.apply_cash_in_receipt_ocr(_second.id, 'NP-7B', 200, _sender, true, null, now(), null, 'GCash', null, null, null, repeat('c', 64));
  select * into _second from public.cash_in_requests where id = _second.id;
  if _second.status <> 'pending' or coalesce(_second.duplicate_receipt, false) or _second.duplicate_receipt_of <> _row.id then
    raise exception '7: a pending duplicate must be recorded for review but keep verifying (got %)', _second.status;
  end if;
  if 'duplicate_reference' = any(public.cash_in_auth_blockers(_second.id)) then
    raise exception '7: a merely pending duplicate must not block verification';
  end if;

  -- 9) a bank-account payment (different provider) through the same unpaired phone:
  --    reference + sending number agree, matched with no account pairing at all.
  _ref := 'BK' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.listener_events (device_id, event_uid, package_name, amount_php, gcash_reference, reference_key, sender_number_key,
                                      posted_at, created_at, outcome, provider_id)
  values (_dev, 'np-evt-9', 'com.maribank.app', 1200, _ref, public.normalize_payment_reference(_ref), public.normalize_ph_mobile('09181112222'),
          now() - interval '1 minute', now(), 'accepted', 'maribank');
  _row := public.request_cash_in(_bank, 1200, _ref, null, gen_random_uuid()::text, _uid::text || '/np9.jpg', '09181112222', 'platform',
                                 now() - interval '1 minute', jsonb_build_object('provider_name', 'MariBank'), 'universe');
  perform public.apply_cash_in_receipt_ocr(_row.id, _ref, 1200, '09181112222', true, null, now() - interval '1 minute',
                                           null, 'MariBank', null, null, null, repeat('d', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.listener_event_id is null or _row.status <> 'approved' then
    raise exception '9: the bank notification must match and approve through the unpaired platform phone (got % / %)',
      _row.status, public.cash_in_auth_blockers(_row.id);
  end if;

  raise notice 'listener without account pairing: all rules hold';
end $$;

rollback;
