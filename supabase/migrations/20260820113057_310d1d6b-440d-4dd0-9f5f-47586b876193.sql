-- GCash Cash In: durable two-layer reconciliation in either arrival order.
alter table public.cash_in_requests
  add column if not exists receipt_sender_number_key text,
  add column if not exists receipt_verified boolean not null default false,
  add column if not exists payment_authenticated boolean not null default false,
  add column if not exists authentication_reason text,
  add column if not exists authentication_checked_at timestamptz;

update public.cash_in_requests
   set receipt_sender_number_key = public.normalize_ph_mobile(receipt_sender_number)
 where receipt_sender_number is not null and receipt_sender_number_key is null;

update public.cash_in_requests
   set receipt_verified = (receipt_check = 'matched' and receipt_sender_number_key is not null),
       payment_authenticated = (status = 'approved')
 where receipt_check = 'matched' or status = 'approved';

create index if not exists cash_in_requests_pending_auth_idx
  on public.cash_in_requests (status, amount_php) where status = 'pending';

create or replace function public.cash_in_sender_key(_row public.cash_in_requests)
returns text
language sql immutable set search_path to 'public'
as $function$
  select coalesce(
    _row.receipt_sender_number_key,
    public.normalize_ph_mobile(_row.receipt_sender_number),
    _row.ocr_sender_number_key,
    _row.sender_number_key,
    _row.payer_number_key)
$function$;

revoke all on function public.cash_in_sender_key(public.cash_in_requests) from public, anon;
grant execute on function public.cash_in_sender_key(public.cash_in_requests) to authenticated, service_role;

create or replace function public.listener_event_fits_cash_in(_ev public.listener_events,
                                                              _row public.cash_in_requests)
returns boolean
language sql stable set search_path to 'public'
as $function$
  select _ev.outcome = 'accepted'
     and _ev.amount_php is not null
     and _ev.sender_number_key is not null
     and public.cash_in_sender_key(_row) is not null
     and _ev.sender_number_key = public.cash_in_sender_key(_row)
     and abs(_ev.amount_php - _row.amount_php)
           <= coalesce((select r.amount_tolerance_php from public.cash_in_auto_rule(_row.ecosystem_id) r), 0)
     and public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id)
     and coalesce(_ev.posted_at, _ev.created_at)
           between coalesce(_row.receipt_paid_at, _row.paid_at, _row.created_at) - interval '3 days'
               and coalesce(_row.receipt_paid_at, _row.paid_at, _row.created_at) + interval '3 days'
$function$;

revoke all on function public.listener_event_fits_cash_in(public.listener_events, public.cash_in_requests)
  from public, anon;
grant execute on function public.listener_event_fits_cash_in(public.listener_events, public.cash_in_requests)
  to authenticated, service_role;

create or replace function public.cash_in_auth_blockers(_id uuid)
returns text[]
language plpgsql stable security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _ev public.listener_events;
        _out text[] := '{}'; _recv text; _sender text;
