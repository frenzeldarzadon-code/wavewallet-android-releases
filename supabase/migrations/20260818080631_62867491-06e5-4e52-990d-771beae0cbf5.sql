create or replace function public.match_listener_event(_event uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _ev public.listener_events; _dev public.listener_devices;
        _candidates uuid[]; _auth_candidates uuid[]; _target uuid; _result text; _note text;
begin
  select * into _ev from public.listener_events where id = _event for update;
  if _ev.id is null then return 'not_found'; end if;
  if _ev.outcome <> 'accepted' then return _ev.outcome; end if;
  if _ev.consumed_cash_in_id is not null then return 'already_consumed'; end if;
  if _ev.amount_php is null then return 'unparsed'; end if;
  select * into _dev from public.listener_devices where id = _ev.device_id;
  if _dev.id is null or _dev.status <> 'active' then return 'device_revoked'; end if;

  update public.listener_events
     set match_attempts = match_attempts + 1, last_match_attempt_at = now()
   where id = _ev.id;

  if _ev.reference_key is not null then
    select array_agg(c.id) into _auth_candidates
      from public.cash_in_requests c
     where c.status = 'pending'
       and c.listener_event_id is null
       and (c.payer_reference_key = _ev.reference_key or c.receipt_reference_key = _ev.reference_key);
  end if;

  if _auth_candidates is null or array_length(_auth_candidates, 1) = 0 then
    select array_agg(c.id) into _auth_candidates
      from public.cash_in_requests c
      join public.profiles p on p.id = c.user_id
      cross join lateral public.cash_in_auto_rule(c.ecosystem_id) r
     where c.status = 'pending'
       and c.listener_event_id is null
       and abs(c.amount_php - _ev.amount_php) <= coalesce(r.amount_tolerance_php, 0)
       and (not coalesce(r.layer1_require_sender_number, true)
            or (_ev.sender_number_key is not null
                and _ev.sender_number_key = coalesce(
                      c.sender_number_key,
                      c.ocr_sender_number_key,
                      c.payer_number_key,
                      public.normalize_ph_mobile(p.phone))))
       and (not coalesce(r.layer1_require_time_window, false)
            or c.created_at
                 between coalesce(_ev.posted_at, _ev.created_at) - make_interval(mins => _dev.match_window_minutes)
                     and coalesce(_ev.posted_at, _ev.created_at) + make_interval(mins => _dev.match_window_minutes));
  end if;

  select array_agg(c.id) into _candidates
    from public.cash_in_requests c
   where c.id = any(coalesce(_auth_candidates, '{}'::uuid[]))
     and public.listener_serves_destination(_dev.id, c.ecosystem_id, c.method_id);

  if _candidates is null or array_length(_candidates, 1) = 0 then
    if _auth_candidates is not null and array_length(_auth_candidates, 1) > 0 then
      update public.listener_events
         set match_result = 'wrong_shop', review_state = 'pending'
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
    _note := 'Informational: GCash reported a different or masked receiving number than the shop''s '
          || 'configured number. This does not affect authentication and did not block matching.';
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
  _result := public.try_auto_approve_cash_in(_target);
  update public.listener_events set match_result = 'matched:' || _result where id = _ev.id;
  return _result;
end $function$;

create or replace function public.link_cash_in_listener_event(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _tol numeric; _recv text;
        _cands uuid[]; _ev uuid; _request_sender_key text;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;
  if _row.listener_event_id is not null then return 'already_linked'; end if;

  _recv := public.normalize_ph_mobile(
             public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _recv is null then return 'no_receiving_number'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  _tol := coalesce(_rule.amount_tolerance_php, 0);
  _request_sender_key := coalesce(
    _row.sender_number_key,
    _row.ocr_sender_number_key,
    _row.payer_number_key,
    (select public.normalize_ph_mobile(p.phone) from public.profiles p where p.id = _row.user_id));
  if coalesce(_rule.layer1_require_sender_number, true) and _request_sender_key is null then
    return 'no_sender_number';
  end if;

  select array_agg(e.id) into _cands
    from public.listener_events e
    join public.listener_devices d on d.id = e.device_id
   where e.outcome = 'accepted'
     and d.status = 'active'
     and e.consumed_cash_in_id is null
     and e.amount_php is not null
     and abs(e.amount_php - _row.amount_php) <= _tol
     and (not coalesce(_rule.layer1_require_sender_number, true)
          or (e.sender_number_key is not null and e.sender_number_key = _request_sender_key))
     and public.listener_serves_destination(d.id, _row.ecosystem_id, _row.method_id)
     and (not coalesce(_rule.layer1_require_time_window, false)
          or coalesce(e.posted_at, e.created_at)
               between _row.created_at - make_interval(mins => d.match_window_minutes)
                   and _row.created_at + make_interval(mins => d.match_window_minutes));

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

revoke all on function public.match_listener_event(uuid) from public, anon, authenticated;
revoke all on function public.link_cash_in_listener_event(uuid) from public, anon;
grant execute on function public.match_listener_event(uuid) to service_role;
grant execute on function public.link_cash_in_listener_event(uuid) to authenticated, service_role;