-- Receiver-side notifications may omit the payer number; only a contradicting
-- sender blocks automatic approval. The >=2 independent-signal rule still applies.
CREATE OR REPLACE FUNCTION public.try_auto_approve_cash_in(_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text; _sender text;
        _ev public.listener_events; _receipt text; _refkey text; _paid timestamptz;
        _provider text; _hash text; _credited uuid;
        _credited_reason constant text :=
          'Duplicate: this receipt (or its reference) was already used by a cash in that was credited. '
          || 'Disapproved automatically - the wallet was not credited a second time.';
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
  if _row.listener_event_id is not null then
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    _provider := _ev.provider_id;
  end if;
  _provider := coalesce(_provider, _row.provider_id, 'gcash');

  -- Duplicate protection always takes precedence and is serialised per
  -- reference so two identical references can never both be credited.
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

  _recv := public.normalize_ph_mobile(public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
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
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    -- NON-NEGOTIABLE: at least two independent details must agree between the
    -- receipt and the notification. Amount alone is one signal.
    if public.listener_match_signals(_ev, _row) < 2 then
      return 'insufficient_match_signals';
    end if;
    -- Sender/receiver semantics: the notification is the receiver-side view and
    -- may not carry the payer's number at all. Only a CONTRADICTING sender (both
    -- sides present and different) blocks; an absent one is simply not a signal,
    -- and the two-independent-signal rule above already guards approval.
    if coalesce(_rule.layer2_require_sender_match, true)
       and _ev.sender_number_key is not null and _sender is not null
       and _ev.sender_number_key <> _sender then
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

  if _receipt = 'mismatch' then return 'receipt_reference_mismatch'; end if;
  if coalesce(_rule.require_receipt_match, true) then
    if _receipt in ('unreadable', 'error') then return 'receipt_unreadable'; end if;
    if _receipt <> 'matched' then return 'awaiting_receipt_check'; end if;
  end if;
  if _row.receipt_amount_php is not null
     and abs(_row.receipt_amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;
  if _row.receipt_receiving_number_key is not null and _row.receipt_receiving_number_key <> _recv then
    return 'receiving_mismatch';
  end if;

  if coalesce(_rule.verification_mode, 'active') = 'staged' then
    update public.cash_in_requests set staged_result = 'would_approve', staged_at = now() where id = _row.id;
    perform public.record_payment_match(_row.id, 'staged', _provider, null);
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_row.ecosystem_id, null, 'Automatic matching (staged)', 'Cash in would be approved',
            _row.requester_name,
            jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                               'listener_event_id', _row.listener_event_id, 'provider_id', _provider,
                               'receipt_check', _row.receipt_check, 'receipt_paid_at', _row.receipt_paid_at));
    return 'staged';
  end if;

  _hash := public.remember_payment_reference(_provider, _refkey, _row.id, _row.ecosystem_id);
  perform public.record_payment_match(_row.id, 'auto_approved', _provider, _hash);

  _note := 'A captured payment notification agrees with this receipt on at least two independent '
        || 'details, and neither the receipt nor its reference was credited before.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real payment notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                             'listener_event_id', _row.listener_event_id, 'provider_id', _provider,
                             'receipt_check', _row.receipt_check, 'sender_number_key', _sender,
                             'match_signals', public.listener_match_signals(_ev, _row)));
  return 'approved';
end $function$;

CREATE OR REPLACE FUNCTION public.cash_in_auth_blockers(_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.cash_in_requests; _rule record; _ev public.listener_events;
        _out text[] := '{}'::text[]; _recv text; _sender text; _provider text;
begin
  select * into _row from public.cash_in_requests where id = _id;
  if _row.id is null then return array['not_found']::text[]; end if;
  if _row.status <> 'pending' then return '{}'::text[]; end if;

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

  _recv := public.normalize_ph_mobile(public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _recv is null then _out := _out || 'shop_has_no_receiving_number'::text; end if;
  if _row.receipt_receiving_number_key is not null and _recv is not null
     and _row.receipt_receiving_number_key <> _recv then
    _out := _out || 'receiving_mismatch'::text;
  end if;

  _sender := public.cash_in_sender_key(_row);
  if _sender is null then _out := _out || 'missing_sender_number'::text; end if;
  if _row.receipt_sender_number_key is not null and _sender is not null
     and _row.receipt_sender_number_key <> _sender then
    _out := _out || 'receipt_sender_mismatch'::text;
  end if;

  if _row.listener_event_id is null then
    if _sender is null then
      _out := _out || 'no_listener_event'::text;
    elsif exists (select 1 from public.listener_events e
                   where e.consumed_cash_in_id is null and e.sender_number_key = _sender and e.outcome = 'accepted') then
      _out := _out || 'listener_amount_or_time_mismatch'::text;
    elsif exists (select 1 from public.listener_events e
                   where e.consumed_cash_in_id is null and e.outcome = 'accepted' and e.amount_php = _row.amount_php) then
      _out := _out || 'listener_sender_mismatch'::text;
    else
      _out := _out || 'no_listener_event'::text;
    end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then
      _out := _out || 'no_listener_event'::text;
    else
      if _sender is not null and _ev.sender_number_key is not null
         and _ev.sender_number_key <> _sender then
        _out := _out || 'listener_sender_mismatch'::text;
      end if;
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