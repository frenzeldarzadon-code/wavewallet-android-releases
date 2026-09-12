-- 1. Independent-fact counting: every agreed identity/supporting detail counts
--    once. Informational signals never count. The same field is never counted
--    twice (the masked-tail signal already stands down when both full sending
--    numbers are known).
create or replace function public.listener_match_signals(_ev listener_events, _row cash_in_requests)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  select count(*)::integer
    from jsonb_array_elements(public.listener_match_signal_details(_ev, _row)) x
   where (x->>'category') in ('identity', 'supporting')
     and coalesce((x->>'agreed')::boolean, false)
$function$;

-- 2. Linking rule: the exact amount must agree and at least two independent
--    details in total. A strong "identity" detail is no longer mandatory, and
--    the event may arrive before or after the request.
create or replace function public.listener_event_fits_cash_in(_ev listener_events, _row cash_in_requests)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select _ev.outcome = 'accepted'
     and _ev.amount_php is not null
     and abs(_ev.amount_php - _row.amount_php)
           <= coalesce((select r.amount_tolerance_php from public.cash_in_auto_rule(_row.ecosystem_id) r), 0)
     and public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id)
     and public.listener_match_signals(_ev, _row) >= 2
     and coalesce(_ev.posted_at, _ev.created_at)
           between coalesce(_row.receipt_paid_at, _row.paid_at, _row.created_at) - interval '3 days'
               and coalesce(_row.receipt_paid_at, _row.paid_at, _row.created_at) + interval '7 days'
$function$;

