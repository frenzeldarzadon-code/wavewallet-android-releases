-- Cash In: provider-agnostic matching (bank / non-GCash receipts).
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
--
-- Rules under test (none of them may weaken):
--   * a bank notification with no mobile number can still approve when the
--     masked account tail agrees with the receipt AND a second signal agrees;
--   * the amount alone is still never enough;
--   * the same screenshot may only ever settle one cash in.
begin;

do $$
declare _uid uuid; _eco uuid; _method uuid; _dev uuid; _row public.cash_in_requests;
        _second public.cash_in_requests; _rec public.payment_match_records;
        _recv constant text := '09541230073';
        _hash constant text := repeat('c', 64);
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
  values ('bank listener', _eco, repeat('d', 64), 'active', 'com.bpi.mobile',
          60, 30, now())
  returning id into _dev;

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  -- A. Bank transfer: reference + masked account tail agree, no mobile number.
  _ref := 'BPI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      reference, sender_account_masked, posted_at, created_at,
                                      outcome, provider_id)
  values (_dev, 'evt-bank-a', 'com.bpi.mobile', 1500, _ref, '****4321',
          now() - interval '10 minutes', now(), 'accepted', null);

  _row := public.request_cash_in(_method, 1500, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/bank-a.jpg', null, null,
                                 now() - interval '10 minutes',
                                 jsonb_build_object('provider_name', 'BPI',
                                                    'sender_account_masked', '****4321'));

  if _row.status <> 'approved' or _row.approval_method <> 'automatic' then
    raise exception 'A: a bank receipt with an agreeing reference and account tail must approve (got % / %)',
      _row.status, _row.approval_method;
  end if;

  select * into _rec from public.payment_match_records
   where cash_in_id = _row.id and decision = 'auto_approved';
  if _rec.id is null or _rec.signal_count < 2 then
    raise exception 'A: the match record must show >= 2 agreeing signals';
  end if;

  -- B. Same bank, amount only => stays pending.
  insert into public.listener_events (device_id, event_uid, package_name, amount_php,
                                      posted_at, created_at, outcome, provider_id)
  values (_dev, 'evt-bank-b', 'com.bpi.mobile', 1500,
          now() - interval '5 minutes', now(), 'accepted', null);

  _row := public.request_cash_in(_method, 1500, 'BPI-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/bank-b.jpg',
                                 null, null, now() - interval '5 minutes',
                                 jsonb_build_object('provider_name', 'BPI'));
  if _row.status <> 'pending' or _row.listener_event_id is not null then
    raise exception 'B: the amount alone must never approve a bank payment (got %)', _row.status;
  end if;

  -- C. The same screenshot may not settle a second cash in.
  _row := public.request_cash_in(_method, 200, 'RE-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/reuse-1.jpg',
                                 null, null, now());
  perform public.apply_cash_in_receipt_ocr(_row.id, 'RE-USED-1', 200, null, true, null,
                                           now(), null, 'BPI', null, null, null, _hash);

  _second := public.request_cash_in(_method, 200, 'RE-' || gen_random_uuid()::text, null,
                                    gen_random_uuid()::text, _uid::text || '/reuse-2.jpg',
                                    null, null, now());
  perform public.apply_cash_in_receipt_ocr(_second.id, 'RE-USED-2', 200, null, true, null,
                                           now(), null, 'BPI', null, null, null, _hash);

  if not (select duplicate_receipt from public.cash_in_requests where id = _second.id) then
    raise exception 'C: reusing the same screenshot must be flagged as a duplicate receipt';
  end if;
  if (select status from public.cash_in_requests where id = _second.id) <> 'pending' then
    raise exception 'C: a reused screenshot must never auto-approve a second cash in';
  end if;

  raise notice 'provider-agnostic bank matching rules hold';
end $$;

rollback;
