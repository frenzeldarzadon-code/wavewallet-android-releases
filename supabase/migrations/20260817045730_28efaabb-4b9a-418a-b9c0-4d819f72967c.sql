create or replace function public.match_listener_event(_event uuid)
returns text
language plpgsql security definer set search_path to 'public'
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

  update public.listener_events
     set match_attempts = match_attempts + 1, last_match_attempt_at = now()
   where id = _ev.id;

  if _dev.receiving_number_key is null then
    update public.listener_events
       set match_result = 'device_without_receiving_number', review_state = 'pending'
     where id = _ev.id;
    return 'device_without_receiving_number';
  end if;

  -- (a) Exact reference match on a pending Cash In for a shop this phone serves.
  if _ev.reference_key is not null then
    select array_agg(c.id) into _candidates
      from public.cash_in_requests c
     where c.status = 'pending'
       and c.listener_event_id is null
       and (c.payer_reference_key = _ev.reference_key or c.receipt_reference_key = _ev.reference_key)
       and public.listener_serves_destination(_dev.id, c.ecosystem_id, c.method_id);
  end if;

  -- (b) Amount inside the match window; a declared sending number must agree.
  if _candidates is null or array_length(_candidates, 1) = 0 then
    select array_agg(c.id) into _candidates
      from public.cash_in_requests c
     where c.status = 'pending'
       and c.listener_event_id is null
       and (c.sender_number_key is null or _ev.sender_number_key is null
            or c.sender_number_key = _ev.sender_number_key)
       and abs(c.amount_php - _ev.amount_php)
             <= coalesce((select r.amount_tolerance_php
                            from public.cash_in_auto_rule(c.ecosystem_id) r), 0)
       and public.listener_serves_destination(_dev.id, c.ecosystem_id, c.method_id)
       and c.created_at
             between coalesce(_ev.posted_at, _ev.created_at) - make_interval(mins => _dev.match_window_minutes)
                 and coalesce(_ev.posted_at, _ev.created_at) + make_interval(mins => _dev.match_window_minutes);
  end if;

  if _candidates is null or array_length(_candidates, 1) = 0 then
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
  update public.cash_in_requests set listener_event_id = _ev.id
   where id = _target and listener_event_id is null;
  if not found then
    update public.listener_events set match_result = 'no_pending_match', review_state = 'pending'
     where id = _ev.id;
    return 'no_pending_match';
  end if;
  update public.listener_events
     set consumed_cash_in_id = _target, match_result = 'matched', review_state = 'matched'
   where id = _ev.id and consumed_cash_in_id is null;
  _result := public.try_auto_approve_cash_in(_target);
  update public.listener_events set match_result = 'matched:' || _result where id = _ev.id;
  return _result;
end $function$;