-- CORRECTION: two agreeing details are enough. No "strong identity signal" is
-- required, and a reference that only one side carries (or that differs
-- between the customer receipt and the phone notification) no longer vetoes a
-- match. Amount alone is still never enough (it counts as one signal), and all
-- duplicate/reuse protections stay exactly as they are.

create or replace function public.listener_match_signals(_ev public.listener_events,
                                                         _row public.cash_in_requests)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  with c as (
    select public.cash_in_sender_key(_row) as sender_key,
           coalesce(_row.receipt_reference_key, _row.payer_reference_key) as ref_key,
           public.cash_in_account_tail(_row) as tail,
           public.listener_event_account_tail(_ev) as ev_tail,
           public.payment_name_key(_row.receipt_sender_name) as name_key,
           public.payment_name_key(_ev.sender_name) as ev_name_key,
           coalesce((select r.amount_tolerance_php
                       from public.cash_in_auto_rule(_row.ecosystem_id) r), 0) as tol
  )
  select
      (case when _ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key = c.ref_key then 1 else 0 end)
    + (case when _ev.sender_number_key is not null and c.sender_key is not null
                 and _ev.sender_number_key = c.sender_key then 1 else 0 end)
    + (case when not (_ev.sender_number_key is not null and c.sender_key is not null)
                 and c.tail is not null and c.ev_tail is not null
                 and c.tail = c.ev_tail then 1 else 0 end)
    + (case when c.name_key is not null and c.ev_name_key is not null
                 and c.name_key = c.ev_name_key then 1 else 0 end)
    + (case when _ev.amount_php is not null
                 and abs(_ev.amount_php - _row.amount_php) <= c.tol then 1 else 0 end)
  from c
$function$;

create or replace function public.listener_match_signal_details(_ev public.listener_events,
                                                                _row public.cash_in_requests)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with c as (
    select public.cash_in_sender_key(_row) as sender_key,
           coalesce(_row.receipt_reference_key, _row.payer_reference_key) as ref_key,
           public.cash_in_account_tail(_row) as tail,
           public.listener_event_account_tail(_ev) as ev_tail,
           public.payment_name_key(_row.receipt_sender_name) as name_key,
           public.payment_name_key(_ev.sender_name) as ev_name_key,
           coalesce((select r.amount_tolerance_php
                       from public.cash_in_auto_rule(_row.ecosystem_id) r), 0) as tol
  )
  select jsonb_build_array(
    jsonb_build_object(
      'signal', 'reference', 'strength', 'normal',
      'receipt', c.ref_key, 'notification', _ev.reference_key,
      'agreed', (_ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key = c.ref_key)),
    jsonb_build_object(
      'signal', 'sender_account', 'strength', 'normal',
      'receipt', c.sender_key, 'notification', _ev.sender_number_key,
      'agreed', (_ev.sender_number_key is not null and c.sender_key is not null
                 and _ev.sender_number_key = c.sender_key)),
    jsonb_build_object(
      'signal', 'account_tail', 'strength', 'normal',
      'receipt', c.tail, 'notification', c.ev_tail,
      'agreed', (not (_ev.sender_number_key is not null and c.sender_key is not null)
                 and c.tail is not null and c.ev_tail is not null and c.tail = c.ev_tail)),
    jsonb_build_object(
      'signal', 'payer_name', 'strength', 'normal',
      'receipt', c.name_key, 'notification', c.ev_name_key,
      'agreed', (c.name_key is not null and c.ev_name_key is not null
                 and c.name_key = c.ev_name_key)),
    jsonb_build_object(
      'signal', 'amount', 'strength', 'normal',
      'receipt', _row.amount_php, 'notification', _ev.amount_php,
      'tolerance_php', c.tol,
      'agreed', (_ev.amount_php is not null
                 and abs(_ev.amount_php - _row.amount_php) <= c.tol)),
    -- Informational only: the two sides describe the payment from different
    -- perspectives, so a reference present on only one side, or a different
    -- one, is recorded but never blocks a match.
    jsonb_build_object(
      'signal', 'reference_difference', 'strength', 'informational',
      'receipt', c.ref_key, 'notification', _ev.reference_key,
      'agreed', (_ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key <> c.ref_key))
  )
  from c
$function$;

