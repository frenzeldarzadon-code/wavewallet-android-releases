
alter table public.listener_devices
  add column if not exists receiving_number text,
  add column if not exists receiving_number_key text,
  add column if not exists owner_role text not null default 'platform';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'listener_devices_owner_role_check') then
    alter table public.listener_devices
      add constraint listener_devices_owner_role_check check (owner_role in ('platform','admin'));
  end if;
end $$;

update public.listener_devices d
   set receiving_number = coalesce(
         (select nullif(trim(e.cash_in_gcash_number), '') from public.ecosystems e where e.id = d.ecosystem_id),
         (select nullif(trim(e2.cash_in_gcash_number), '')
            from public.listener_events v
            join public.cash_in_requests c on c.id = v.consumed_cash_in_id
            join public.ecosystems e2 on e2.id = c.ecosystem_id
           where v.device_id = d.id
           order by v.created_at desc limit 1),
         (select min(nullif(trim(e3.cash_in_gcash_number), '')) from public.ecosystems e3
           where nullif(trim(e3.cash_in_gcash_number), '') is not null
           having count(distinct nullif(trim(e3.cash_in_gcash_number), '')) = 1)
       )
 where d.receiving_number is null;

update public.listener_devices
   set receiving_number_key = public.normalize_ph_mobile(receiving_number)
 where receiving_number is not null and receiving_number_key is null;

update public.listener_devices set owner_role = 'admin' where ecosystem_id is not null;

create index if not exists listener_devices_receiving_idx
  on public.listener_devices (receiving_number_key, status);

create or replace function public.listener_serves_destination(_device uuid, _ecosystem uuid, _method uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.listener_devices d
     where d.id = _device
       and d.status <> 'revoked'
       and (d.ecosystem_id is null or d.ecosystem_id = _ecosystem)
       and d.receiving_number_key is not null
       and d.receiving_number_key
             = public.normalize_ph_mobile(public.cash_in_receiving_number(_ecosystem, _method))
  )
$function$;

alter table public.cash_in_auto_rules
  add column if not exists verification_mode text not null default 'active',
  add column if not exists require_receipt_match boolean not null default true;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cash_in_auto_rules_mode_check') then
    alter table public.cash_in_auto_rules
      add constraint cash_in_auto_rules_mode_check check (verification_mode in ('staged','active'));
  end if;
end $$;

alter table public.cash_in_requests
  add column if not exists staged_result text,
  add column if not exists staged_at timestamptz;

drop function if exists public.cash_in_auto_rule(uuid);
create function public.cash_in_auto_rule(_ecosystem uuid)
 returns table(enabled boolean, require_reference_match boolean, amount_tolerance_php numeric,
               max_auto_amount_php numeric, expected_amount_php numeric, require_listener_match boolean,
               require_receipt_match boolean, verification_mode text, scope text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         r.expected_amount_php, r.require_listener_match, r.require_receipt_match, r.verification_mode,
         case when r.ecosystem_id is null then 'platform' else 'shop' end
    from public.cash_in_auto_rules r
   where r.ecosystem_id is not distinct from _ecosystem
   union all
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         r.expected_amount_php, r.require_listener_match, r.require_receipt_match, r.verification_mode,
         'platform'
    from public.cash_in_auto_rules r
   where r.ecosystem_id is null
     and _ecosystem is not null
     and not exists (select 1 from public.cash_in_auto_rules s where s.ecosystem_id = _ecosystem)
   union all
  select false, true, 0::numeric, null::numeric, null::numeric, true, true, 'active', 'default'
   where not exists (select 1 from public.cash_in_auto_rules)
   limit 1
$function$;

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
  if _dev.receiving_number_key is null then
    update public.listener_events set match_result = 'device_without_receiving_number' where id = _ev.id;
    return 'device_without_receiving_number';
  end if;

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

  if _candidates is null or array_length(_candidates, 1) = 0 then
    update public.listener_events set match_result = 'no_pending_match' where id = _ev.id;
    return 'no_pending_match';
  end if;
  if array_length(_candidates, 1) > 1 then
    update public.listener_events set match_result = 'ambiguous' where id = _ev.id;
    return 'ambiguous';
  end if;

  _target := _candidates[1];
  update public.cash_in_requests set listener_event_id = _ev.id
   where id = _target and listener_event_id is null;
  if not found then
    update public.listener_events set match_result = 'no_pending_match' where id = _ev.id;
    return 'no_pending_match';
  end if;
  update public.listener_events set consumed_cash_in_id = _target, match_result = 'matched'
   where id = _ev.id and consumed_cash_in_id is null;
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
     and public.listener_serves_destination(d.id, _row.ecosystem_id, _row.method_id)
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

create or replace function public.try_auto_approve_cash_in(_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text;
        _ev public.listener_events; _receipt text;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then return 'disabled'; end if;
  if _row.payer_reference_key is null then return 'no_reference'; end if;
  if _row.proof_path is null then return 'no_proof'; end if;
  if _row.duplicate_reference
     or exists (select 1 from public.cash_in_requests c
                 where c.payer_reference_key = _row.payer_reference_key and c.id <> _row.id) then
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
  if _row.sender_number_key is null then return 'no_sender_number'; end if;

  if _row.listener_event_id is null then
    if coalesce(_rule.require_listener_match, true) then return 'awaiting_listener'; end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    if _ev.sender_number_key is null or _ev.sender_number_key <> _row.sender_number_key then
      return 'number_mismatch';
    end if;
    if _ev.amount_php is null
       or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
      return 'amount_mismatch';
    end if;
    if not public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id) then
      return 'wrong_destination';
    end if;
    if not exists (select 1 from public.listener_devices d
                    where d.id = _ev.device_id and d.status = 'active'
                      and d.last_seen_at is not null
                      and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes)) then
      return 'listener_offline';
    end if;
  end if;

  _receipt := coalesce(_row.receipt_check, 'pending');
  if _receipt = 'mismatch' then return 'receipt_reference_mismatch'; end if;
  if coalesce(_rule.require_receipt_match, true) then
    if _receipt in ('unreadable', 'error') then return 'receipt_unreadable'; end if;
    if _receipt <> 'matched' then return 'awaiting_receipt_check'; end if;
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
                               'receipt_check', _row.receipt_check));
    return 'staged';
  end if;

  _note := 'A GCash notification from the paired listener device on the shop''s receiving '
        || 'account confirms the amount and the sending number, the reference read from the '
        || 'uploaded receipt matches the reference the member submitted, and that reference '
        || 'had never been used. GCash itself was not contacted.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real GCash notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'cash_in_id', _row.id,
                             'amount_php', _row.amount_php, 'credits', _row.credits,
                             'approval_method', 'automatic', 'matching_result', 'matched',
                             'listener_event_id', _row.listener_event_id,
                             'payer_reference', _row.payer_reference,
                             'receipt_reference', _row.receipt_reference,
                             'requester_id', _row.user_id, 'ecosystem_id', _row.ecosystem_id));
  return 'approved';
