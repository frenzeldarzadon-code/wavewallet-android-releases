-- GCash notification listener — Phase 1 (backend, device layer, matching).
create table if not exists public.listener_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  ecosystem_id uuid references public.ecosystems(id) on delete cascade,
  secret_key_hash text not null,
  status text not null default 'pending',
  package_name text not null default 'com.globe.gcash.android',
  match_window_minutes integer not null default 60,
  offline_after_minutes integer not null default 15,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_event_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  constraint listener_devices_status_chk check (status in ('pending', 'active', 'revoked'))
);
grant select on public.listener_devices to authenticated;
grant all on public.listener_devices to service_role;
alter table public.listener_devices enable row level security;
drop policy if exists listener_devices_super on public.listener_devices;
create policy listener_devices_super on public.listener_devices
  for select to authenticated using (public.is_super_admin(auth.uid()));

create table if not exists public.listener_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.listener_devices(id) on delete cascade,
  event_uid text not null,
  package_name text,
  raw_text text,
  amount_php numeric(14,2),
  sender_number text,
  sender_number_key text,
  sender_name text,
  posted_at timestamptz,
  parser_version text,
  outcome text not null default 'accepted',
  match_result text,
  consumed_cash_in_id uuid references public.cash_in_requests(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists listener_events_device_uid_uniq
  on public.listener_events (device_id, event_uid);
create unique index if not exists listener_events_consumed_uniq
  on public.listener_events (consumed_cash_in_id) where consumed_cash_in_id is not null;
create index if not exists listener_events_open_idx
  on public.listener_events (outcome, amount_php, posted_at);
grant select on public.listener_events to authenticated;
grant all on public.listener_events to service_role;
alter table public.listener_events enable row level security;
drop policy if exists listener_events_super on public.listener_events;
create policy listener_events_super on public.listener_events
  for select to authenticated using (public.is_super_admin(auth.uid()));

create table if not exists public.listener_nonces (
  device_id uuid not null references public.listener_devices(id) on delete cascade,
  nonce text not null,
  seen_at timestamptz not null default now(),
  primary key (device_id, nonce)
);
grant all on public.listener_nonces to service_role;
alter table public.listener_nonces enable row level security;

alter table public.cash_in_requests
  add column if not exists sender_number text,
  add column if not exists sender_number_key text,
  add column if not exists listener_event_id uuid references public.listener_events(id) on delete set null;
create unique index if not exists cash_in_requests_listener_event_uniq
  on public.cash_in_requests (listener_event_id) where listener_event_id is not null;

alter table public.cash_in_auto_rules
  add column if not exists require_listener_match boolean not null default false;

create or replace function public.register_listener_device(
  _label text, _ecosystem uuid default null, _window_minutes integer default 60,
  _offline_minutes integer default 15, _package text default 'com.globe.gcash.android')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare _actor uuid := auth.uid(); _secret text; _row public.listener_devices;
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can register a listener device';
  end if;
  if nullif(trim(_label), '') is null then raise exception 'Give the device a name'; end if;
  _secret := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.listener_devices (label, ecosystem_id, secret_key_hash, status, package_name,
                                       match_window_minutes, offline_after_minutes, created_by)
  values (trim(_label), _ecosystem,
          encode(extensions.digest(_secret, 'sha256'), 'hex'), 'pending',
          coalesce(nullif(trim(_package), ''), 'com.globe.gcash.android'),
          greatest(coalesce(_window_minutes, 60), 1),
          greatest(coalesce(_offline_minutes, 15), 1), _actor)
  returning * into _row;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor, coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Registered GCash listener device', _row.label,
          jsonb_build_object('device_id', _row.id, 'ecosystem_id', _ecosystem));
  return jsonb_build_object('device_id', _row.id, 'label', _row.label,
                            'pairing_secret', _secret, 'package_name', _row.package_name);
end $$;
revoke all on function public.register_listener_device(text, uuid, integer, integer, text) from public, anon;
grant execute on function public.register_listener_device(text, uuid, integer, integer, text) to authenticated, service_role;

