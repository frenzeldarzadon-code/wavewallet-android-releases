-- Cash In authentication, rebuilt as the two agreed layers.
alter table public.cash_in_requests
  add column if not exists receipt_receiving_number text,
  add column if not exists receipt_receiving_number_key text;

update public.cash_in_auto_rules
   set layer1_require_time_window = false,
       layer2_require_listener_reference = false
 where layer1_require_time_window or layer2_require_listener_reference;

alter table public.cash_in_auto_rules
  drop constraint if exists cash_in_auto_rules_no_time_layer,
  drop constraint if exists cash_in_auto_rules_no_listener_reference;
alter table public.cash_in_auto_rules
  add constraint cash_in_auto_rules_no_time_layer
    check (layer1_require_time_window is not true),
  add constraint cash_in_auto_rules_no_listener_reference
    check (layer2_require_listener_reference is not true);

alter table public.cash_in_auto_rules
  alter column layer1_require_time_window set default false,
  alter column layer2_require_listener_reference set default false;

create or replace function public.cash_in_auto_rule(_ecosystem uuid)
returns table(enabled boolean, require_reference_match boolean, amount_tolerance_php numeric,
              max_auto_amount_php numeric, expected_amount_php numeric, require_listener_match boolean,
              require_receipt_match boolean, verification_mode text, scope text,
              layer1_require_amount boolean, layer1_require_sender_number boolean,
              layer1_require_time_window boolean, layer2_require_amount_match boolean,
              layer2_require_sender_match boolean, layer2_require_listener_reference boolean)
language sql stable security definer set search_path to 'public'
as $function$
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         r.expected_amount_php, r.require_listener_match, r.require_receipt_match, r.verification_mode,
         case when r.ecosystem_id is null then 'platform' else 'shop' end,
         r.layer1_require_amount, r.layer1_require_sender_number, false,
         r.layer2_require_amount_match, r.layer2_require_sender_match, false
    from public.cash_in_auto_rules r
   where r.ecosystem_id is not distinct from _ecosystem
   union all
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         r.expected_amount_php, r.require_listener_match, r.require_receipt_match, r.verification_mode,
         'platform',
         r.layer1_require_amount, r.layer1_require_sender_number, false,
         r.layer2_require_amount_match, r.layer2_require_sender_match, false
    from public.cash_in_auto_rules r
   where r.ecosystem_id is null
     and _ecosystem is not null
     and not exists (select 1 from public.cash_in_auto_rules s where s.ecosystem_id = _ecosystem)
   union all
  select false, true, 0::numeric, null::numeric, null::numeric, true, true, 'active', 'default',
         true, true, false, true, true, false
   where not exists (select 1 from public.cash_in_auto_rules)
   limit 1
$function$;

create or replace function public.set_cash_in_auth_fields(_ecosystem uuid,
  _layer1_sender boolean default null, _layer1_time boolean default null,
  _layer2_amount boolean default null, _layer2_sender boolean default null,
  _layer2_listener_reference boolean default null, _require_receipt boolean default null)
returns public.cash_in_auto_rules
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.cash_in_auto_rules; _actor uuid := auth.uid();
        _existing public.cash_in_auto_rules;
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can change cash in authentication rules';
  end if;
  if coalesce(_layer1_time, false) then
    raise exception 'Transaction time is not an authentication factor for the GCash notification';
  end if;
  if coalesce(_layer2_listener_reference, false) then
    raise exception 'The GCash notification does not report a reference number';
  end if;

  select * into _existing from public.cash_in_auto_rules
   where ecosystem_id is not distinct from _ecosystem;
  if _existing.id is null then
    insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match, updated_by)
    values (_ecosystem, false, true, _actor)
    returning * into _existing;
  end if;

  update public.cash_in_auto_rules
     set layer1_require_amount = true,
         layer1_require_sender_number = coalesce(_layer1_sender, layer1_require_sender_number),
         layer1_require_time_window = false,
         layer2_require_amount_match = coalesce(_layer2_amount, layer2_require_amount_match),
         layer2_require_sender_match = coalesce(_layer2_sender, layer2_require_sender_match),
         layer2_require_listener_reference = false,
         require_receipt_match = coalesce(_require_receipt, require_receipt_match),
         require_reference_match = true,
         updated_by = _actor, updated_at = now()
   where id = _existing.id
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor,
          coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Changed cash in authentication rules',
          coalesce((select name from public.ecosystems where id = _ecosystem), 'Platform default'),
          jsonb_build_object(
            'layer1_require_amount', true,
            'layer1_require_sender_number', _row.layer1_require_sender_number,
            'layer1_time_window', 'retired',
            'layer2_require_amount_match', _row.layer2_require_amount_match,
            'layer2_require_sender_match', _row.layer2_require_sender_match,
            'layer2_listener_reference', 'retired',
            'require_receipt_match', _row.require_receipt_match,
            'duplicate_reference_protection', 'always on, global across all shops'));
  return _row;
end $function$;

create or replace function public.cash_in_reference_duplicate(_id uuid, _key text,
                                                              _paid_at timestamptz default null)
returns uuid
language sql stable security definer set search_path to 'public'
as $function$
  select c.id
    from public.cash_in_requests c
   where c.id is distinct from _id
     and _key is not null
     and c.status in ('pending','approved')
     and _key in (coalesce(c.payer_reference_key,''), coalesce(c.receipt_reference_key,''))
   order by (_paid_at is not null
             and coalesce(c.receipt_paid_at, c.paid_at) is not null
             and abs(extract(epoch from (coalesce(c.receipt_paid_at, c.paid_at) - _paid_at))) < 120) desc,
            (c.status = 'approved') desc,
            c.created_at asc
   limit 1
$function$;

revoke all on function public.cash_in_reference_duplicate(uuid, text, timestamptz) from public, anon, authenticated;

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
         receipt_sender_number = nullif(btrim(coalesce(_sender, '')), ''),
         receipt_receiving_number = coalesce(receipt_receiving_number,
                                             nullif(btrim(coalesce(_receiving, '')), '')),
         receipt_receiving_number_key = coalesce(receipt_receiving_number_key,
                                                 public.normalize_ph_mobile(_receiving)),
         receipt_paid_at = _paid_at,
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
         set duplicate_reference = true, duplicate_of = _other, decision_reason = _dupe_reason
       where id = _id;
      perform public.record_cash_in_reference_conflict(_id);
      return 'duplicate_reference';
    end if;
    perform public.try_auto_approve_cash_in(_id);
  end if;
  return _state;
end $function$;

create or replace function public.link_cash_in_listener_event(_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
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
     and public.listener_serves_destination(d.id, _row.ecosystem_id, _row.method_id);

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
                    public.normalize_ph_mobile(p.phone))));

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
  if coalesce(_rule.layer2_require_sender_match, true) and _row.sender_number_key is null then
    return 'no_sender_number';
  end if;

  if _row.listener_event_id is null then
    if coalesce(_rule.require_listener_match, true) then return 'awaiting_listener'; end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    if coalesce(_rule.layer2_require_sender_match, true)
       and (_ev.sender_number_key is null or _ev.sender_number_key <> _row.sender_number_key) then
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
  if _row.receipt_sender_number is not null and _row.sender_number_key is not null
     and public.normalize_ph_mobile(_row.receipt_sender_number) is not null
     and public.normalize_ph_mobile(_row.receipt_sender_number) <> _row.sender_number_key then
    return 'number_mismatch';
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

drop function if exists public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb, timestamptz);
revoke all on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb, timestamptz, text)
  to service_role;