-- 3. Late linking: a notification captured BEFORE the request was created is
--    picked up here. The customer's typed sending number is no longer required.
create or replace function public.link_cash_in_listener_event(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _cands uuid[]; _ev uuid;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;
  if _row.listener_event_id is not null then return 'already_linked'; end if;

  if not exists (select 1 from public.cash_in_expected_receiving_accounts(_row)) then
    return 'no_receiving_number';
  end if;

  select array_agg(e.id) into _cands
    from public.listener_events e
    join public.listener_devices d on d.id = e.device_id
   where e.consumed_cash_in_id is null
     and d.status = 'active'
     and public.listener_event_fits_cash_in(e, _row);

  if _cands is null or array_length(_cands, 1) = 0 then return 'no_payment_seen'; end if;
  if array_length(_cands, 1) > 1 then return 'ambiguous_event'; end if;

  _ev := _cands[1];
  update public.listener_events
     set consumed_cash_in_id = _row.id, match_result = 'matched', review_state = 'matched'
   where id = _ev and consumed_cash_in_id is null;
  if not found then return 'no_payment_seen'; end if;

  update public.cash_in_requests set listener_event_id = _ev
   where id = _row.id and listener_event_id is null;
  if not found then
    update public.listener_events
       set consumed_cash_in_id = null, match_result = 'no_pending_match', review_state = 'pending'
     where id = _ev and consumed_cash_in_id = _row.id;
    return 'already_linked';
  end if;
  return 'linked';
end $function$;

-- 4. Automatic approval. The typed sending number is supporting evidence only.
create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _note text; _sender text;
        _ev public.listener_events; _receipt text; _refkey text; _paid timestamptz;
        _provider text; _hash text; _credited uuid; _rchk jsonb; _signals int;
        _credited_reason constant text :=
          'Duplicate: this receipt (or its reference) was already used by a cash in that was credited. '
          || 'Disapproved automatically - the wallet was not credited a second time.';
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  -- The receiving account on the evidence must be the configured payee account.
  if public.cash_in_enforce_receiver_account(_row.id) = 'rejected' then
    return 'receiving_mismatch_rejected';
  end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then return 'disabled'; end if;
  if _row.proof_path is null then return 'no_proof'; end if;

  _receipt := coalesce(_row.receipt_check, 'pending');
  _refkey := coalesce(_row.receipt_reference_key, _row.payer_reference_key);
  _paid := coalesce(_row.receipt_paid_at, _row.paid_at);
  _sender := public.cash_in_sender_key(_row);
  if _row.listener_event_id is not null then
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    _provider := _ev.provider_id;
  end if;
  _provider := coalesce(_provider, _row.provider_id, 'gcash');

  -- Duplicate protection, serialised per reference. Always blocks crediting.
  if _refkey is not null then
    perform pg_advisory_xact_lock(hashtext('cash_in_ref:' || _provider || ':' || _refkey));
  end if;
  _credited := public.cash_in_credited_duplicate(_row.id, _refkey, _row.proof_hash, _provider);
  if _credited is null and _refkey is not null
     and public.payment_reference_used_elsewhere(_row.id, _provider, _refkey) then
    select s.cash_in_id into _credited from public.payment_reference_seen s
     where s.reference_hash = public.payment_reference_hash(_provider, _refkey) limit 1;
    _credited := coalesce(_credited, _row.id);
  end if;
  if _credited is not null then
    perform public.auto_disapprove_cash_in(_row.id, _credited_reason, nullif(_credited, _row.id),
              case when _row.proof_hash is not null and exists (
                     select 1 from public.cash_in_requests c where c.id = _credited and c.proof_hash = _row.proof_hash)
                   then 'duplicate_receipt' else 'duplicate_reference' end);
    return 'duplicate_credited';
  end if;

  if _refkey is null then
    if _receipt in ('unreadable','error') then return 'receipt_unreadable'; end if;
    return 'awaiting_receipt_check';
  end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    return 'above_auto_limit';
  end if;
  if _rule.expected_amount_php is not null
     and abs(_row.amount_php - _rule.expected_amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;

  if _row.listener_event_id is null then
    if coalesce(_rule.require_listener_match, true) then return 'awaiting_listener'; end if;
  else
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    -- Core fact: the exact amount received must equal the amount requested.
    if _ev.amount_php is null
       or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
      return 'amount_mismatch';
    end if;
    -- Plus at least one further independent fact (two in total). The sending
    -- number the customer typed is never a mandatory factor on its own.
    _signals := public.listener_match_signals(_ev, _row);
    if _signals < 2 then return 'insufficient_match_signals'; end if;
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

  if _receipt = 'mismatch' then return 'receipt_reference_mismatch'; end if;
  if coalesce(_rule.require_receipt_match, true) then
    if _receipt in ('unreadable', 'error') then return 'receipt_unreadable'; end if;
    if _receipt <> 'matched' then return 'awaiting_receipt_check'; end if;
  end if;
  if _row.receipt_amount_php is not null
     and abs(_row.receipt_amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;

  _rchk := public.cash_in_receiver_account_check(_row, _ev);
  if _rchk->>'status' in ('mismatch', 'conflict') then
    perform public.cash_in_enforce_receiver_account(_row.id);
    return 'receiving_mismatch_rejected';
  elsif _rchk->>'status' = 'not_configured' then
    return 'no_receiving_number';
  elsif _rchk->>'status' <> 'matched' then
    return 'no_receiving_evidence';
  end if;

  if coalesce(_rule.verification_mode, 'active') = 'staged' then
    update public.cash_in_requests set staged_result = 'would_approve', staged_at = now() where id = _row.id;
    perform public.record_payment_match(_row.id, 'staged', _provider, null);
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_row.ecosystem_id, null, 'Automatic matching (staged)', 'Cash in would be approved',
            _row.requester_name,
            jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                               'listener_event_id', _row.listener_event_id, 'provider_id', _provider,
                               'receipt_check', _row.receipt_check, 'receipt_paid_at', _row.receipt_paid_at,
                               'submitted_sender_number_key', _sender,
                               'match_signals', _signals,
                               'receiver_account_check', _rchk));
    return 'staged';
  end if;

  _hash := public.remember_payment_reference(_provider, _refkey, _row.id, _row.ecosystem_id);
  perform public.record_payment_match(_row.id, 'auto_approved', _provider, _hash);

  _note := 'A captured payment notification agrees with this receipt on the exact amount and at least one '
        || 'further independent detail, the configured receiving account was confirmed on the '
        || coalesce(_rchk->>'matched_source', 'evidence')
        || ', and neither the receipt nor its reference was credited before.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real payment notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                             'listener_event_id', _row.listener_event_id, 'provider_id', _provider,
                             'receipt_check', _row.receipt_check,
                             'submitted_sender_number_key', _sender,
                             'match_signals', _signals,
                             'receiver_account_check', _rchk));
  return 'approved';
