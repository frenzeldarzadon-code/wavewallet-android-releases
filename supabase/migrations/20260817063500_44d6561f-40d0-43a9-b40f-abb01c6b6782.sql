-- Cash In authentication layers made explicit and configurable.
alter table public.cash_in_auto_rules
  add column if not exists layer1_require_amount boolean not null default true,
  add column if not exists layer1_require_sender_number boolean not null default true,
  add column if not exists layer1_require_time_window boolean not null default false,
  add column if not exists layer2_require_amount_match boolean not null default true,
  add column if not exists layer2_require_sender_match boolean not null default true,
  add column if not exists layer2_require_listener_reference boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_in_auto_rules_amount_always') then
    alter table public.cash_in_auto_rules
      add constraint cash_in_auto_rules_amount_always check (layer1_require_amount);
  end if;
end $$;

drop function if exists public.cash_in_auto_rule(uuid) cascade;
create function public.cash_in_auto_rule(_ecosystem uuid)
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
         r.layer1_require_amount, r.layer1_require_sender_number, r.layer1_require_time_window,
         r.layer2_require_amount_match, r.layer2_require_sender_match, r.layer2_require_listener_reference
    from public.cash_in_auto_rules r
   where r.ecosystem_id is not distinct from _ecosystem
   union all
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         r.expected_amount_php, r.require_listener_match, r.require_receipt_match, r.verification_mode,
         'platform',
         r.layer1_require_amount, r.layer1_require_sender_number, r.layer1_require_time_window,
         r.layer2_require_amount_match, r.layer2_require_sender_match, r.layer2_require_listener_reference
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

  if _ev.reference_key is not null then
    select array_agg(c.id) into _candidates
      from public.cash_in_requests c
     where c.status = 'pending'
       and c.listener_event_id is null
       and (c.payer_reference_key = _ev.reference_key or c.receipt_reference_key = _ev.reference_key)
       and public.listener_serves_destination(_dev.id, c.ecosystem_id, c.method_id);
  end if;

  if _candidates is null or array_length(_candidates, 1) = 0 then
    select array_agg(c.id) into _candidates
      from public.cash_in_requests c
      cross join lateral public.cash_in_auto_rule(c.ecosystem_id) r
     where c.status = 'pending'
       and c.listener_event_id is null
       and abs(c.amount_php - _ev.amount_php) <= coalesce(r.amount_tolerance_php, 0)
       and (not coalesce(r.layer1_require_sender_number, true)
            or (_ev.sender_number_key is not null
                and c.sender_number_key = _ev.sender_number_key))
       and public.listener_serves_destination(_dev.id, c.ecosystem_id, c.method_id)
       and (not coalesce(r.layer1_require_time_window, false)
            or c.created_at
                 between coalesce(_ev.posted_at, _ev.created_at) - make_interval(mins => _dev.match_window_minutes)
                     and coalesce(_ev.posted_at, _ev.created_at) + make_interval(mins => _dev.match_window_minutes));
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

