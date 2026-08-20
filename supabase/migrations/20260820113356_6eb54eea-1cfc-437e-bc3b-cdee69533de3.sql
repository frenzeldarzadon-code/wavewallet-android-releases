-- The GCash "money sent" receipt does not print the payer's OWN number, so the
-- payment identity is the sending number stated on the request (or read off the
-- receipt when one is printed). The member's profile phone is never used.
create or replace function public.cash_in_auth_blockers(_id uuid)
returns text[]
language plpgsql stable security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _ev public.listener_events;
        _out text[] := '{}'::text[]; _recv text; _sender text;
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

  _recv := public.normalize_ph_mobile(
             public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _recv is null then _out := _out || 'shop_has_no_receiving_number'::text; end if;
  if _row.receipt_receiving_number_key is not null and _recv is not null
     and _row.receipt_receiving_number_key <> _recv then
    _out := _out || 'receiving_mismatch'::text;
  end if;

  _sender := public.cash_in_sender_key(_row);
  if _sender is null then
    _out := _out || 'missing_sender_number'::text;
  end if;
  if _row.receipt_sender_number_key is not null and _sender is not null
     and _row.receipt_sender_number_key <> _sender then
    _out := _out || 'receipt_sender_mismatch'::text;
  end if;

  if _row.listener_event_id is null then
    if _sender is null then
      _out := _out || 'no_listener_event'::text;
    elsif exists (select 1 from public.listener_events e
                   where e.consumed_cash_in_id is null
                     and e.sender_number_key = _sender and e.outcome = 'accepted') then
      _out := _out || 'listener_amount_or_time_mismatch'::text;
    elsif exists (select 1 from public.listener_events e
                   where e.consumed_cash_in_id is null and e.outcome = 'accepted'
                     and e.amount_php = _row.amount_php) then
      _out := _out || 'listener_sender_mismatch'::text;
    else
      _out := _out || 'no_listener_event'::text;
    end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then
      _out := _out || 'no_listener_event'::text;
    else
      if _sender is not null and _ev.sender_number_key is distinct from _sender then
        _out := _out || 'listener_sender_mismatch'::text;
      end if;
      if _ev.amount_php is null
         or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
        _out := _out || 'listener_amount_mismatch'::text;
      end if;
      if not public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id) then
        _out := _out || 'wrong_shop'::text;
      end if;
    end if;
  end if;

  if coalesce(_row.duplicate_reference, false)
     or public.cash_in_reference_duplicate(_row.id,
          coalesce(_row.receipt_reference_key, _row.payer_reference_key),
          coalesce(_row.receipt_paid_at, _row.paid_at)) is not null then
    _out := _out || 'duplicate_reference'::text;
  end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    _out := _out || 'above_auto_limit'::text;
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
      when 'missing_sender_number' then 'The sending GCash number was not provided on this request'
      when 'receipt_sender_mismatch' then 'The receipt shows a different sending number'
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

create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text; _sender text;
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
  _sender := public.cash_in_sender_key(_row);

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

  -- Payment identity must exist. A clean receipt read is NOT authentication.
  if coalesce(_rule.layer2_require_sender_match, true) and _sender is null then
    return 'no_sender_number';
  end if;
  -- When the receipt does print a sending number it must agree.
  if _row.receipt_sender_number_key is not null and _sender is not null
     and _row.receipt_sender_number_key <> _sender then
    return 'number_mismatch';
  end if;

  if _row.listener_event_id is null then
    if coalesce(_rule.require_listener_match, true) then return 'awaiting_listener'; end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
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
                             and coalesce(receipt_reference_key, payer_reference_key) is not null
                             and coalesce(receipt_paid_at, paid_at) is not null),
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