-- 1. Audit note column for informational destination differences.
alter table public.listener_events
  add column if not exists destination_note text;

comment on column public.listener_events.destination_note is
  'Informational only: records when the receiving GCash number reported by the notification differed from the shop''s configured number. Never blocks matching.';

-- 2. The single authoritative routing rule: shop isolation only.
create or replace function public.listener_serves_destination(_device uuid, _ecosystem uuid, _method uuid)
returns boolean language sql stable security definer set search_path = public as $$
  -- Deprecated behaviour removed: the receiving-number comparison is no longer a
  -- blocking condition, because GCash masks/normalises the receiving number in
  -- its notification text. The only routing rule left is shop isolation.
  select exists (
    select 1 from public.listener_devices d
     where d.id = _device
       and d.status <> 'revoked'
       and (d.ecosystem_id is null or d.ecosystem_id = _ecosystem)
  )
$$;

comment on function public.listener_serves_destination(uuid, uuid, uuid) is
  'Authoritative routing rule for listener matching: a phone bound to one shop may only serve that shop. The receiving-number comparison is deprecated and informational (see listener_receiving_number_matches).';

-- 3. Informational comparison, kept for audit and the settings screen.
create or replace function public.listener_receiving_number_matches(_device uuid, _ecosystem uuid, _method uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.listener_devices d
     where d.id = _device
       and d.receiving_number_key is not null
       and d.receiving_number_key
             = public.normalize_ph_mobile(public.cash_in_receiving_number(_ecosystem, _method))
  )
$$;

revoke all on function public.listener_receiving_number_matches(uuid, uuid, uuid) from anon, authenticated;

-- 4. Matching: never block on a differing receiving number; keep every other safeguard.
create or replace function public.match_listener_event(_event uuid)
returns text language plpgsql security definer set search_path = public as $$
declare _ev public.listener_events; _dev public.listener_devices;
        _candidates uuid[]; _auth_candidates uuid[]; _target uuid; _result text; _note text;
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
      cross join lateral public.cash_in_auto_rule(c.ecosystem_id) r
     where c.status = 'pending'
       and c.listener_event_id is null
       and abs(c.amount_php - _ev.amount_php) <= coalesce(r.amount_tolerance_php, 0)
       and (not coalesce(r.layer1_require_sender_number, true)
            or (_ev.sender_number_key is not null
                and c.sender_number_key = _ev.sender_number_key))
       and (not coalesce(r.layer1_require_time_window, false)
            or c.created_at
                 between coalesce(_ev.posted_at, _ev.created_at) - make_interval(mins => _dev.match_window_minutes)
                     and coalesce(_ev.posted_at, _ev.created_at) + make_interval(mins => _dev.match_window_minutes));
  end if;

  -- Shop isolation only. A differing receiving number is recorded, not blocked.
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
  _result := public.try_auto_approve_cash_in(_target);
  update public.listener_events set match_result = 'matched:' || _result where id = _ev.id;
  return _result;
end $$;

revoke all on function public.match_listener_event(uuid) from anon, authenticated;

-- 5. Approval: same consolidation — shop isolation blocks, receiving number does not.
create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text language plpgsql security definer set search_path = public as $$
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
    -- Shop isolation only; the receiving number itself is informational.
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

  _note := 'A GCash notification from a paired listener device confirms the amount and the sending '
        || 'number, and the payment reference has never been used before.';
  perform public.approve_cash_in(_row.id, _note, 'automatic');
  return 'approved';
end $$;

revoke all on function public.try_auto_approve_cash_in(uuid) from anon, authenticated;

-- 6. Retire the legacy reference-match flag so it cannot be re-enabled by accident.
create or replace function public.retire_legacy_cash_in_flags()
returns trigger language plpgsql set search_path = public as $$
begin
  new.require_reference_match := false;
  return new;
end $$;

drop trigger if exists cash_in_rules_retire_legacy on public.cash_in_auto_rules;
create trigger cash_in_rules_retire_legacy
  before insert or update on public.cash_in_auto_rules
  for each row execute function public.retire_legacy_cash_in_flags();

update public.cash_in_auto_rules set require_reference_match = false where require_reference_match;

comment on column public.cash_in_auto_rules.require_reference_match is
  'Deprecated and always false. Reference uniqueness is enforced unconditionally; this flag is no longer read.';