begin
  select * into _row from public.cash_in_requests where id = _id;
  if _row.id is null then return array['not_found']; end if;
  if _row.status <> 'pending' then return '{}'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then _out := _out || 'automatic_matching_disabled'; end if;
  if _row.proof_path is null then _out := _out || 'no_receipt_uploaded'; end if;

  if coalesce(_row.receipt_check, 'pending') in ('unreadable', 'error') then
    _out := _out || 'receipt_unreadable';
  elsif coalesce(_row.receipt_check, 'pending') = 'mismatch' then
    _out := _out || 'receipt_reference_mismatch';
  elsif coalesce(_row.receipt_check, 'pending') = 'pending' then
    _out := _out || 'receipt_not_read_yet';
  end if;

  if coalesce(_row.receipt_reference_key, _row.payer_reference_key) is null then
    _out := _out || 'missing_reference';
  end if;
  if _row.receipt_sender_number_key is null then _out := _out || 'missing_receipt_sender'; end if;
  if coalesce(_row.receipt_paid_at, _row.paid_at) is null then _out := _out || 'missing_receipt_time'; end if;

  _recv := public.normalize_ph_mobile(
             public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _recv is null then _out := _out || 'shop_has_no_receiving_number'; end if;
  if _row.receipt_receiving_number_key is not null and _recv is not null
     and _row.receipt_receiving_number_key <> _recv then
    _out := _out || 'receiving_mismatch';
  end if;

  _sender := public.cash_in_sender_key(_row);
  if _row.listener_event_id is null then
    if _sender is null then
      _out := _out || 'no_listener_event';
    elsif exists (select 1 from public.listener_events e
                   where e.consumed_cash_in_id is null
                     and e.sender_number_key = _sender and e.outcome = 'accepted') then
      _out := _out || 'listener_amount_or_time_mismatch';
    elsif exists (select 1 from public.listener_events e
                   where e.consumed_cash_in_id is null and e.outcome = 'accepted'
                     and e.amount_php = _row.amount_php) then
      _out := _out || 'listener_sender_mismatch';
    else
      _out := _out || 'no_listener_event';
    end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then
      _out := _out || 'no_listener_event';
    else
      if _row.receipt_sender_number_key is not null
         and _ev.sender_number_key is distinct from _row.receipt_sender_number_key then
        _out := _out || 'listener_sender_mismatch';
      end if;
      if _ev.amount_php is null
         or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
        _out := _out || 'listener_amount_mismatch';
      end if;
      if not public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id) then
        _out := _out || 'wrong_shop';
      end if;
    end if;
  end if;

  if coalesce(_row.duplicate_reference, false)
     or public.cash_in_reference_duplicate(_row.id,
          coalesce(_row.receipt_reference_key, _row.payer_reference_key),
          coalesce(_row.receipt_paid_at, _row.paid_at)) is not null then
    _out := _out || 'duplicate_reference';
  end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    _out := _out || 'above_auto_limit';
  end if;
  return _out;
end $function$;

revoke all on function public.cash_in_auth_blockers(uuid) from public, anon;
grant execute on function public.cash_in_auth_blockers(uuid) to authenticated, service_role;

create or replace function public.cash_in_auth_explain(_codes text[])
returns text
language sql immutable set search_path to 'public'
as $function$
  select nullif(string_agg(t, ' · '), '') from (
    select case c
      when 'not_found' then 'Request not found'
      when 'automatic_matching_disabled' then 'Automatic matching is switched off for this shop'
      when 'no_receipt_uploaded' then 'No payment screenshot was uploaded'
      when 'receipt_unreadable' then 'The receipt could not be read'
      when 'receipt_reference_mismatch' then 'The typed reference does not match the receipt'
      when 'receipt_not_read_yet' then 'The receipt has not been read yet'
      when 'missing_reference' then 'No GCash reference could be established'
      when 'missing_receipt_sender' then 'The sending GCash number is missing from the receipt'
      when 'missing_receipt_time' then 'The receipt transaction date and time is missing'
      when 'shop_has_no_receiving_number' then 'This shop has no receiving GCash number configured'
      when 'receiving_mismatch' then 'The receipt was paid to a different GCash account'
      when 'no_listener_event' then 'No GCash notification has been received for this payment'
      when 'listener_sender_mismatch' then 'The notification came from a different sending number'
      when 'listener_amount_mismatch' then 'The notification amount does not match'
      when 'listener_amount_or_time_mismatch' then 'A notification from that number exists, but the amount or date does not match'
      when 'wrong_shop' then 'The notification arrived on a phone paired to another shop'
      when 'duplicate_reference' then 'That GCash reference was already used on the platform'
      when 'above_auto_limit' then 'The amount is above the automatic approval limit'
      else c end as t
    from unnest(coalesce(_codes, '{}'::text[])) as c) s
$function$;

revoke all on function public.cash_in_auth_explain(text[]) from public, anon;
grant execute on function public.cash_in_auth_explain(text[]) to authenticated, service_role;

