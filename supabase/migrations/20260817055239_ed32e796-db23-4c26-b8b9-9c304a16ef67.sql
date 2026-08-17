-- Manual GCash payment recovery -------------------------------------------------
alter table public.listener_events
  add column if not exists source text not null default 'listener',
  add column if not exists recorded_by uuid references auth.users(id);

alter table public.listener_events drop constraint if exists listener_events_source_check;
alter table public.listener_events
  add constraint listener_events_source_check check (source in ('listener','manual_recovery'));

create unique index if not exists listener_events_manual_reference_uniq
  on public.listener_events (reference_key)
  where source = 'manual_recovery' and reference_key is not null;

-- Fix the audit writes on the existing review actions (wrong column names).
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

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_c.ecosystem_id, _actor,
          coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Linked incoming GCash payment to a Cash In', _ev.id::text,
          jsonb_build_object('cash_in_id', _c.id, 'amount_php', _ev.amount_php,
                             'gcash_reference', _ev.gcash_reference, 'note', _note,
                             'source', _ev.source));

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
  insert into public.audit_logs (actor_id, actor_name, action, target, metadata)
  values (_actor, coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Set aside an incoming GCash payment', _ev.id::text,
          jsonb_build_object('note', _note, 'amount_php', _ev.amount_php,
                             'gcash_reference', _ev.gcash_reference, 'source', _ev.source));
  return jsonb_build_object('dismissed', true, 'event_id', _ev.id);
end $function$;

-- Recovery: store a real payment a phone never captured. Evidence only.
create or replace function public.record_manual_gcash_payment(
  _amount numeric,
  _reference text,
  _received_at timestamptz,
  _receiving_number text,
  _ecosystem uuid default null,
  _sender_number text default null,
  _sender_name text default null,
  _note text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _ref text; _ref_key text; _recv_key text;
        _sender_key text; _device public.listener_devices; _row public.listener_events;
        _clash public.listener_events; _eco_name text;
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can record a missed GCash payment';
  end if;

  if _amount is null or _amount <= 0 then
    raise exception 'Enter the amount received, greater than zero';
  end if;
  _ref := nullif(trim(_reference), '');
  if _ref is null then
    raise exception 'A GCash reference number is required to recover a payment';
  end if;
  _ref_key := public.normalize_payment_reference(_ref);
  if _ref_key is null then
    raise exception 'That GCash reference is not readable';
  end if;
  if _received_at is null then
    raise exception 'Enter the date and time the payment was received';
  end if;
  if _received_at > now() + interval '10 minutes' then
    raise exception 'The received date and time cannot be in the future';
  end if;

  _recv_key := public.normalize_ph_mobile(_receiving_number);
  if _recv_key is null then
    raise exception 'Enter the receiving GCash number that got the payment';
  end if;
  if nullif(trim(_sender_number), '') is not null then
    _sender_key := public.normalize_ph_mobile(_sender_number);
    if _sender_key is null then
      raise exception 'The sender number is not a valid Philippine mobile number';
    end if;
  end if;

  if _ecosystem is not null then
    select e.name into _eco_name from public.ecosystems e where e.id = _ecosystem;
    if _eco_name is null then raise exception 'That shop no longer exists'; end if;
    if public.normalize_ph_mobile(public.cash_in_receiving_number(_ecosystem, null))
         is distinct from _recv_key then
      raise exception 'That receiving GCash number is not the Cash In number of %', _eco_name;
    end if;
  end if;

  -- Duplicate / conflict protection on the reference.
  select * into _clash from public.listener_events
   where reference_key = _ref_key
   order by created_at limit 1;
  if _clash.id is not null then
    if _clash.source = 'manual_recovery' then
      raise exception 'Reference % was already recovered manually on %',
        _ref, to_char(_clash.created_at, 'DD Mon YYYY HH24:MI');
    end if;
    raise exception 'Reference % was already captured by a paired phone (%). Review it in the incoming payments list instead.',
      _ref, _clash.review_state;
  end if;
  if exists (select 1 from public.verified_payments v where v.payer_reference_key = _ref_key) then
    raise exception 'Reference % is already recorded as a verified payment', _ref;
  end if;

  -- A dedicated, unpairable device row per receiving number keeps the queue,
  -- shop scoping and matching helpers working unchanged.
  select * into _device from public.listener_devices
   where owner_role = 'platform' and package_name = 'manual.recovery'
     and receiving_number_key = _recv_key
     and ecosystem_id is not distinct from _ecosystem
     and status <> 'revoked'
   limit 1;
  if _device.id is null then
    insert into public.listener_devices (label, ecosystem_id, secret_key_hash, status, package_name,
                                         match_window_minutes, offline_after_minutes, created_by,
                                         receiving_number, receiving_number_key, owner_role,
                                         last_seen_at)
    values ('Manual recovery · ' || _recv_key, _ecosystem,
            encode(extensions.gen_random_bytes(32), 'hex'), 'active', 'manual.recovery',
            60, 15, _actor, nullif(trim(_receiving_number), ''), _recv_key, 'platform', now())
    returning * into _device;
  end if;

  insert into public.listener_events (device_id, event_uid, package_name, raw_text, amount_php,
                                      sender_number, sender_number_key, sender_name, posted_at,
                                      parser_version, outcome, gcash_reference, reference_key,
                                      review_state, source, recorded_by, match_result, review_note)
  values (_device.id, 'manual:' || _ref_key, 'manual.recovery', nullif(trim(_note), ''),
          round(_amount, 2), nullif(trim(_sender_number), ''), _sender_key,
          nullif(trim(_sender_name), ''), _received_at, 'manual', 'accepted', _ref, _ref_key,
          'pending', 'manual_recovery', _actor, 'manual_recovery', nullif(trim(_note), ''))
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor,
          coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Recorded a missed GCash payment for review', _ref,
          jsonb_build_object('event_id', _row.id, 'amount_php', round(_amount, 2),
                             'gcash_reference', _ref, 'received_at', _received_at,
                             'receiving_number', _receiving_number, 'ecosystem_id', _ecosystem,
                             'sender_number', _sender_number, 'sender_name', _sender_name,
                             'note', _note, 'credited', false));

  -- Nothing is credited and nothing is approved: the payment simply becomes
  -- visible in the incoming payments review queue.
  return jsonb_build_object('recorded', true, 'event_id', _row.id, 'device_id', _device.id,
                            'gcash_reference', _ref, 'amount_php', round(_amount, 2),
                            'review_state', 'pending', 'credited', false);
end $function$;

revoke all on function public.record_manual_gcash_payment(numeric, text, timestamptz, text, uuid, text, text, text) from anon, public;
grant execute on function public.record_manual_gcash_payment(numeric, text, timestamptz, text, uuid, text, text, text) to authenticated;