end $function$;

drop function if exists public.register_listener_device(text, uuid, integer, integer, text);
create function public.register_listener_device(_label text, _ecosystem uuid DEFAULT NULL::uuid,
  _window_minutes integer DEFAULT 60, _offline_minutes integer DEFAULT 15,
  _package text DEFAULT 'com.globe.gcash.android'::text, _receiving_number text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _secret text; _row public.listener_devices;
        _super boolean; _number text; _key text; _owner text;
begin
  _super := public.is_super_admin(_actor);
  if not (_super or (_ecosystem is not null and public.is_ecosystem_admin(_actor, _ecosystem))) then
    raise exception 'You cannot pair a listener device for this shop';
  end if;
  _owner := case when _ecosystem is null then 'platform' else 'admin' end;

  if nullif(trim(_label), '') is null then raise exception 'Give the device a name'; end if;

  _number := coalesce(
    nullif(trim(_receiving_number), ''),
    (select nullif(trim(e.cash_in_gcash_number), '') from public.ecosystems e where e.id = _ecosystem));
  _key := public.normalize_ph_mobile(_number);
  if _key is null then
    raise exception 'Set the receiving GCash number this phone monitors before pairing it';
  end if;

  if not _super
     and _key is distinct from public.normalize_ph_mobile(
           (select e.cash_in_gcash_number from public.ecosystems e where e.id = _ecosystem)) then
    raise exception 'This phone must monitor the receiving GCash number configured for your shop';
  end if;

  _secret := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.listener_devices (label, ecosystem_id, secret_key_hash, status, package_name,
                                       match_window_minutes, offline_after_minutes, created_by,
                                       receiving_number, receiving_number_key, owner_role)
  values (trim(_label), _ecosystem,
          encode(extensions.digest(_secret, 'sha256'), 'hex'), 'pending',
          coalesce(nullif(trim(_package), ''), 'com.globe.gcash.android'),
          greatest(coalesce(_window_minutes, 60), 1),
          greatest(coalesce(_offline_minutes, 15), 1), _actor,
          _number, _key, _owner)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor, coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Registered GCash listener device', _row.label,
          jsonb_build_object('device_id', _row.id, 'ecosystem_id', _ecosystem,
                             'owner_role', _owner, 'receiving_number', _number));
  return jsonb_build_object('device_id', _row.id, 'label', _row.label,
                            'pairing_secret', _secret, 'package_name', _row.package_name,
                            'receiving_number', _row.receiving_number);
end $function$;