create or replace function public.link_cash_in_listener_event(_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _cands uuid[]; _ev uuid; _sender text;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;
  if _row.listener_event_id is not null then return 'already_linked'; end if;

  if public.normalize_ph_mobile(
       public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id)) is null then
    return 'no_receiving_number';
  end if;

  _sender := public.cash_in_sender_key(_row);
  if _sender is null then return 'no_sender_number'; end if;

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

create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text;
        _ev public.listener_events; _receipt text; _refkey text; _paid timestamptz;
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

  if _refkey is null then
    if _receipt in ('unreadable','error') then return 'receipt_unreadable'; end if;
    return 'awaiting_receipt_check';
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

  if coalesce(_rule.layer2_require_sender_match, true)
     and _row.receipt_sender_number_key is null then
    return 'no_receipt_sender_number';
  end if;

  if _row.listener_event_id is null then
    if coalesce(_rule.require_listener_match, true) then return 'awaiting_listener'; end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    if coalesce(_rule.layer2_require_sender_match, true)
       and (_ev.sender_number_key is null
            or _ev.sender_number_key is distinct from _row.receipt_sender_number_key) then
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
  if _row.receipt_receiving_number_key is not null
     and _row.receipt_receiving_number_key <> _recv then
    return 'receiving_mismatch';
  end if;

  if coalesce(_rule.verification_mode, 'active') = 'staged' then
    update public.cash_in_requests
       set staged_result = 'would_approve', staged_at = now()
     where id = _row.id;
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_row.ecosystem_id, null, 'Automatic matching (staged)', 'Cash in would be approved',
            _row.requester_name,
            jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                               'listener_event_id', _row.listener_event_id,
                               'receipt_check', _row.receipt_check,
                               'receipt_paid_at', _row.receipt_paid_at));
    return 'staged';
  end if;

  _note := 'A GCash notification from a paired listener device confirms the amount and the sending '
        || 'number, the receipt agrees with it, and its reference has never been used on any shop.';
  perform public.approve_cash_in(_row.id, _note, 'automatic');
  return 'approved';
end $function$;