create or replace function public.revoke_listener_device(_device uuid)
returns public.listener_devices
language plpgsql security definer set search_path = public as $$
declare _actor uuid := auth.uid(); _row public.listener_devices;
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can revoke a listener device';
  end if;
  update public.listener_devices
     set status = 'revoked', revoked_at = now(), revoked_by = _actor
   where id = _device returning * into _row;
  if _row.id is null then raise exception 'Listener device not found'; end if;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, _actor,
          coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Revoked GCash listener device', _row.label, jsonb_build_object('device_id', _row.id));
  return _row;
end $$;
revoke all on function public.revoke_listener_device(uuid) from public, anon;
grant execute on function public.revoke_listener_device(uuid) to authenticated, service_role;

create or replace function public.listener_device_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare _actor uuid := auth.uid();
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can read listener device status';
  end if;
  return jsonb_build_object(
    'devices', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'label', d.label, 'status', d.status,
        'ecosystem_id', d.ecosystem_id, 'ecosystem_name', e.name,
        'package_name', d.package_name,
        'match_window_minutes', d.match_window_minutes,
        'offline_after_minutes', d.offline_after_minutes,
        'created_at', d.created_at, 'last_seen_at', d.last_seen_at,
        'last_event_at', d.last_event_at, 'revoked_at', d.revoked_at,
        'online', d.status = 'active' and d.last_seen_at is not null
                  and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes),
        'accepted_events', (select count(*) from public.listener_events v
                             where v.device_id = d.id and v.outcome = 'accepted'),
        'unparsed_events', (select count(*) from public.listener_events v
                             where v.device_id = d.id and v.outcome = 'unparsed'),
        'matched_cash_ins', (select count(*) from public.listener_events v
                              where v.device_id = d.id and v.consumed_cash_in_id is not null),
        'last_match_at', (select max(c.reviewed_at) from public.listener_events v
                            join public.cash_in_requests c on c.id = v.consumed_cash_in_id
                           where v.device_id = d.id))
        order by d.created_at)
      from public.listener_devices d left join public.ecosystems e on e.id = d.ecosystem_id), '[]'::jsonb),
    'recent_events', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', v.id, 'device_id', v.device_id, 'outcome', v.outcome,
                                  'match_result', v.match_result, 'amount_php', v.amount_php,
                                  'sender_number', v.sender_number, 'sender_name', v.sender_name,
                                  'posted_at', v.posted_at, 'created_at', v.created_at,
                                  'consumed_cash_in_id', v.consumed_cash_in_id) as x
          from public.listener_events v order by v.created_at desc limit 20) s), '[]'::jsonb)
  );
end $$;
revoke all on function public.listener_device_status() from public, anon;
grant execute on function public.listener_device_status() to authenticated, service_role;

create or replace function public.listener_heartbeat(_device uuid)
returns public.listener_devices
language plpgsql security definer set search_path = public as $$
declare _row public.listener_devices;
begin
  update public.listener_devices
     set last_seen_at = now(), status = case when status = 'pending' then 'active' else status end
   where id = _device and status <> 'revoked' returning * into _row;
  if _row.id is null then raise exception 'Unknown or revoked listener device'; end if;
  delete from public.listener_nonces where seen_at < now() - interval '30 minutes';
  return _row;
end $$;
revoke all on function public.listener_heartbeat(uuid) from public, anon, authenticated;
grant execute on function public.listener_heartbeat(uuid) to service_role;

drop function if exists public.cash_in_auto_rule(uuid);
create or replace function public.cash_in_auto_rule(_ecosystem uuid)
returns table(enabled boolean, require_reference_match boolean, amount_tolerance_php numeric,
              max_auto_amount_php numeric, expected_amount_php numeric,
              require_listener_match boolean, scope text)
language sql stable security definer set search_path = public as $$
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         r.expected_amount_php, r.require_listener_match,
         case when r.ecosystem_id is null then 'platform' else 'shop' end
    from public.cash_in_auto_rules r
   where r.ecosystem_id is not distinct from _ecosystem
   union all
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         r.expected_amount_php, r.require_listener_match, 'platform'
    from public.cash_in_auto_rules r
   where r.ecosystem_id is null
     and _ecosystem is not null
     and not exists (select 1 from public.cash_in_auto_rules s where s.ecosystem_id = _ecosystem)
   union all
  select false, true, 0::numeric, null::numeric, null::numeric, false, 'default'
   where not exists (select 1 from public.cash_in_auto_rules)
   limit 1
