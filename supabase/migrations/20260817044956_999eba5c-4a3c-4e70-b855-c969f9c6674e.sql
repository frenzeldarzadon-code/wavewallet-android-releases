-- 1. Reference + review state on listener events -------------------------------
alter table public.listener_events
  add column if not exists gcash_reference text,
  add column if not exists reference_key text,
  add column if not exists review_state text not null default 'pending',
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists match_attempts integer not null default 0,
  add column if not exists last_match_attempt_at timestamptz;

alter table public.listener_events
  drop constraint if exists listener_events_review_state_check;
alter table public.listener_events
  add constraint listener_events_review_state_check
  check (review_state in ('pending','matched','linked','dismissed','ignored'));

-- Idempotency by GCash reference: the same payment can never be recorded twice
-- for the same phone, while two genuinely different payments differ in reference.
create unique index if not exists listener_events_device_reference_key
  on public.listener_events (device_id, reference_key)
  where reference_key is not null;

create index if not exists listener_events_review_state_idx
  on public.listener_events (review_state, created_at desc);

update public.listener_events
   set review_state = case when consumed_cash_in_id is not null then 'matched' else 'pending' end
 where review_state = 'pending' and consumed_cash_in_id is not null;

-- 2. Recording: durable first, match second ------------------------------------
create or replace function public.record_listener_event(
  _device uuid, _event_uid text, _package text, _raw_text text default null,
  _amount numeric default null, _sender_number text default null,
  _sender_name text default null, _posted_at timestamptz default null,
  _parser_version text default null, _gcash_reference text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _dev public.listener_devices; _row public.listener_events; _outcome text; _match text;
        _fresh boolean := false; _ref text; _ref_key text;
begin
  select * into _dev from public.listener_devices where id = _device;
  if _dev.id is null then raise exception 'Unknown listener device'; end if;
  if _dev.status = 'revoked' then raise exception 'This listener device was revoked'; end if;
  if nullif(trim(_event_uid), '') is null then raise exception 'event_uid is required'; end if;
  if nullif(trim(_package), '') is null or trim(_package) <> _dev.package_name then
    raise exception 'Only % notifications are accepted', _dev.package_name;
  end if;

  _ref := nullif(trim(_gcash_reference), '');
  _ref_key := public.normalize_payment_reference(_ref);
  _outcome := case when _amount is null or _amount <= 0 then 'unparsed' else 'accepted' end;

  -- Reference is the strongest identity: a re-sent notification with the same
  -- reference resolves to the row already stored instead of a second event.
  if _ref_key is not null then
    select * into _row from public.listener_events
     where device_id = _device and reference_key = _ref_key;
  end if;

  if _row.id is null then
    insert into public.listener_events (device_id, event_uid, package_name, raw_text, amount_php,
                                        sender_number, sender_number_key, sender_name, posted_at,
                                        parser_version, outcome, gcash_reference, reference_key,
                                        review_state)
    values (_device, trim(_event_uid), trim(_package), nullif(trim(_raw_text), ''),
            case when _outcome = 'accepted' then round(_amount, 2) end,
            nullif(trim(_sender_number), ''), public.normalize_ph_mobile(_sender_number),
            nullif(trim(_sender_name), ''), coalesce(_posted_at, now()),
            nullif(trim(_parser_version), ''), _outcome, _ref, _ref_key, 'pending')
    on conflict (device_id, event_uid) do nothing
    returning * into _row;
  end if;

  if _row.id is null then
    select * into _row from public.listener_events
     where device_id = _device and event_uid = trim(_event_uid);
  else
    _fresh := _row.consumed_cash_in_id is null and _row.match_attempts = 0;
  end if;

  -- Backfill a reference learned from a later, richer copy of the same notification.
  if _row.id is not null and _ref is not null and _row.gcash_reference is null then
    update public.listener_events set gcash_reference = _ref, reference_key = _ref_key
     where id = _row.id;
    _row.gcash_reference := _ref; _row.reference_key := _ref_key;
  end if;

  update public.listener_devices
     set last_seen_at = now(), last_event_at = now(),
         status = case when status = 'pending' then 'active' else status end
   where id = _device;

  if _fresh and _row.outcome = 'accepted' then
    _match := public.match_listener_event(_row.id);
  else
    _match := coalesce(_row.match_result, _row.outcome);
  end if;

  select * into _row from public.listener_events where id = _row.id;

  return jsonb_build_object('accepted', true, 'event_id', _row.id, 'duplicate', not _fresh,
                            'outcome', _row.outcome, 'match', _match,
                            'review_state', _row.review_state,
                            'reference', _row.gcash_reference,
                            'cash_in_id', _row.consumed_cash_in_id);
end $function$;

-- 3. Matching: reference first, then sender+amount; never discard ---------------
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

  -- (b) Fall back to sender number + amount inside the device match window.
  if (_candidates is null or array_length(_candidates, 1) = 0) and _ev.sender_number_key is not null then
    select array_agg(c.id) into _candidates
      from public.cash_in_requests c
     where c.status = 'pending'
       and c.listener_event_id is null
       and c.sender_number_key = _ev.sender_number_key
       and abs(c.amount_php - _ev.amount_php)
             <= coalesce((select r.amount_tolerance_php
                            from public.cash_in_auto_rule(c.ecosystem_id) r), 0)
       and public.listener_serves_destination(_dev.id, c.ecosystem_id, c.method_id)
       and c.created_at
             between coalesce(_ev.posted_at, _ev.created_at) - make_interval(mins => _dev.match_window_minutes)
                 and coalesce(_ev.posted_at, _ev.created_at) + make_interval(mins => _dev.match_window_minutes);
  end if;

  if _candidates is null or array_length(_candidates, 1) = 0 then
    -- Nothing to match yet. The money stays visible in the unmatched queue.
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

-- 4. Unmatched queue -----------------------------------------------------------
create or replace function public.listener_unmatched_events(_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _super boolean;
begin
  _super := public.is_super_admin(_actor);
  if not _super and not exists (
      select 1 from public.ecosystem_memberships m
       where m.user_id = _actor and m.role = 'admin' and m.membership_state = 'active'
         and m.status = 'active') then
    raise exception 'Only the platform owner or a shop admin can read incoming payment events';
  end if;

  return coalesce((
    select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
        'id', v.id, 'device_id', v.device_id, 'device_label', d.label,
        'receiving_number', d.receiving_number,
        'ecosystem_id', d.ecosystem_id, 'ecosystem_name', e.name,
        'amount_php', v.amount_php, 'sender_number', v.sender_number,
        'sender_name', v.sender_name, 'gcash_reference', v.gcash_reference,
        'posted_at', v.posted_at, 'created_at', v.created_at,
        'outcome', v.outcome, 'match_result', v.match_result,
        'review_state', v.review_state, 'review_note', v.review_note,
        'raw_text', case when _super then v.raw_text else null end,
        'candidates', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'cash_in_id', c.id, 'reference', c.reference,
                   'amount_php', c.amount_php, 'created_at', c.created_at,
                   'ecosystem_name', ce.name,
                   'member_name', p.full_name, 'member_handle', p.handle)
                 order by c.created_at desc)
            from public.cash_in_requests c
            left join public.ecosystems ce on ce.id = c.ecosystem_id
            left join public.profiles p on p.id = c.user_id
           where c.status = 'pending' and c.listener_event_id is null
             and public.listener_serves_destination(d.id, c.ecosystem_id, c.method_id)), '[]'::jsonb)
      ) as x
        from public.listener_events v
        join public.listener_devices d on d.id = v.device_id
        left join public.ecosystems e on e.id = d.ecosystem_id
       where v.review_state = 'pending'
         and v.consumed_cash_in_id is null
         and (_super or (d.ecosystem_id is not null and public.is_ecosystem_admin(_actor, d.ecosystem_id)))
       order by v.created_at desc
       limit greatest(1, least(coalesce(_limit, 100), 300))) s), '[]'::jsonb);