-- Candidate search: two agreeing details, no strong-signal requirement.
create or replace function public.match_listener_event(_event uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _ev public.listener_events; _dev public.listener_devices;
        _candidates uuid[]; _auth_candidates uuid[]; _target uuid; _result text; _note text;
        _when timestamptz;
begin
  select * into _ev from public.listener_events where id = _event for update;
  if _ev.id is null then return 'not_found'; end if;
  if _ev.outcome = 'non_payment' then return 'non_payment'; end if;
  if _ev.outcome <> 'accepted' then return _ev.outcome; end if;
  if _ev.consumed_cash_in_id is not null then return 'already_consumed'; end if;
  if _ev.amount_php is null then return 'unparsed'; end if;
  select * into _dev from public.listener_devices where id = _ev.device_id;
  if _dev.id is null or _dev.status <> 'active' then return 'device_revoked'; end if;

  update public.listener_events
     set match_attempts = match_attempts + 1, last_match_attempt_at = now()
   where id = _ev.id;

  _when := coalesce(_ev.posted_at, _ev.created_at);

  -- At least two agreeing details. Amount alone is one signal, so it can never
  -- reach two on its own. Capture time is metadata, never a signal.
  select array_agg(c.id) into _auth_candidates
    from public.cash_in_requests c
   where c.status = 'pending'
     and c.listener_event_id is null
     and public.listener_match_signals(_ev, c) >= 2
     and _when >= coalesce(c.receipt_paid_at, c.paid_at, c.created_at) - interval '3 days'
     and _when <= coalesce(c.receipt_paid_at, c.paid_at, c.created_at) + interval '7 days';

  select array_agg(c.id) into _candidates
    from public.cash_in_requests c
   where c.id = any(coalesce(_auth_candidates, '{}'::uuid[]))
     and public.listener_serves_destination(_dev.id, c.ecosystem_id, c.method_id);

  if _candidates is null or array_length(_candidates, 1) = 0 then
    if _auth_candidates is not null and array_length(_auth_candidates, 1) > 0 then
      update public.listener_events set match_result = 'wrong_shop', review_state = 'pending'
       where id = _ev.id;
      return 'wrong_shop';
    end if;
    update public.listener_events set match_result = 'no_pending_match', review_state = 'pending'
     where id = _ev.id;
    return 'no_pending_match';
  end if;
  if array_length(_candidates, 1) > 1 then
    update public.listener_events set match_result = 'ambiguous', review_state = 'pending'
     where id = _ev.id;
    return 'ambiguous';
  end if;

  _target := _candidates[1];

  if not public.listener_receiving_number_matches(
       _dev.id,
       (select ecosystem_id from public.cash_in_requests where id = _target),
       (select method_id from public.cash_in_requests where id = _target)) then
    _note := 'Informational: the payment app reported a different or masked receiving number than '
          || 'the shop''s configured number. This does not affect authentication and did not block '
          || 'matching.';
  end if;

  update public.cash_in_requests set listener_event_id = _ev.id
   where id = _target and listener_event_id is null;
  if not found then
    update public.listener_events set match_result = 'no_pending_match', review_state = 'pending'
     where id = _ev.id;
    return 'no_pending_match';
  end if;
  update public.listener_events
     set consumed_cash_in_id = _target, match_result = 'matched', review_state = 'matched',
         destination_note = coalesce(_note, destination_note)
   where id = _ev.id and consumed_cash_in_id is null;
  if not found then
    update public.cash_in_requests set listener_event_id = null
     where id = _target and listener_event_id = _ev.id;
    return 'already_consumed';
  end if;
  _result := public.reconcile_cash_in(_target);
  update public.listener_events set match_result = 'matched:' || _result where id = _ev.id;
  return _result;
end $function$;

-- Approval: same correction, every other safeguard untouched.
create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text; _sender text;
        _ev public.listener_events; _receipt text; _refkey text; _paid timestamptz;
        _provider text; _hash text;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then return 'disabled'; end if;
  if _row.proof_path is null then return 'no_proof'; end if;

  _receipt := coalesce(_row.receipt_check, 'pending');
  _refkey := coalesce(_row.receipt_reference_key, _row.payer_reference_key);
  _paid := coalesce(_row.receipt_paid_at, _row.paid_at);
  _sender := public.cash_in_sender_key(_row);

  if _refkey is null then
    if _receipt in ('unreadable','error') then return 'receipt_unreadable'; end if;
    return 'awaiting_receipt_check';
  end if;

  if coalesce(_row.duplicate_receipt, false) then return 'duplicate_receipt'; end if;
  if _row.proof_hash is not null
     and exists (select 1 from public.cash_in_requests c
                  where c.proof_hash = _row.proof_hash and c.id <> _row.id
                    and c.status = 'approved') then
    return 'duplicate_receipt';
  end if;

  if _row.duplicate_reference
     or public.cash_in_reference_duplicate(_row.id, _refkey, _paid) is not null then
    return 'duplicate_reference';
  end if;
  if exists (select 1 from public.listener_events e
              where e.reference_key = _refkey
                and e.consumed_cash_in_id is not null
                and e.consumed_cash_in_id <> _row.id) then
    return 'duplicate_reference';
  end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    return 'above_auto_limit';
  end if;
  if _rule.expected_amount_php is not null
     and abs(_row.amount_php - _rule.expected_amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;

  _recv := public.normalize_ph_mobile(
             public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _recv is null then return 'no_receiving_number'; end if;

  if coalesce(_rule.layer2_require_sender_match, true) and _sender is null then
    return 'no_sender_number';
  end if;
  if _row.receipt_sender_number_key is not null and _sender is not null
     and _row.receipt_sender_number_key <> _sender then
    return 'number_mismatch';
  end if;

  if _row.listener_event_id is null then
    if coalesce(_rule.require_listener_match, true) then return 'awaiting_listener'; end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    _provider := _ev.provider_id;
    -- NON-NEGOTIABLE: at least two independent details must agree between the
    -- receipt and the notification. Amount alone is one signal and can never
    -- reach two on its own. No particular signal is mandatory, a reference the
    -- notification does not carry is normal, and the time the phone captured
    -- the notification is never a signal.
    if public.listener_match_signals(_ev, _row) < 2 then
      return 'insufficient_match_signals';
    end if;
    if coalesce(_rule.layer2_require_sender_match, true)
       and (_ev.sender_number_key is null or _ev.sender_number_key is distinct from _sender) then
      return 'number_mismatch';
    end if;
    if coalesce(_rule.layer2_require_amount_match, true)
       and (_ev.amount_php is null
            or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0)) then
      return 'amount_mismatch';
    end if;
    if not public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id) then
      return 'wrong_shop';
    end if;
    if not exists (select 1 from public.listener_devices d
                    where d.id = _ev.device_id and d.status = 'active'
                      and d.last_seen_at is not null
                      and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes)) then
      return 'listener_offline';
    end if;
  end if;

  _provider := coalesce(_provider, _row.provider_id, 'gcash');
  if public.payment_reference_used_elsewhere(_row.id, _provider, _refkey) then
    return 'duplicate_reference';
  end if;

  if _receipt = 'mismatch' then return 'receipt_reference_mismatch'; end if;
  if coalesce(_rule.require_receipt_match, true) then
    if _receipt in ('unreadable', 'error') then return 'receipt_unreadable'; end if;
    if _receipt <> 'matched' then return 'awaiting_receipt_check'; end if;
  end if;
  if _row.receipt_amount_php is not null
     and abs(_row.receipt_amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;
  if _row.receipt_receiving_number_key is not null
     and _row.receipt_receiving_number_key <> _recv then
    return 'receiving_mismatch';
  end if;

  if coalesce(_rule.verification_mode, 'active') = 'staged' then
    update public.cash_in_requests
       set staged_result = 'would_approve', staged_at = now()
     where id = _row.id;
    perform public.record_payment_match(_row.id, 'staged', _provider, null);
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_row.ecosystem_id, null, 'Automatic matching (staged)', 'Cash in would be approved',
            _row.requester_name,
            jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                               'listener_event_id', _row.listener_event_id,
                               'provider_id', _provider,
                               'receipt_check', _row.receipt_check,
                               'receipt_paid_at', _row.receipt_paid_at));
    return 'staged';
  end if;

  _hash := public.remember_payment_reference(_provider, _refkey, _row.id, _row.ecosystem_id);
  perform public.record_payment_match(_row.id, 'auto_approved', _provider, _hash);

  _note := 'A payment notification from a paired listener device agrees with this receipt on at '
        || 'least two independent details, and the receipt reference has never been used before.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real payment notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                             'listener_event_id', _row.listener_event_id,
                             'provider_id', _provider,
                             'receipt_check', _row.receipt_check,
                             'sender_number_key', _sender));
  return 'approved';
end $function$;