$$;
revoke all on function public.cash_in_auto_rule(uuid) from public, anon;
grant execute on function public.cash_in_auto_rule(uuid) to authenticated, service_role;

create or replace function public.match_listener_event(_event uuid)
returns text
language plpgsql security definer set search_path = public as $$
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

  select array_agg(c.id) into _candidates
    from public.cash_in_requests c
   where c.status = 'pending'
     and c.proof_path is not null
     and c.listener_event_id is null
     and c.amount_php = _ev.amount_php
     and (_dev.ecosystem_id is null or c.ecosystem_id = _dev.ecosystem_id)
     and c.created_at between coalesce(_ev.posted_at, _ev.created_at) - make_interval(mins => _dev.match_window_minutes)
                          and coalesce(_ev.posted_at, _ev.created_at) + make_interval(mins => _dev.match_window_minutes)
     and (_ev.sender_number_key is null or c.sender_number_key is null
          or c.sender_number_key = _ev.sender_number_key);

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
end $$;
revoke all on function public.match_listener_event(uuid) from public, anon, authenticated;
grant execute on function public.match_listener_event(uuid) to service_role;

create or replace function public.record_listener_event(
  _device uuid, _event_uid text, _package text, _raw_text text default null,
  _amount numeric default null, _sender_number text default null, _sender_name text default null,
  _posted_at timestamptz default null, _parser_version text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare _dev public.listener_devices; _row public.listener_events; _outcome text; _match text;
        _fresh boolean := false;
begin
  select * into _dev from public.listener_devices where id = _device;
  if _dev.id is null then raise exception 'Unknown listener device'; end if;
  if _dev.status = 'revoked' then raise exception 'This listener device was revoked'; end if;
  if nullif(trim(_event_uid), '') is null then raise exception 'event_uid is required'; end if;
  if nullif(trim(_package), '') is null or trim(_package) <> _dev.package_name then
    raise exception 'Only % notifications are accepted', _dev.package_name;
  end if;

  _outcome := case when _amount is null or _amount <= 0 then 'unparsed' else 'accepted' end;

  insert into public.listener_events (device_id, event_uid, package_name, raw_text, amount_php,
                                      sender_number, sender_number_key, sender_name, posted_at,
                                      parser_version, outcome)
  values (_device, trim(_event_uid), trim(_package), nullif(trim(_raw_text), ''),
          case when _outcome = 'accepted' then round(_amount, 2) end,
          nullif(trim(_sender_number), ''), public.normalize_ph_mobile(_sender_number),
          nullif(trim(_sender_name), ''), coalesce(_posted_at, now()),
          nullif(trim(_parser_version), ''), _outcome)
  on conflict (device_id, event_uid) do nothing
  returning * into _row;

  if _row.id is null then
    select * into _row from public.listener_events
     where device_id = _device and event_uid = trim(_event_uid);
  else
    _fresh := true;
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

  return jsonb_build_object('accepted', true, 'event_id', _row.id, 'duplicate', not _fresh,
                            'outcome', _row.outcome, 'match', _match,
                            'cash_in_id', (select consumed_cash_in_id from public.listener_events
                                            where id = _row.id));
end $$;
revoke all on function public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text)
  to service_role;

create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare _row public.cash_in_requests; _rule record; _expected text; _note text; _ev public.listener_events;
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

  _expected := public.normalize_ph_mobile(public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _expected is null then return 'no_receiving_number'; end if;
  if _row.payer_number_key is null or _row.payer_number_key <> _expected then
    return 'number_mismatch';
  end if;

  if coalesce(_rule.require_listener_match, false) then
    if _row.listener_event_id is null then return 'awaiting_listener'; end if;
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    if not exists (select 1 from public.listener_devices d
                    where d.id = _ev.device_id and d.status = 'active'
                      and d.last_seen_at is not null
                      and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes)) then
      return 'listener_offline';
    end if;
  end if;

  _note := 'Matched the configured receiving GCash number and a new payment reference. '
        || case when _row.listener_event_id is not null
                then 'A GCash notification from the paired listener device corroborates the amount and sender. '
                else '' end
        || 'The screenshot is retained as supporting evidence — GCash itself was not contacted.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched the configured cash in details', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'cash_in_id', _row.id,
                             'amount_php', _row.amount_php, 'credits', _row.credits,
                             'approval_method', 'automatic', 'matching_result', 'matched',
                             'listener_event_id', _row.listener_event_id,
                             'payer_reference', _row.payer_reference,
                             'requester_id', _row.user_id, 'ecosystem_id', _row.ecosystem_id));
  return 'approved';
