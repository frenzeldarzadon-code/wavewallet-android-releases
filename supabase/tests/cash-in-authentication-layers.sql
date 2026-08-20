-- Cash In: the two agreed authentication layers.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
--
-- LAYER 1 (GCash notification): sending number + amount only. No transaction
--   time, no reference number.
-- LAYER 2 (receipt): sender, receiving account, amount, reference, date/time.
-- DUPLICATE CHECK: reference + transaction date/time, searched across EVERY
--   shop. A hit holds the Cash In pending; it never credits.
--
-- Covers:
--   A. defaults: amount + sender number in layer 1; time and listener
--      reference are retired and cannot be switched on.
--   B. the amount requirement cannot be switched off.
--   C. duplicate-reference protection cannot be configured away.
--   D. listener-first ordering: an early payment waits, then links.
--   E. Cash-In-first ordering also links.
--   F. ambiguity is never resolved automatically.
--   G. an old notification still matches — time is not a factor at all.
--   H. a notification without a sender number can be accommodated by config.
--   I. only the platform owner may change the rules, and changes are audited.
--   J. the duplicate search spans all shops.
begin;

-- A. Defaults ----------------------------------------------------------------
do $$
declare _r record;
begin
  select * into _r from public.cash_in_auto_rule(null);
  if not _r.layer1_require_amount then raise exception 'A: amount must be required'; end if;
  if not _r.layer1_require_sender_number then raise exception 'A: sender number is a layer 1 default'; end if;
  if _r.layer1_require_time_window then raise exception 'A: time must never be a factor'; end if;
  if not _r.layer2_require_amount_match then raise exception 'A: layer 2 amount match is a default'; end if;
  if not _r.layer2_require_sender_match then raise exception 'A: layer 2 sender match is a default'; end if;
  if _r.layer2_require_listener_reference then
    raise exception 'A: the notification reference requirement must be retired';
  end if;

  -- Retired rules cannot be re-enabled, in the table or through the RPC.
  begin
    update public.cash_in_auto_rules set layer1_require_time_window = true where ecosystem_id is null;
    raise exception 'A: the time window must not be re-enablable';
  exception when check_violation then null;
  end;
  begin
    update public.cash_in_auto_rules set layer2_require_listener_reference = true where ecosystem_id is null;
    raise exception 'A: the listener reference rule must not be re-enablable';
  exception when check_violation then null;
  end;
end $$;

-- B. Amount can never be switched off ----------------------------------------
do $$
begin
  begin
    update public.cash_in_auto_rules set layer1_require_amount = false where ecosystem_id is null;
    raise exception 'B: the amount requirement must not be removable';
  exception when check_violation then null;
  end;
end $$;

-- C. Duplicate protection stays on -------------------------------------------
do $$
declare _def text;
begin
  _def := pg_get_functiondef('public.try_auto_approve_cash_in(uuid)'::regprocedure);
  if _def not like '%duplicate_reference%' then
    raise exception 'C: duplicate reference protection must remain unconditional';
  end if;
  if _def like '%layer%duplicate%' then
    raise exception 'C: duplicate protection must not depend on configuration';
  end if;
  -- The global search must not be scoped to a shop.
  _def := pg_get_functiondef('public.cash_in_reference_duplicate(uuid,text,timestamptz)'::regprocedure);
  if _def like '%ecosystem_id%' then
    raise exception 'C: the duplicate search must span every shop';
  end if;
end $$;