create or replace function public.link_cash_in_listener_event(_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _tol numeric; _recv text;
        _cands uuid[]; _ev uuid;
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
  if coalesce(_rule.layer1_require_sender_number, true) and _row.sender_number_key is null then
    return 'no_sender_number';
  end if;

  select array_agg(e.id) into _cands
    from public.listener_events e
    join public.listener_devices d on d.id = e.device_id
   where e.outcome = 'accepted'
     and e.consumed_cash_in_id is null
     and e.amount_php is not null
     and abs(e.amount_php - _row.amount_php) <= _tol
     and (not coalesce(_rule.layer1_require_sender_number, true)
          or (e.sender_number_key is not null and e.sender_number_key = _row.sender_number_key))
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

  update public.cash_in_requests set listener_event_id = _ev where id = _row.id;
  return 'linked';
end $function$;

create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
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
  if exists (select 1 from public.listener_events e
              where e.reference_key = _row.payer_reference_key
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
    if coalesce(_rule.layer2_require_listener_reference, false)
       and (_ev.reference_key is null
            or _ev.reference_key not in (coalesce(_row.payer_reference_key, ''),
                                         coalesce(_row.receipt_reference_key, ''))) then
      return 'reference_mismatch';
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
        || 'account confirms the amount and the sending number, and the payment reference '
        || 'has never been used before.';
  perform public.approve_cash_in(_row.id, _note, 'automatic');
  return 'approved';
end $function$;

create or replace function public.set_cash_in_auth_fields(
  _ecosystem uuid,
  _layer1_sender boolean default null,
  _layer1_time boolean default null,
  _layer2_amount boolean default null,
  _layer2_sender boolean default null,
  _layer2_listener_reference boolean default null,
  _require_receipt boolean default null)
returns public.cash_in_auto_rules
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.cash_in_auto_rules; _actor uuid := auth.uid();
        _existing public.cash_in_auto_rules;
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can change cash in authentication rules';
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
         layer1_require_time_window = coalesce(_layer1_time, layer1_require_time_window),
         layer2_require_amount_match = coalesce(_layer2_amount, layer2_require_amount_match),
         layer2_require_sender_match = coalesce(_layer2_sender, layer2_require_sender_match),
         layer2_require_listener_reference =
           coalesce(_layer2_listener_reference, layer2_require_listener_reference),
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
            'layer1_require_time_window', _row.layer1_require_time_window,
            'layer2_require_amount_match', _row.layer2_require_amount_match,
            'layer2_require_sender_match', _row.layer2_require_sender_match,
            'layer2_require_listener_reference', _row.layer2_require_listener_reference,
            'require_receipt_match', _row.require_receipt_match,
            'duplicate_reference_protection', 'always on'));
  return _row;
end $function$;

revoke all on function public.set_cash_in_auth_fields(uuid, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_cash_in_auth_fields(uuid, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.recheck_pending_cash_ins()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _e record; _c record;
        _events int := 0; _linked int := 0; _approved int := 0; _results jsonb := '[]'::jsonb; _r text;
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can re-run cash in matching';
  end if;

  for _e in select id from public.listener_events
             where outcome = 'accepted' and consumed_cash_in_id is null
               and created_at > now() - interval '30 days'
             order by created_at loop
    _r := public.match_listener_event(_e.id);
    _events := _events + 1;
    _results := _results || jsonb_build_object('listener_event', _e.id, 'result', _r);
  end loop;

  for _c in select id from public.cash_in_requests
             where status = 'pending' and created_at > now() - interval '30 days'
             order by created_at loop
    if (select listener_event_id from public.cash_in_requests where id = _c.id) is null then
      if public.link_cash_in_listener_event(_c.id) = 'linked' then _linked := _linked + 1; end if;
    end if;
    _r := public.try_auto_approve_cash_in(_c.id);
    if _r = 'approved' then _approved := _approved + 1; end if;
    _results := _results || jsonb_build_object('cash_in', _c.id, 'result', _r);
  end loop;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, _actor, coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Re-ran cash in matching', 'Platform',
          jsonb_build_object('events_checked', _events, 'linked', _linked, 'approved', _approved));

  return jsonb_build_object('events_checked', _events, 'linked', _linked,
                            'approved', _approved, 'details', _results);
end $function$;

revoke all on function public.recheck_pending_cash_ins() from public, anon;
grant execute on function public.recheck_pending_cash_ins() to authenticated;

create or replace function public.cash_in_auto_status()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare _actor uuid := auth.uid();
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can read the cash in matching status';
  end if;
  return jsonb_build_object(
    'platform_rule', (select to_jsonb(r) from public.cash_in_auto_rules r where r.ecosystem_id is null),
    'shop_rules', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('ecosystem_name', e.name)
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
                             and created_at > now() - interval '30 days'),
    'mismatched_devices', coalesce((select jsonb_agg(jsonb_build_object(
          'device_id', d.id, 'label', d.label,
          'device_number', d.receiving_number_key,
          'shop_id', e.id, 'shop_name', e.name,
          'shop_number', public.normalize_ph_mobile(e.cash_in_gcash_number)))
        from public.listener_devices d
        join public.ecosystems e on d.ecosystem_id is null or d.ecosystem_id = e.id
       where d.status = 'active' and d.receiving_number_key is not null
         and nullif(trim(e.cash_in_gcash_number), '') is not null
         and not exists (
           select 1 from public.listener_devices d2
            where d2.status = 'active' and d2.receiving_number_key =
                  public.normalize_ph_mobile(e.cash_in_gcash_number))), '[]'::jsonb)
  );
end $function$;