end $$;
revoke all on function public.try_auto_approve_cash_in(uuid) from public, anon, authenticated;
grant execute on function public.try_auto_approve_cash_in(uuid) to service_role;

drop function if exists public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric, numeric);
create or replace function public.set_cash_in_auto_approval(
  _ecosystem uuid, _enabled boolean, _require_reference boolean default true,
  _tolerance numeric default 0, _max_amount numeric default null,
  _expected_amount numeric default null, _require_listener boolean default false)
returns cash_in_auto_rules
language plpgsql security definer set search_path = public as $$
declare _row public.cash_in_auto_rules; _actor uuid := auth.uid();
begin
  if not (public.is_super_admin(_actor)
          or (_ecosystem is not null and public.is_ecosystem_admin(_actor, _ecosystem))) then
    raise exception 'You cannot change automatic cash in approval for this shop';
  end if;
  if _tolerance is null or _tolerance < 0 then raise exception 'Amount tolerance cannot be negative'; end if;

  if _ecosystem is null then
    update public.cash_in_auto_rules
       set enabled = _enabled, require_reference_match = true,
           amount_tolerance_php = _tolerance, max_auto_amount_php = _max_amount,
           expected_amount_php = _expected_amount,
           require_listener_match = coalesce(_require_listener, false),
           updated_by = _actor, updated_at = now()
     where ecosystem_id is null returning * into _row;
    if _row.id is null then
      insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                             amount_tolerance_php, max_auto_amount_php,
                                             expected_amount_php, require_listener_match, updated_by)
      values (null, _enabled, true, _tolerance, _max_amount, _expected_amount,
              coalesce(_require_listener, false), _actor)
      returning * into _row;
    end if;
  else
    update public.cash_in_auto_rules
       set enabled = _enabled, require_reference_match = true,
           amount_tolerance_php = _tolerance, max_auto_amount_php = _max_amount,
           expected_amount_php = _expected_amount,
           require_listener_match = coalesce(_require_listener, false),
           updated_by = _actor, updated_at = now()
     where ecosystem_id = _ecosystem returning * into _row;
    if _row.id is null then
      insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                             amount_tolerance_php, max_auto_amount_php,
                                             expected_amount_php, require_listener_match, updated_by)
      values (_ecosystem, _enabled, true, _tolerance, _max_amount, _expected_amount,
              coalesce(_require_listener, false), _actor)
      returning * into _row;
    end if;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor, coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          case when _enabled then 'Enabled automatic cash in approval' else 'Disabled automatic cash in approval' end,
          coalesce((select name from public.ecosystems where id = _ecosystem), 'Platform default'),
          jsonb_build_object('amount_tolerance_php', _tolerance, 'max_auto_amount_php', _max_amount,
                             'expected_amount_php', _expected_amount,
                             'require_listener_match', coalesce(_require_listener, false)));
  return _row;
end $$;
revoke all on function public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric, numeric, boolean)
  from public, anon;
grant execute on function public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric, numeric, boolean)
  to authenticated, service_role;

create or replace function public.listener_auth_material(_device uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', d.id, 'status', d.status, 'secret_key_hash', d.secret_key_hash,
                            'package_name', d.package_name, 'ecosystem_id', d.ecosystem_id)
    from public.listener_devices d where d.id = _device
$$;
revoke all on function public.listener_auth_material(uuid) from public, anon, authenticated;
grant execute on function public.listener_auth_material(uuid) to service_role;

create or replace function public.listener_claim_nonce(_device uuid, _nonce text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.listener_nonces (device_id, nonce) values (_device, trim(_nonce));
  return true;
exception when unique_violation then
  return false;
end $$;
revoke all on function public.listener_claim_nonce(uuid, text) from public, anon, authenticated;
grant execute on function public.listener_claim_nonce(uuid, text) to service_role;