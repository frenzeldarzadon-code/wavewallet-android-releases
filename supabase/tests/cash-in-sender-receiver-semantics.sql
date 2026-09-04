-- Cash In: the receipt is the SENDER's view, the listener notification is the
-- RECEIVER's view of the same transfer. "Sent to X" on the receipt must be
-- compared with "Received by X" on the notification, and "Paid from Y" with
-- "Received from Y" — never treated as contradictions.
--
-- Rolled back at the end: nothing is kept.
--
--   1. reference + recipient account ("Sent to ····0072" vs "Received by ····0072")
--      => 2 independent matches, auto-approved once.
--   2. recipient account + amount only (no identity detail) => stays pending:
--      supporting details never lift a match on their own.
--   3. payer identity ("From Juan" vs "Received from Juan") + amount => approved.
--   4. Full receipt fields and full notification details are retained and the
--      explanation function shows both sides with labelled signals.
--   5. Duplicate fingerprint without a reference (same sender, amount, time
--      as a credited request) => disapproved, no second credit.
begin;

do $$
declare _uid uuid; _super uuid; _gcash uuid; _dev uuid; _reg jsonb; _row public.cash_in_requests;
        _second public.cash_in_requests; _ev uuid; _res text; _ref text; _global uuid; _g0 numeric; _g1 numeric;
        _acct text; _tail text; _x jsonb; _sig jsonb; _res_json jsonb;
        _sender constant text := '09171234567';