create or replace function public.reconcile_cash_in(_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _result text; _codes text[];
begin
  select * into _row from public.cash_in_requests where id = _id;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  if _row.listener_event_id is null then
    perform public.link_cash_in_listener_event(_id);
  end if;

  _result := public.try_auto_approve_cash_in(_id);

  _codes := public.cash_in_auth_blockers(_id);

  update public.cash_in_requests
     set receipt_verified = (receipt_check = 'matched'
                             and receipt_sender_number_key is not null
                             and coalesce(receipt_reference_key, payer_reference_key) is not null),
         payment_authenticated = (status = 'approved'
                                  or (status = 'pending' and coalesce(array_length(_codes, 1), 0) = 0)),
         authentication_reason = case
           when status = 'approved'
             then 'Payment authenticated: the GCash notification, the receipt and the reference all agree'
           else coalesce(public.cash_in_auth_explain(_codes), 'Waiting for automatic approval') end,
         authentication_checked_at = now()
   where id = _id;
  return _result;
end $function$;

revoke all on function public.reconcile_cash_in(uuid) from public, anon;
grant execute on function public.reconcile_cash_in(uuid) to authenticated, service_role;

create or replace function public.match_listener_event(_event uuid)
returns text
language plpgsql security definer set search_path to 'public'
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

  select array_agg(c.id) into _auth_candidates
    from public.cash_in_requests c
   where c.status = 'pending'
     and c.listener_event_id is null
     and public.cash_in_sender_key(c) is not null
     and _ev.sender_number_key = public.cash_in_sender_key(c)
     and abs(c.amount_php - _ev.amount_php)
           <= coalesce((select r.amount_tolerance_php from public.cash_in_auto_rule(c.ecosystem_id) r), 0)
     and coalesce(_ev.posted_at, _ev.created_at)
           between coalesce(c.receipt_paid_at, c.paid_at, c.created_at) - interval '3 days'
               and coalesce(c.receipt_paid_at, c.paid_at, c.created_at) + interval '3 days';

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
  _result := public.reconcile_cash_in(_target);
  update public.listener_events set match_result = 'matched:' || _result where id = _ev.id;
  return _result;
end $function$;

create or replace function public.apply_cash_in_receipt_ocr(_id uuid, _reference text default null,
  _amount numeric default null, _sender text default null, _readable boolean default true,
  _details jsonb default null, _paid_at timestamptz default null, _receiving text default null)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _key text; _state text; _other uuid;
        _dupe_reason constant text :=
          'This GCash reference was already used by another payment on the platform. Held for '
          || 'manual investigation — the earlier transaction was left untouched.';
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  _key := public.normalize_payment_reference(_reference);

  if coalesce(_readable, false) is false or _key is null then
    _state := 'unreadable';
  elsif _row.payer_reference_key is null then
    _state := 'matched';
  elsif _key = _row.payer_reference_key then
    _state := 'matched';
  else
    _state := 'mismatch';
  end if;

  update public.cash_in_requests
     set receipt_reference = nullif(btrim(coalesce(_reference, '')), ''),
         receipt_reference_key = _key,
         receipt_amount_php = _amount,
         receipt_sender_number = coalesce(nullif(btrim(coalesce(_sender, '')), ''),
                                          receipt_sender_number),
         receipt_sender_number_key = coalesce(public.normalize_ph_mobile(_sender),
                                              receipt_sender_number_key),
         receipt_receiving_number = coalesce(receipt_receiving_number,
                                             nullif(btrim(coalesce(_receiving, '')), '')),
         receipt_receiving_number_key = coalesce(receipt_receiving_number_key,
                                                 public.normalize_ph_mobile(_receiving)),
         receipt_paid_at = coalesce(_paid_at, receipt_paid_at),
         receipt_check = _state,
         receipt_checked_at = now(),
         receipt_details = _details,
         ocr_reference = coalesce(ocr_reference, nullif(btrim(coalesce(_reference, '')), '')),
         ocr_reference_key = coalesce(ocr_reference_key, _key),
         ocr_amount_php = coalesce(ocr_amount_php, _amount),
         ocr_sender_number = coalesce(ocr_sender_number, nullif(btrim(coalesce(_sender, '')), '')),
         ocr_sender_number_key = coalesce(ocr_sender_number_key, public.normalize_ph_mobile(_sender)),
         ocr_paid_at = coalesce(ocr_paid_at, _paid_at),
         ocr_details = coalesce(ocr_details, _details),
         paid_at = coalesce(paid_at, _paid_at),
         sender_number = coalesce(sender_number, nullif(btrim(coalesce(_sender, '')), '')),
         sender_number_key = coalesce(sender_number_key, public.normalize_ph_mobile(_sender))
   where id = _id;

  if _state = 'matched' then
    _other := public.cash_in_reference_duplicate(_id, _key, _paid_at);
    if _other is not null and not coalesce(_row.duplicate_reference, false) then
      update public.cash_in_requests
         set duplicate_reference = true, duplicate_of = _other, decision_reason = _dupe_reason,
             authentication_reason = _dupe_reason, authentication_checked_at = now()
       where id = _id;
      perform public.record_cash_in_reference_conflict(_id);
      return 'duplicate_reference';
    end if;
  end if;
  perform public.reconcile_cash_in(_id);
  return _state;
end $function$;

revoke all on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb, timestamptz, text)
  to service_role;

