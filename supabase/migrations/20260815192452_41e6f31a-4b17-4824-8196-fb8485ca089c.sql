-- Cash In matching: payment-first workflow.
--
-- The member's GCash number on a cash in is their SENDING number. Automatic
-- approval requires a real listener notification whose sender number and amount
-- match the request, inside the paired device's matching window, in either
-- order (payment before request, or request before payment). The payment
-- reference remains a secondary uniqueness guard.

create or replace function public.link_cash_in_listener_event(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _tol numeric; _recv text;
        _cands uuid[]; _ev uuid;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;
  if _row.listener_event_id is not null then return 'already_linked'; end if;
  if _row.sender_number_key is null then return 'no_sender_number'; end if;

  _recv := public.normalize_ph_mobile(
             public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _recv is null then return 'no_receiving_number'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  _tol := coalesce(_rule.amount_tolerance_php, 0);

  select array_agg(e.id) into _cands
    from public.listener_events e
    join public.listener_devices d on d.id = e.device_id
   where e.outcome = 'accepted'
     and e.consumed_cash_in_id is null
     and e.amount_php is not null
     and abs(e.amount_php - _row.amount_php) <= _tol
     and e.sender_number_key is not null
     and e.sender_number_key = _row.sender_number_key
     and d.status <> 'revoked'
     and (d.ecosystem_id is null or d.ecosystem_id = _row.ecosystem_id)
     and coalesce(e.posted_at, e.created_at)
           between _row.created_at - make_interval(mins => d.match_window_minutes)
               and _row.created_at + make_interval(mins => d.match_window_minutes);

  if _cands is null or array_length(_cands, 1) = 0 then return 'no_payment_seen'; end if;
  if array_length(_cands, 1) > 1 then return 'ambiguous_event'; end if;

  _ev := _cands[1];
  update public.listener_events
     set consumed_cash_in_id = _row.id, match_result = 'matched'
   where id = _ev and consumed_cash_in_id is null;
  if not found then return 'no_payment_seen'; end if;

  update public.cash_in_requests set listener_event_id = _ev where id = _row.id;
  return 'linked';
end $function$;

revoke all on function public.link_cash_in_listener_event(uuid) from public, anon, authenticated;

-- Event -> request direction: the sending number is now a hard requirement.
create or replace function public.match_listener_event(_event uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _ev public.listener_events; _dev public.listener_devices;
        _candidates uuid[]; _target uuid; _result text;
begin
  select * into _ev from public.listener_events where id = _event for update;
  if _ev.id is null then return 'not_found'; end if;
  if _ev.outcome <> 'accepted' then return _ev.outcome; end if;
  if _ev.consumed_cash_in_id is not null then return 'already_consumed'; end if;
  if _ev.amount_php is null then return 'unparsed'; end if;
  select * into _dev from public.listener_devices where id = _ev.device_id;
  if _dev.id is null or _dev.status = 'revoked' then return 'device_revoked'; end if;
  if _ev.sender_number_key is null then
    update public.listener_events set match_result = 'no_sender_number' where id = _ev.id;
    return 'no_sender_number';
  end if;

  select array_agg(c.id) into _candidates
    from public.cash_in_requests c
   where c.status = 'pending'
     and c.listener_event_id is null
     and c.sender_number_key = _ev.sender_number_key
     and abs(c.amount_php - _ev.amount_php)
           <= coalesce((select r.amount_tolerance_php
                          from public.cash_in_auto_rule(c.ecosystem_id) r), 0)
     and (_dev.ecosystem_id is null or c.ecosystem_id = _dev.ecosystem_id)
     and public.cash_in_receiving_number(c.ecosystem_id, c.method_id) is not null
     and c.created_at
           between coalesce(_ev.posted_at, _ev.created_at) - make_interval(mins => _dev.match_window_minutes)
               and coalesce(_ev.posted_at, _ev.created_at) + make_interval(mins => _dev.match_window_minutes);

  if _candidates is null or array_length(_candidates, 1) = 0 then
    update public.listener_events set match_result = 'no_pending_match' where id = _ev.id;
    return 'no_pending_match';
  end if;
  if array_length(_candidates, 1) > 1 then
    update public.listener_events set match_result = 'ambiguous' where id = _ev.id;
    return 'ambiguous';
  end if;

  _target := _candidates[1];
  update public.cash_in_requests set listener_event_id = _ev.id where id = _target;
  update public.listener_events set consumed_cash_in_id = _target, match_result = 'matched'
   where id = _ev.id;
  _result := public.try_auto_approve_cash_in(_target);
  update public.listener_events set match_result = 'matched:' || _result where id = _ev.id;
  return _result;
end $function$;

-- Approval: a real notification always establishes the payment.
create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text;
        _ev public.listener_events;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then return 'disabled'; end if;
  if _row.payer_reference_key is null then return 'no_reference'; end if;
  if _row.proof_path is null then return 'no_proof'; end if;
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
  if _row.sender_number_key is null then return 'no_sender_number'; end if;

  -- A screenshot is never proof. Only a notification from a paired phone on the
  -- shop's receiving account can establish that the money actually arrived.
  if _row.listener_event_id is null then return 'awaiting_listener'; end if;
  select * into _ev from public.listener_events where id = _row.listener_event_id;
  if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
  if _ev.sender_number_key is null or _ev.sender_number_key <> _row.sender_number_key then
    return 'number_mismatch';
  end if;
  if _ev.amount_php is null
     or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;
  if not exists (select 1 from public.listener_devices d
                  where d.id = _ev.device_id and d.status = 'active'
                    and (d.ecosystem_id is null or d.ecosystem_id = _row.ecosystem_id)
                    and d.last_seen_at is not null
                    and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes)) then
    return 'listener_offline';
  end if;

  _note := 'A GCash notification from the paired listener device on the shop''s receiving '
        || 'account confirms the amount and the sending number, and the payment reference '
        || 'had never been used. The screenshot is retained as supporting evidence — GCash '
        || 'itself was not contacted.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real GCash notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'cash_in_id', _row.id,
                             'amount_php', _row.amount_php, 'credits', _row.credits,
                             'approval_method', 'automatic', 'matching_result', 'matched',
                             'listener_event_id', _row.listener_event_id,
                             'payer_reference', _row.payer_reference,
                             'requester_id', _row.user_id, 'ecosystem_id', _row.ecosystem_id));
  return 'approved';