end $function$;

-- 5. Review reasons: sending-number differences are informational, never
--    blockers. Amount, independent-fact count, duplicates and the receiving
--    account remain blocking.
create or replace function public.cash_in_auth_blockers(_id uuid)
returns text[]
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _ev public.listener_events;
        _out text[] := '{}'::text[]; _sender text; _provider text; _rchk jsonb;
begin
  select * into _row from public.cash_in_requests where id = _id;
  if _row.id is null then return array['not_found']::text[]; end if;
  if _row.status <> 'pending' then return '{}'::text[]; end if;
  if _row.listener_event_id is not null then
    select * into _ev from public.listener_events where id = _row.listener_event_id;
  end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then _out := _out || 'automatic_matching_disabled'::text; end if;
  if _row.proof_path is null then _out := _out || 'no_receipt_uploaded'::text; end if;

  if coalesce(_row.receipt_check, 'pending') in ('unreadable', 'error') then
    _out := _out || 'receipt_unreadable'::text;
  elsif coalesce(_row.receipt_check, 'pending') = 'mismatch' then
    _out := _out || 'receipt_reference_mismatch'::text;
  elsif coalesce(_row.receipt_check, 'pending') = 'pending' then
    _out := _out || 'receipt_not_read_yet'::text;
  end if;

  if coalesce(_row.receipt_reference_key, _row.payer_reference_key) is null then
    _out := _out || 'missing_reference'::text;
  end if;
  if coalesce(_row.receipt_paid_at, _row.paid_at) is null then
    _out := _out || 'missing_receipt_time'::text;
  end if;

  _rchk := public.cash_in_receiver_account_check(_row, _ev);
  if _rchk->>'status' = 'not_configured' then _out := _out || 'shop_has_no_receiving_number'::text;
  elsif _rchk->>'status' in ('mismatch', 'conflict') then _out := _out || 'receiving_mismatch'::text;
  elsif _rchk->>'status' = 'absent' then _out := _out || 'no_receiving_evidence'::text;
  end if;

  _sender := public.cash_in_sender_key(_row);

  if _row.listener_event_id is null then
    _out := _out || 'no_listener_event'::text;
  else
    if _ev.id is null or _ev.outcome <> 'accepted' then
      _out := _out || 'no_listener_event'::text;
    else
      if _ev.amount_php is null
         or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
        _out := _out || 'listener_amount_mismatch'::text;
      end if;
      if public.listener_match_signals(_ev, _row) < 2 then
        _out := _out || 'insufficient_match_signals'::text;
      end if;
      if not public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id) then
        _out := _out || 'wrong_shop'::text;
      end if;
    end if;
  end if;

  _provider := coalesce(_ev.provider_id, _row.provider_id, 'gcash');
  if coalesce(_row.duplicate_reference, false) or coalesce(_row.duplicate_receipt, false)
     or public.cash_in_credited_duplicate(_row.id,
          coalesce(_row.receipt_reference_key, _row.payer_reference_key), _row.proof_hash, _provider) is not null
     or public.payment_reference_used_elsewhere(_row.id, _provider,
          coalesce(_row.receipt_reference_key, _row.payer_reference_key)) then
    _out := _out || 'duplicate_reference'::text;
  end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    _out := _out || 'above_auto_limit'::text;
  end if;
  return _out;
end $function$;

comment on function public.listener_match_signals(listener_events, cash_in_requests) is
  'Number of independent details that agree between the receiver-side notification and the sender-side receipt. Each field counts once; informational differences never count.';