create or replace function public.link_listener_event(_event uuid, _cash_in uuid, _note text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _ev public.listener_events; _c public.cash_in_requests; _result text;
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can link an incoming payment';
  end if;
  select * into _ev from public.listener_events where id = _event for update;
  if _ev.id is null then raise exception 'Incoming payment event not found'; end if;
  if _ev.consumed_cash_in_id is not null then raise exception 'That event is already linked'; end if;
  if _ev.outcome <> 'accepted' then raise exception 'That event has no readable amount'; end if;

  select * into _c from public.cash_in_requests where id = _cash_in for update;
  if _c.id is null then raise exception 'Cash In not found'; end if;
  if _c.status <> 'pending' then raise exception 'That Cash In is no longer pending'; end if;
  if _c.listener_event_id is not null then raise exception 'That Cash In already has a payment event'; end if;

  if not public.listener_event_fits_cash_in(_ev, _c) then
    raise exception 'That payment does not match this Cash In: %',
      coalesce(public.cash_in_auth_explain(public.cash_in_auth_blockers(_c.id)),
               'the sending number, amount, shop or date do not agree');
  end if;

  update public.cash_in_requests set listener_event_id = _ev.id where id = _c.id;
  update public.listener_events
     set consumed_cash_in_id = _c.id, match_result = 'manually_linked', review_state = 'linked',
         reviewed_by = _actor, reviewed_at = now(), review_note = nullif(trim(_note), '')
   where id = _ev.id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_c.ecosystem_id, _actor,
          coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Linked incoming GCash payment to a Cash In', _ev.id::text,
          jsonb_build_object('cash_in_id', _c.id, 'amount_php', _ev.amount_php,
                             'gcash_reference', _ev.gcash_reference, 'note', _note,
                             'source', _ev.source));

  _result := public.reconcile_cash_in(_c.id);
  return jsonb_build_object('linked', true, 'cash_in_id', _c.id, 'event_id', _ev.id,
                            'result', _result);
end $function$;

create or replace function public.reconcile_payments(_days integer default 30)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _id uuid; _res text;
        _cash int := 0; _events int := 0; _approved int := 0;
        _since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 365)));
begin
  if _actor is not null and not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can run payment reconciliation';
  end if;

  for _id in select id from public.cash_in_requests
              where status = 'pending' and created_at >= _since order by created_at loop
    _res := public.reconcile_cash_in(_id);
    _cash := _cash + 1;
    if _res = 'approved' then _approved := _approved + 1; end if;
  end loop;

  for _id in select e.id from public.listener_events e
              join public.listener_devices d on d.id = e.device_id
             where e.consumed_cash_in_id is null and e.outcome = 'accepted'
               and d.status = 'active' and e.created_at >= _since
             order by e.created_at loop
    _res := public.match_listener_event(_id);
    _events := _events + 1;
    if _res = 'approved' then _approved := _approved + 1; end if;
  end loop;

  return jsonb_build_object('cash_ins_checked', _cash, 'events_checked', _events,
                            'approved', _approved, 'since', _since);
end $function$;

revoke all on function public.reconcile_payments(integer) from public, anon;
grant execute on function public.reconcile_payments(integer) to authenticated, service_role;

create or replace function public.cash_in_pending_diagnostics(_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _super boolean := public.is_super_admin(auth.uid());
begin
  if not _super and not exists (
      select 1 from public.ecosystem_memberships m
       where m.user_id = _actor and m.role = 'admin' and m.membership_state = 'active'
         and m.status = 'active') then
    raise exception 'Only the platform owner or a shop admin can read payment diagnostics';
  end if;

  return coalesce((
    select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
               'cash_in_id', c.id,
               'ecosystem_id', c.ecosystem_id,
               'amount_php', c.amount_php,
               'created_at', c.created_at,
               'receipt_verified', c.receipt_verified,
               'payment_authenticated', c.payment_authenticated,
               'listener_event_id', c.listener_event_id,
               'receipt_sender_number', c.receipt_sender_number,
               'receipt_receiving_number', c.receipt_receiving_number,
               'receipt_reference', c.receipt_reference,
               'receipt_paid_at', c.receipt_paid_at,
               'codes', public.cash_in_auth_blockers(c.id),
               'reason', coalesce(c.authentication_reason,
                                  public.cash_in_auth_explain(public.cash_in_auth_blockers(c.id)))) as x
        from public.cash_in_requests c
       where c.status = 'pending'
         and (_super or public.is_ecosystem_admin(_actor, c.ecosystem_id))
       order by c.created_at desc
       limit greatest(1, least(coalesce(_limit, 100), 300))) s), '[]'::jsonb);
end $function$;

revoke all on function public.cash_in_pending_diagnostics(integer) from public, anon;
grant execute on function public.cash_in_pending_diagnostics(integer) to authenticated, service_role;