create or replace function public.revoke_listener_device(_device uuid)
 returns listener_devices
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _row public.listener_devices; _dev public.listener_devices;
begin
  select * into _dev from public.listener_devices where id = _device;
  if _dev.id is null then raise exception 'Listener device not found'; end if;
  if not (public.is_super_admin(_actor)
          or (_dev.ecosystem_id is not null and public.is_ecosystem_admin(_actor, _dev.ecosystem_id))) then
    raise exception 'You cannot revoke this listener device';
  end if;
  update public.listener_devices
     set status = 'revoked', revoked_at = now(), revoked_by = _actor
   where id = _device returning * into _row;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, _actor,
          coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Revoked GCash listener device', _row.label, jsonb_build_object('device_id', _row.id));
  return _row;
end $function$;

create or replace function public.listener_device_status()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _super boolean;
begin
  _super := public.is_super_admin(_actor);
  if not _super and not exists (
      select 1 from public.ecosystem_memberships m
       where m.user_id = _actor and m.role = 'admin' and m.membership_state = 'active'
         and m.status = 'active')
     and not exists (
      select 1 from public.user_roles r where r.user_id = _actor and r.role = 'admin') then
    raise exception 'Only the platform owner or a shop admin can read listener device status';
  end if;
  return jsonb_build_object(
    'devices', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'label', d.label, 'status', d.status,
        'ecosystem_id', d.ecosystem_id, 'ecosystem_name', e.name,
        'package_name', d.package_name,
        'owner_role', d.owner_role,
        'receiving_number', d.receiving_number,
        'match_window_minutes', d.match_window_minutes,
        'offline_after_minutes', d.offline_after_minutes,
        'created_at', d.created_at, 'last_seen_at', d.last_seen_at,
        'last_event_at', d.last_event_at, 'revoked_at', d.revoked_at,
        'online', d.status = 'active' and d.last_seen_at is not null
                  and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes),
        'shops_served', (select count(*) from public.ecosystems s
                          where d.receiving_number_key is not null
                            and public.normalize_ph_mobile(s.cash_in_gcash_number) = d.receiving_number_key
                            and (d.ecosystem_id is null or s.id = d.ecosystem_id)),
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
      from public.listener_devices d left join public.ecosystems e on e.id = d.ecosystem_id
     where _super or (d.ecosystem_id is not null and public.is_ecosystem_admin(_actor, d.ecosystem_id))),
      '[]'::jsonb),
    'recent_events', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', v.id, 'device_id', v.device_id, 'outcome', v.outcome,
                                  'match_result', v.match_result, 'amount_php', v.amount_php,
                                  'sender_number', v.sender_number, 'sender_name', v.sender_name,
                                  'posted_at', v.posted_at, 'created_at', v.created_at,
                                  'consumed_cash_in_id', v.consumed_cash_in_id) as x
          from public.listener_events v
          join public.listener_devices d on d.id = v.device_id
         where _super or (d.ecosystem_id is not null and public.is_ecosystem_admin(_actor, d.ecosystem_id))
         order by v.created_at desc limit 20) s), '[]'::jsonb)
  );
end $function$;

drop function if exists public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric, numeric, boolean);
create function public.set_cash_in_auto_approval(_ecosystem uuid, _enabled boolean,
  _require_reference boolean DEFAULT true, _tolerance numeric DEFAULT 0,
  _max_amount numeric DEFAULT NULL::numeric, _expected_amount numeric DEFAULT NULL::numeric,
  _require_listener boolean DEFAULT true, _require_receipt boolean DEFAULT NULL::boolean,
  _verification_mode text DEFAULT NULL::text)
 returns cash_in_auto_rules
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _row public.cash_in_auto_rules; _actor uuid := auth.uid(); _super boolean;
        _mode text; _listener boolean; _receipt boolean; _existing public.cash_in_auto_rules;