end $function$;

-- 5. Manual reconciliation -----------------------------------------------------
create or replace function public.link_listener_event(_event uuid, _cash_in uuid, _note text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _ev public.listener_events; _c public.cash_in_requests;
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

  update public.cash_in_requests set listener_event_id = _ev.id where id = _c.id;
  update public.listener_events
     set consumed_cash_in_id = _c.id, match_result = 'manually_linked', review_state = 'linked',
         reviewed_by = _actor, reviewed_at = now(), review_note = nullif(trim(_note), '')
   where id = _ev.id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (_actor, 'listener_event_linked', 'listener_events', _ev.id,
          jsonb_build_object('cash_in_id', _c.id, 'amount_php', _ev.amount_php,
                             'gcash_reference', _ev.gcash_reference, 'note', _note));

  -- Linking is evidence only. The Cash In still goes through normal approval.
  return jsonb_build_object('linked', true, 'cash_in_id', _c.id, 'event_id', _ev.id);
end $function$;

create or replace function public.dismiss_listener_event(_event uuid, _note text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _ev public.listener_events;
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can set aside an incoming payment';
  end if;
  select * into _ev from public.listener_events where id = _event for update;
  if _ev.id is null then raise exception 'Incoming payment event not found'; end if;
  if _ev.consumed_cash_in_id is not null then raise exception 'That event is already linked'; end if;
  update public.listener_events
     set review_state = 'dismissed', reviewed_by = _actor, reviewed_at = now(),
         review_note = nullif(trim(_note), '')
   where id = _ev.id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (_actor, 'listener_event_dismissed', 'listener_events', _ev.id,
          jsonb_build_object('note', _note, 'amount_php', _ev.amount_php));
  return jsonb_build_object('dismissed', true, 'event_id', _ev.id);
end $function$;

-- 6. Self-healing: retry matching for events still waiting ---------------------
create or replace function public.reconcile_listener_events(_max_age_hours integer default 72)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _id uuid; _matched integer := 0; _seen integer := 0;
begin
  for _id in
    select v.id from public.listener_events v
     where v.review_state = 'pending' and v.outcome = 'accepted'
       and v.consumed_cash_in_id is null
       and v.created_at > now() - make_interval(hours => greatest(1, coalesce(_max_age_hours, 72)))
     order by v.created_at
     limit 200
  loop
    _seen := _seen + 1;
    perform public.match_listener_event(_id);
    if exists (select 1 from public.listener_events where id = _id and consumed_cash_in_id is not null)
      then _matched := _matched + 1; end if;
  end loop;
  return jsonb_build_object('checked', _seen, 'matched', _matched);
end $function$;

revoke all on function public.listener_unmatched_events(integer) from anon;
revoke all on function public.link_listener_event(uuid, uuid, text) from anon;
revoke all on function public.dismiss_listener_event(uuid, text) from anon;
revoke all on function public.reconcile_listener_events(integer) from anon, authenticated;
grant execute on function public.listener_unmatched_events(integer) to authenticated;
grant execute on function public.link_listener_event(uuid, uuid, text) to authenticated;
grant execute on function public.dismiss_listener_event(uuid, text) to authenticated;