-- D/E/F/G/H. Matching behaviour ----------------------------------------------
do $$
declare _uid uuid; _eco uuid; _method uuid; _dev uuid; _ev uuid; _ev2 uuid;
        _row public.cash_in_requests; _res text; _num constant text := '09171234567';
        _sender constant text := '09991234567';
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

  update public.ecosystems set cash_in_gcash_number = _num where id = _eco;
  delete from public.cash_in_auto_rules where ecosystem_id is not distinct from _eco;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                         amount_tolerance_php, require_listener_match,
                                         require_receipt_match, verification_mode)
  values (_eco, true, true, 0, true, false, 'active');

  insert into public.listener_devices (label, status, package_name, receiving_number,
                                       receiving_number_key, match_window_minutes,
                                       offline_after_minutes, last_seen_at, pairing_secret_hash)
  values ('test phone', 'active', 'com.globe.gcash.android', _num,
          public.normalize_ph_mobile(_num), 60, 15, now(), 'x')
  returning id into _dev;

  -- D. Listener first: the payment arrives before the request.
  insert into public.listener_events (device_id, outcome, amount_php, sender_number,
                                      sender_number_key, posted_at, raw_text)
  values (_dev, 'accepted', 250, _sender, public.normalize_ph_mobile(_sender),
          now() - interval '3 days', 'test')
  returning id into _ev;

  _res := public.match_listener_event(_ev);
  if _res <> 'no_pending_match' then
    raise exception 'D: an early payment must wait safely (got %)', _res;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  _row := public.request_cash_in(_method, 250, 'AUTH-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/d.jpg', _sender);
  -- G. The notification is three days old; time is never a factor.
  if public.link_cash_in_listener_event(_row.id) <> 'linked' then
    raise exception 'G: an older payment must still match — time is not authentication';
  end if;

  -- F. Two identical payments must never be chosen between automatically.
  update public.cash_in_requests set listener_event_id = null where id = _row.id;
  update public.listener_events set consumed_cash_in_id = null, review_state = 'pending' where id = _ev;
  insert into public.listener_events (device_id, outcome, amount_php, sender_number,
                                      sender_number_key, posted_at, raw_text)
  values (_dev, 'accepted', 250, _sender, public.normalize_ph_mobile(_sender), now(), 'test 2')
  returning id into _ev2;
  if public.link_cash_in_listener_event(_row.id) <> 'ambiguous_event' then
    raise exception 'F: two possible payments must go to manual review';
  end if;
  delete from public.listener_events where id = _ev2;

  -- E. Cash-In first, then the payment: matching still finds it.
  if public.link_cash_in_listener_event(_row.id) <> 'linked' then
    raise exception 'E: the request must find the payment that already arrived';
  end if;

  -- H. A notification without a sender number: configuration alone adapts.
  update public.listener_events set sender_number = null, sender_number_key = null,
         consumed_cash_in_id = null where id = _ev;
  update public.cash_in_requests set listener_event_id = null where id = _row.id;
  if public.link_cash_in_listener_event(_row.id) <> 'no_payment_seen' then
    raise exception 'H: without a sender number the default rules must not match';
  end if;
  update public.cash_in_auto_rules set layer1_require_sender_number = false,
         layer2_require_sender_match = false where ecosystem_id = _eco;
  if public.link_cash_in_listener_event(_row.id) <> 'linked' then
    raise exception 'H: relaxing the sender requirement must be enough to match';
  end if;
end $$;

-- I. Only the platform owner may change the rules ----------------------------
do $$
declare _uid uuid;
begin
  select p.id into _uid from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) limit 1;
  if _uid is null then return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  begin
    perform public.set_cash_in_auth_fields(null, false, null, null, null, null, null);
    raise exception 'I: an ordinary member must not change authentication rules';
  exception when others then
    if sqlerrm not like '%platform owner%' then raise; end if;
  end;
end $$;

-- J. The duplicate search really is global -----------------------------------
do $$
declare _a public.cash_in_requests; _hit uuid; _key text;
begin
  select * into _a from public.cash_in_requests
   where coalesce(receipt_reference_key, payer_reference_key) is not null
     and status in ('pending','approved')
   limit 1;
  if _a.id is null then raise notice 'skipped: no referenced cash in to compare'; return; end if;
  _key := coalesce(_a.receipt_reference_key, _a.payer_reference_key);

  -- Asking on behalf of a DIFFERENT request must find the existing one, no
  -- matter which shop either belongs to.
  _hit := public.cash_in_reference_duplicate(gen_random_uuid(), _key,
                                             coalesce(_a.receipt_paid_at, _a.paid_at));
  if _hit is null then
    raise exception 'J: an already-used reference must be found across all shops';
  end if;
  -- The request itself is never its own duplicate.
  if public.cash_in_reference_duplicate(_a.id, _key, _a.paid_at) = _a.id then
    raise exception 'J: a request must not flag itself';
  end if;
end $$;

rollback;