begin
  _super := public.is_super_admin(_actor);
  if not (_super or (_ecosystem is not null and public.is_ecosystem_admin(_actor, _ecosystem))) then
    raise exception 'You cannot change automatic cash in approval for this shop';
  end if;
  if _tolerance is null or _tolerance < 0 then raise exception 'Amount tolerance cannot be negative'; end if;
  if _verification_mode is not null and _verification_mode not in ('staged','active') then
    raise exception 'Verification mode must be staged or active';
  end if;

  select * into _existing from public.cash_in_auto_rules
   where ecosystem_id is not distinct from _ecosystem;

  if _super then
    _listener := coalesce(_require_listener, true);
    _receipt := coalesce(_require_receipt, _existing.require_receipt_match, true);
    _mode := coalesce(_verification_mode, _existing.verification_mode, 'active');
  else
    _listener := coalesce(_existing.require_listener_match, true);
    _receipt := coalesce(_existing.require_receipt_match, true);
    _mode := coalesce(_existing.verification_mode, 'active');
  end if;

  if _existing.id is not null then
    update public.cash_in_auto_rules
       set enabled = _enabled, require_reference_match = true,
           amount_tolerance_php = _tolerance, max_auto_amount_php = _max_amount,
           expected_amount_php = _expected_amount,
           require_listener_match = _listener,
           require_receipt_match = _receipt,
           verification_mode = _mode,
           updated_by = _actor, updated_at = now()
     where id = _existing.id returning * into _row;
  else
    insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                           amount_tolerance_php, max_auto_amount_php,
                                           expected_amount_php, require_listener_match,
                                           require_receipt_match, verification_mode, updated_by)
    values (_ecosystem, _enabled, true, _tolerance, _max_amount, _expected_amount,
            _listener, _receipt, _mode, _actor)
    returning * into _row;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor, coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          case when _enabled then 'Enabled automatic cash in approval' else 'Disabled automatic cash in approval' end,
          coalesce((select name from public.ecosystems where id = _ecosystem), 'Platform default'),
          jsonb_build_object('amount_tolerance_php', _tolerance, 'max_auto_amount_php', _max_amount,
                             'expected_amount_php', _expected_amount,
                             'require_listener_match', _listener,
                             'require_receipt_match', _receipt,
                             'verification_mode', _mode));
  return _row;
end $function$;

create or replace function public.cash_in_auto_status()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare _actor uuid := auth.uid();
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can read the cash in matching status';
  end if;
  return jsonb_build_object(
    'platform_rule', (select to_jsonb(r) from public.cash_in_auto_rules r where r.ecosystem_id is null),
    'shop_rules', coalesce((select jsonb_agg(jsonb_build_object(
        'ecosystem_id', r.ecosystem_id, 'ecosystem_name', e.name, 'enabled', r.enabled,
        'require_reference_match', r.require_reference_match,
        'require_listener_match', r.require_listener_match,
        'require_receipt_match', r.require_receipt_match,
        'verification_mode', r.verification_mode,
        'amount_tolerance_php', r.amount_tolerance_php, 'max_auto_amount_php', r.max_auto_amount_php,
        'expected_amount_php', r.expected_amount_php)
        order by e.name)
      from public.cash_in_auto_rules r join public.ecosystems e on e.id = r.ecosystem_id), '[]'::jsonb),
    'shops_with_number', (select count(*) from public.ecosystems
                           where nullif(trim(cash_in_gcash_number), '') is not null),
    'shared_numbers', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('number', public.normalize_ph_mobile(cash_in_gcash_number),
                                  'shops', count(*)) as x
          from public.ecosystems
         where nullif(trim(cash_in_gcash_number), '') is not null
         group by public.normalize_ph_mobile(cash_in_gcash_number)
        having count(*) > 1) s), '[]'::jsonb),
    'listener_devices_active', (select count(*) from public.listener_devices where status = 'active'),
    'listener_devices_proven', (select count(*) from public.listener_devices
                                 where status = 'active' and last_event_at is not null),
    'listener_devices_unscoped', (select count(*) from public.listener_devices
                                   where status <> 'revoked' and receiving_number_key is null),
    'listener_matches_30d', (select count(*) from public.listener_events
                              where consumed_cash_in_id is not null
                                and created_at > now() - interval '30 days'),
    'listener_last_event_at', (select max(last_event_at) from public.listener_devices where status = 'active'),
    'staged_30d', (select count(*) from public.cash_in_requests
                    where staged_result is not null and staged_at > now() - interval '30 days'),
    'duplicates_blocked_30d', (select count(*) from public.cash_in_requests
                                where status = 'rejected'
                                  and decision_reason like 'Duplicate payment reference%'
                                  and created_at > now() - interval '30 days'),
    'auto_approved_30d', (select count(*) from public.cash_in_requests
                           where approval_method = 'automatic' and status = 'approved'
                             and reviewed_at > now() - interval '30 days')
  );
end $function$;

revoke execute on function public.listener_serves_destination(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function public.match_listener_event(uuid) from anon, authenticated;
revoke execute on function public.try_auto_approve_cash_in(uuid) from anon, authenticated;
revoke execute on function public.link_cash_in_listener_event(uuid) from anon, authenticated;
revoke execute on function public.cash_in_auto_rule(uuid) from anon;
revoke execute on function public.register_listener_device(text, uuid, integer, integer, text, text) from anon;
revoke execute on function public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric, numeric, boolean, boolean, text) from anon;
grant execute on function public.register_listener_device(text, uuid, integer, integer, text, text) to authenticated;
grant execute on function public.revoke_listener_device(uuid) to authenticated;
grant execute on function public.listener_device_status() to authenticated;
grant execute on function public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric, numeric, boolean, boolean, text) to authenticated;
grant execute on function public.cash_in_auto_status() to authenticated;