begin
  select p.id into _super from public.profiles p where public.is_super_admin(p.id) and p.status = 'active' limit 1;
  select p.id into _uid from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) and p.ecosystem_id is not null
     and coalesce(p.is_demo, false) = false limit 1;
  if _uid is null or _super is null then raise notice 'skipped: no member / super admin'; return; end if;

  update public.listener_devices set status = 'revoked' where ecosystem_id is null and status <> 'revoked';
  select id, account_number into _gcash, _acct from public.payment_methods
   where ecosystem_id is null and active and method_type = 'ewallet' limit 1;
  if _gcash is null then
    insert into public.payment_methods (ecosystem_id, name, method_type, account_number, account_name, active, sort_order)
    values (null, 'GCash test', 'ewallet', '09541230072', 'WaveWallet', true, 1) returning id, account_number into _gcash, _acct;
  end if;
  _tail := right(regexp_replace(_acct, '[^0-9]', '', 'g'), 4);

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

  -- 1) Reference + recipient account. The notification carries no sender number
  --    and no name, only "Received by ****<tail>" in its details.
  _ref := 'SR' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  _res_json := public.record_listener_event(_dev, 'sr-evt-1', 'com.globe.gcash.android',
      'You have received PHP 500.00 of GCash. Ref. No. ' || _ref || '. Received by ****' || _tail,
      500, null, null, now() - interval '2 minutes', 'v2', _ref, 'gcash', 'GCash',
      jsonb_build_object('viewpoint', 'receiver', 'receiving_account', '****' || _tail, 'balance_php', 9999.5,
                         'raw_text', 'You have received PHP 500.00 of GCash. Ref. No. ' || _ref));
  _ev := (_res_json->>'event_id')::uuid;
  if (select details->>'receiving_account' from public.listener_events where id = _ev) <> '****' || _tail then
    raise exception '1: notification details must be stored in full';
  end if;

  _row := public.request_cash_in(_gcash, 500, null, null, gen_random_uuid()::text, _uid::text || '/sr1.jpg', _sender, 'platform',
                                 now() - interval '2 minutes', null, 'universe');
  -- Receipt (sender view): "Sent to WA**E W. ****<tail>", ref, amount; the payer's own number is the submitted sender.
  _res := public.apply_cash_in_receipt_ocr(_row.id, _ref, 500, _sender, true,
            jsonb_build_object('viewpoint', 'sender', 'fields', jsonb_build_object('Sent to', 'WA**E W. ****' || _tail,
                               'Amount', '₱500.00', 'Ref No.', _ref, 'Total Amount Sent', '₱500.00')),
            now() - interval '2 minutes', null, 'GCash', null, null, '****' || _tail, repeat('e', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'approved' or _row.approval_method <> 'automatic' then
    raise exception '1: "Sent to" vs "Received by" + reference must approve (got % / %)', _row.status, public.cash_in_auth_blockers(_row.id);
  end if;
  _sig := public.listener_match_signal_details((select e from public.listener_events e where e.id = _ev), _row);
  if not exists (select 1 from jsonb_array_elements(_sig) x where x->>'signal' = 'recipient_account' and (x->>'agreed')::boolean) then
    raise exception '1: recipient account signal must agree';
  end if;
  if (select receipt_details->'fields'->>'Total Amount Sent' from public.cash_in_requests where id = _row.id) <> '₱500.00' then
    raise exception '1: full receipt fields must be retained';
  end if;
  select balance into _g1 from public.credit_accounts where id = _global;
  if _g1 - _g0 <> _row.credits then raise exception '1: credited exactly once'; end if;

  -- 2) Recipient account + amount only (no reference, no sender on the notification) => pending.
  _res_json := public.record_listener_event(_dev, 'sr-evt-2', 'com.globe.gcash.android',
      'You have received PHP 650.00 of GCash. Received by ****' || _tail, 650, null, null,
      now() - interval '1 minute', 'v2', null, 'gcash', 'GCash',
      jsonb_build_object('viewpoint', 'receiver', 'receiving_account', '****' || _tail));
  _second := public.request_cash_in(_gcash, 650, 'SR-NOREF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
                                    null, gen_random_uuid()::text, _uid::text || '/sr2.jpg', '09995550000', 'platform',
                                    now() - interval '1 minute', null, 'universe');
  perform public.apply_cash_in_receipt_ocr(_second.id, _second.payer_reference, 650, '09995550000', true, null,
            now() - interval '1 minute', null, 'GCash', null, null, '****' || _tail, repeat('f', 64));
  select * into _second from public.cash_in_requests where id = _second.id;
  if _second.status <> 'pending' then
    raise exception '2: amount + recipient alone must NOT approve (got %)', _second.status;
  end if;
  if _second.listener_event_id is not null
     and public.listener_match_signals((select e from public.listener_events e where e.id = _second.listener_event_id), _second) >= 2 then
    raise exception '2: supporting details must not count as two independent matches';
  end if;

  -- 3) "From Juan" on the receipt vs "Received from Juan" on the notification + amount => approved.
  _res_json := public.record_listener_event(_dev, 'sr-evt-3', 'com.globe.gcash.android',
      'You have received PHP 800.00 of GCash from JUAN D.', 800, null, 'JUAN D', now(), 'v2', null, 'gcash', 'GCash',
      jsonb_build_object('viewpoint', 'receiver', 'sender_name', 'JUAN D', 'receiving_account', '****' || _tail));
  _row := public.request_cash_in(_gcash, 800, 'SR3-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
                                 null, gen_random_uuid()::text, _uid::text || '/sr3.jpg', '09990001234', 'platform', now(), null, 'universe');
  perform public.apply_cash_in_receipt_ocr(_row.id, _row.payer_reference, 800, '09990001234', true,
            jsonb_build_object('viewpoint', 'sender', 'fields', jsonb_build_object('From', 'Juan D.', 'Sent to', 'WaveWallet')),
            now(), null, 'GCash', 'Juan D.', null, null, repeat('9', 64));
  select * into _row from public.cash_in_requests where id = _row.id;
  if _row.status <> 'approved' then
    raise exception '3: payer name (From vs Received from) + amount must approve (got % / %)', _row.status, public.cash_in_auth_blockers(_row.id);
  end if;

  -- 4) Explanation shows both viewpoints with labelled signals (as the platform owner).
  perform set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  _x := public.cash_in_match_explanation(_row.id);
  if _x->'viewpoints'->>'receipt' <> 'sender' or _x->'viewpoints'->>'notification' <> 'receiver' then
    raise exception '4: explanation must name the two viewpoints';
  end if;
  if _x->'notification'->>'raw_text' is null or _x->'receipt'->'details'->'fields' is null then
    raise exception '4: explanation must carry the full notification text and full receipt fields';
  end if;
  if not exists (select 1 from jsonb_array_elements(_x->'signals') s
                  where s->>'signal' = 'sender_account' and s->>'receipt_label' like 'Paid from%' and s->>'notification_label' = 'Received from') then
    raise exception '4: signals must be labelled from each side''s viewpoint';
  end if;
  -- A member who is not a reviewer cannot read it.
  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  begin
    _x := public.cash_in_match_explanation(_row.id);
    raise exception '4: a plain member must not read the explanation';
  exception when others then
    if sqlerrm not ilike '%platform owner%' then raise; end if;
  end;

  -- 5) Duplicate fingerprint without a reference: same sender, amount and time as request 3.
  select balance into _g1 from public.credit_accounts where id = _global;
  _second := public.request_cash_in(_gcash, 800, null, null, gen_random_uuid()::text, _uid::text || '/sr5.jpg', '09990001234', 'platform', now(), null, 'universe');
  _res := public.apply_cash_in_receipt_ocr(_second.id, null, 800, '09990001234', true, null, now(), null, 'GCash', 'Juan D.', null, null, repeat('8', 64));
  select * into _second from public.cash_in_requests where id = _second.id;
  if _second.status <> 'rejected' or _res not in ('duplicate_credited', 'not_pending') then
    raise exception '5: a credited payment with the same sender/amount/time must be disapproved even without a reference (got % / %)', _second.status, _res;
  end if;
  if (select balance from public.credit_accounts where id = _global) <> _g1 then raise exception '5: no second credit'; end if;

  raise notice 'sender-receipt vs receiver-notification semantics hold';
end $$;

rollback;