end $function$;

-- Submission: store the member's number as the sending number and look back for
-- a payment that already arrived.
create or replace function public.request_cash_in(_method_id uuid, _amount_php numeric,
  _payer_reference text default null::text, _notes text default null::text,
  _request_key text default null::text, _proof_path text default null::text,
  _payer_number text default null::text)
returns cash_in_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _fee numeric(14,2); _net numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text; _proof text; _folder text;
        _ref_key text; _num text; _num_key text; _dup boolean := false;
        _dupe_reason constant text := 'Duplicate payment reference/transaction already used.';
begin
  _op := auth.uid(); _subject := public.effective_uid();
  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if public.is_super_admin(_subject) then
    raise exception 'The platform owner does not hold a member credit balance and cannot cash in';
  end if;
  _role := coalesce(public.top_role(_subject), 'customer');

  if _amount_php is null or _amount_php <= 0 then raise exception 'Enter how much you are paying'; end if;
  if _amount_php > 10000000 then raise exception 'A single cash in is limited to 10,000,000'; end if;

  select * into _m from public.payment_methods where id = _method_id;
  if _m.id is null or not _m.active then raise exception 'Choose an available payment method'; end if;

  _ref_key := public.normalize_payment_reference(_payer_reference);
  if _ref_key is null then raise exception 'Enter the GCash payment reference number'; end if;

  _num := nullif(trim(_payer_number), '');
  _num_key := public.normalize_ph_mobile(_num);
  if _num_key is null then raise exception 'Enter the GCash number you paid from'; end if;

  _proof := nullif(trim(_proof_path), '');
  if _proof is null then raise exception 'Attach your payment screenshot'; end if;
  _folder := split_part(_proof, '/', 1);
  if _folder is null or _folder = '' or (_folder <> _subject::text and _folder <> _op::text) then
    raise exception 'That payment screenshot does not belong to this member';
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);
  select * into _row from public.cash_in_requests where request_key = _key;
  if _row.id is not null then return _row; end if;

  select * into _s from public.money_settings();
  _fee := round(_amount_php * coalesce(_s.cash_in_fee_percent,0) / 100.0, 2);
  _net := round(_amount_php - _fee, 2);
  if _net <= 0 then raise exception 'That amount is too small to cash in'; end if;
  _credits := round(_net * _s.credits_per_unit / _s.php_per_unit, 2);
  if _credits <= 0 then raise exception 'That amount is too small to cash in'; end if;

  _ref := 'CI-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  if exists (select 1 from public.cash_in_requests c where c.payer_reference_key = _ref_key) then
    _dup := true;
  end if;

  begin
    insert into public.cash_in_requests (
      reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
      amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
      method_id, method_name, method_type,
      method_details, payer_reference, payer_reference_key, payer_number, payer_number_key,
      sender_number, sender_number_key,
      notes, proof_path, status, decision_reason, reviewed_at)
    values (_ref, _key, _subject, _eco, _name, _role::text,
            _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
            coalesce(_s.cash_in_fee_percent,0), _fee, _net,
            _m.id, _m.name, _m.method_type,
            jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                               'account_number', _m.account_number, 'notes', _m.notes),
            nullif(trim(_payer_reference),''),
            case when _dup then null else _ref_key end,
            _num, _num_key, _num, _num_key,
            nullif(trim(_notes),''), _proof,
            case when _dup then 'rejected' else 'pending' end,
            case when _dup then _dupe_reason else null end,
            case when _dup then now() else null end)
    returning * into _row;
  exception when unique_violation then
    _dup := true;
    insert into public.cash_in_requests (
      reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
      amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
      method_id, method_name, method_type,
      method_details, payer_reference, payer_number, payer_number_key,
      sender_number, sender_number_key, notes, proof_path,
      status, decision_reason, reviewed_at)
    values (_ref, _key, _subject, _eco, _name, _role::text,
            _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
            coalesce(_s.cash_in_fee_percent,0), _fee, _net,
            _m.id, _m.name, _m.method_type,
            jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                               'account_number', _m.account_number, 'notes', _m.notes),
            nullif(trim(_payer_reference),''), _num, _num_key, _num, _num_key,
            nullif(trim(_notes),''), _proof,
            'rejected', _dupe_reason, now())
    returning * into _row;
  end;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          case when _dup then 'Rejected duplicate cash in' else 'Requested cash in' end, _name,
          jsonb_build_object('reference', _ref, 'amount_php', _amount_php, 'credits', _credits,
                             'fee_percent', coalesce(_s.cash_in_fee_percent,0), 'fee_php', _fee,
                             'net_php', _net,
                             'method', _m.name, 'requester_id', _subject, 'status', _row.status,
                             'payer_reference', nullif(trim(_payer_reference),''),
                             'duplicate', _dup,
                             'has_proof', true));

  if not _dup then
    -- The customer may have paid before submitting: look back for a real
    -- notification that nobody has used yet.
    perform public.link_cash_in_listener_event(_row.id);
    perform public.try_auto_approve_cash_in(_row.id);
    select * into _row from public.cash_in_requests where id = _row.id;
  end if;

  return _row;
end $function$;