-- 1. Provider registry -------------------------------------------------------
create table if not exists public.payment_provider_registry (
  id text primary key,
  name text not null,
  packages text[] not null default '{}',
  text_markers text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

grant select on public.payment_provider_registry to authenticated;
grant all on public.payment_provider_registry to service_role;
alter table public.payment_provider_registry enable row level security;

drop policy if exists "Signed-in members can read payment providers" on public.payment_provider_registry;
create policy "Signed-in members can read payment providers"
  on public.payment_provider_registry for select to authenticated using (true);

drop policy if exists "Platform owner manages payment providers" on public.payment_provider_registry;
create policy "Platform owner manages payment providers"
  on public.payment_provider_registry for all to authenticated
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

insert into public.payment_provider_registry (id, name, packages, text_markers)
values ('gcash', 'GCash', array['com.globe.gcash.android'],
        array['gcash', 'express send'])
on conflict (id) do nothing;

create or replace function public.payment_provider_for(_package text, _text text default null)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.id
    from public.payment_provider_registry r
   where r.enabled
     and (
       lower(coalesce(_package, '')) = any (select lower(p) from unnest(r.packages) p)
       or (
         nullif(trim(coalesce(_text, '')), '') is not null
         and exists (select 1 from unnest(r.text_markers) m
                      where lower(_text) like '%' || lower(m) || '%')
       )
     )
   order by (lower(coalesce(_package, '')) = any (select lower(p) from unnest(r.packages) p)) desc,
            r.id
   limit 1
$$;

-- 2. Listener events carry provider + app metadata ---------------------------
alter table public.listener_events
  add column if not exists provider_id text,
  add column if not exists app_label text;

update public.listener_events
   set provider_id = 'gcash'
 where provider_id is null and package_name = 'com.globe.gcash.android';

create index if not exists listener_events_reference_key_idx
  on public.listener_events (reference_key) where reference_key is not null;

-- 3. Platform-wide used-reference record (hash only) -------------------------
create table if not exists public.payment_reference_salt (
  id boolean primary key default true,
  salt text not null default encode(gen_random_bytes(32), 'hex'),
  constraint payment_reference_salt_single check (id)
);
grant all on public.payment_reference_salt to service_role;
alter table public.payment_reference_salt enable row level security;
insert into public.payment_reference_salt (id) values (true) on conflict (id) do nothing;

create or replace function public.payment_reference_hash(_provider text, _key text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when nullif(trim(coalesce(_key, '')), '') is null then null
    else encode(sha256(convert_to(
           (select s.salt from public.payment_reference_salt s where s.id) || '|' ||
           coalesce(nullif(trim(_provider), ''), 'unknown') || '|' ||
           public.normalize_payment_reference(_key), 'utf8')), 'hex')
  end
$$;

create table if not exists public.payment_reference_seen (
  reference_hash text primary key,
  provider_id text,
  cash_in_id uuid references public.cash_in_requests(id) on delete set null,
  ecosystem_id uuid references public.ecosystems(id) on delete set null,
  first_seen_at timestamptz not null default now()
);
grant select on public.payment_reference_seen to authenticated;
grant all on public.payment_reference_seen to service_role;
alter table public.payment_reference_seen enable row level security;

drop policy if exists "Platform owner reads used references" on public.payment_reference_seen;
create policy "Platform owner reads used references"
  on public.payment_reference_seen for select to authenticated
  using (public.is_super_admin(auth.uid()));

/** Records a reference as used platform-wide. Never stores the raw reference. */
create or replace function public.remember_payment_reference(
  _provider text, _key text, _cash_in uuid, _ecosystem uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare _hash text;
begin
  _hash := public.payment_reference_hash(_provider, _key);
  if _hash is null then return null; end if;
  insert into public.payment_reference_seen (reference_hash, provider_id, cash_in_id, ecosystem_id)
  values (_hash, nullif(trim(coalesce(_provider, '')), ''), _cash_in, _ecosystem)
  on conflict (reference_hash) do nothing;
  return _hash;
end $$;

/** True when this reference already settled a DIFFERENT cash in, on any shop. */
create or replace function public.payment_reference_used_elsewhere(
  _cash_in uuid, _provider text, _key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.payment_reference_seen s
     where s.reference_hash = public.payment_reference_hash(_provider, _key)
       and s.cash_in_id is distinct from _cash_in)
$$;

/** Minimum duplicate indicator. Other shops' details stay with the platform owner. */
create or replace function public.cash_in_duplicate_indicator(_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare _row public.cash_in_requests; _seen public.payment_reference_seen; _super boolean;
begin
  select * into _row from public.cash_in_requests where id = _id;
  if _row.id is null then return jsonb_build_object('known', false); end if;
  _super := public.is_super_admin(auth.uid());
  if not _super and not public.is_ecosystem_admin(auth.uid(), _row.ecosystem_id) then
    raise exception 'Not allowed to read this cash in';
  end if;

  select * into _seen from public.payment_reference_seen s
   where s.reference_hash = public.payment_reference_hash(
           'gcash', coalesce(_row.receipt_reference_key, _row.payer_reference_key));

  if _seen.reference_hash is null then return jsonb_build_object('known', false); end if;
  return jsonb_build_object(
    'known', true,
    'used_before', _seen.cash_in_id is distinct from _id,
    'same_shop', _seen.ecosystem_id = _row.ecosystem_id,
    'first_seen_at', case when _super or _seen.ecosystem_id = _row.ecosystem_id
                          then _seen.first_seen_at end,
    'cash_in_id', case when _super or _seen.ecosystem_id = _row.ecosystem_id
                       then _seen.cash_in_id end);
end $$;

-- 4. Independent-signal rule --------------------------------------------------
/**
 * Counts INDEPENDENT pieces of evidence shared by a notification and a Cash In.
 * Signals: reference, sending account, amount. Conflicting references score 0.
 */
create or replace function public.listener_match_signals(
  _ev public.listener_events, _row public.cash_in_requests)
returns integer
language sql
stable
set search_path to 'public'
as $$
  with c as (
    select public.cash_in_sender_key(_row) as sender_key,
           coalesce(_row.receipt_reference_key, _row.payer_reference_key) as ref_key,
           coalesce((select r.amount_tolerance_php
                       from public.cash_in_auto_rule(_row.ecosystem_id) r), 0) as tol
  )
  select case
    when _ev.reference_key is not null and c.ref_key is not null
         and _ev.reference_key <> c.ref_key then 0
    else
      (case when _ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key = c.ref_key then 1 else 0 end)
    + (case when _ev.sender_number_key is not null and c.sender_key is not null
                 and _ev.sender_number_key = c.sender_key then 1 else 0 end)
    + (case when _ev.amount_php is not null
                 and abs(_ev.amount_php - _row.amount_php) <= c.tol then 1 else 0 end)
  end
  from c
$$;

/** True only when at least one non-amount signal agrees (amount alone never matches). */
create or replace function public.listener_has_strong_signal(
  _ev public.listener_events, _row public.cash_in_requests)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select (_ev.reference_key is not null
          and coalesce(_row.receipt_reference_key, _row.payer_reference_key) = _ev.reference_key)
      or (_ev.sender_number_key is not null
          and public.cash_in_sender_key(_row) = _ev.sender_number_key)
$$;

create or replace function public.listener_event_fits_cash_in(
  _ev public.listener_events, _row public.cash_in_requests)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select _ev.outcome = 'accepted'
     and _ev.amount_php is not null
     and public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id)
     and public.listener_match_signals(_ev, _row) >= 2
     and public.listener_has_strong_signal(_ev, _row)
     and coalesce(_ev.posted_at, _ev.created_at)
           between coalesce(_row.receipt_paid_at, _row.paid_at, _row.created_at) - interval '3 days'
               and coalesce(_row.receipt_paid_at, _row.paid_at, _row.created_at) + interval '3 days'
$$;

-- 5. Provider-aware ingest -----------------------------------------------------
create or replace function public.record_listener_event(
  _device uuid, _event_uid text, _package text, _raw_text text default null,
  _amount numeric default null, _sender_number text default null,
  _sender_name text default null, _posted_at timestamptz default null,
  _parser_version text default null, _gcash_reference text default null,
  _provider text default null, _app_label text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _dev public.listener_devices; _row public.listener_events; _outcome text; _match text;
        _fresh boolean := false; _ref text; _ref_key text; _provider_id text;
begin
  select * into _dev from public.listener_devices where id = _device;
  if _dev.id is null then raise exception 'Unknown listener device'; end if;
  if _dev.status = 'revoked' then raise exception 'This listener device was revoked'; end if;
  if nullif(trim(_event_uid), '') is null then raise exception 'event_uid is required'; end if;
  if nullif(trim(coalesce(_package, '')), '') is null then raise exception 'package_name is required'; end if;

  -- Payment-method recognition now happens here, not on the phone. Anything the
  -- registry does not recognise is stored as a non-payment event and can never
  -- be matched to money.
  _provider_id := coalesce(
    (select r.id from public.payment_provider_registry r
      where r.enabled and r.id = nullif(trim(coalesce(_provider, '')), '')),
    public.payment_provider_for(_package, _raw_text));

  _ref := nullif(trim(_gcash_reference), '');
  _ref_key := public.normalize_payment_reference(_ref);
  _outcome := case
    when _provider_id is null then 'non_payment'
    when _amount is null or _amount <= 0 then 'unparsed'
    else 'accepted' end;

  if _provider_id is not null and _ref_key is not null then
    select * into _row from public.listener_events
     where device_id = _device and reference_key = _ref_key;
  end if;

  if _row.id is null then
    insert into public.listener_events (device_id, event_uid, package_name, raw_text, amount_php,
                                        sender_number, sender_number_key, sender_name, posted_at,
                                        parser_version, outcome, gcash_reference, reference_key,
                                        review_state, provider_id, app_label)
    values (_device, trim(_event_uid), trim(_package), nullif(trim(_raw_text), ''),
            case when _outcome = 'accepted' then round(_amount, 2) end,
            nullif(trim(_sender_number), ''), public.normalize_ph_mobile(_sender_number),
            nullif(trim(_sender_name), ''), coalesce(_posted_at, now()),
            nullif(trim(_parser_version), ''), _outcome, _ref, _ref_key,
            case when _outcome = 'non_payment' then 'ignored' else 'pending' end,
            _provider_id, nullif(trim(coalesce(_app_label, '')), ''))
    on conflict (device_id, event_uid) do nothing
    returning * into _row;
  end if;

  if _row.id is null then
    select * into _row from public.listener_events
     where device_id = _device and event_uid = trim(_event_uid);
  else
    _fresh := _row.consumed_cash_in_id is null and _row.match_attempts = 0;
  end if;

  if _row.id is not null and _ref is not null and _row.gcash_reference is null then
    update public.listener_events set gcash_reference = _ref, reference_key = _ref_key
     where id = _row.id;
    _row.gcash_reference := _ref; _row.reference_key := _ref_key;
  end if;

  update public.listener_devices
     set last_seen_at = now(), last_event_at = now(),
         status = case when status = 'pending' then 'active' else status end
   where id = _device;

  if _row.outcome = 'non_payment' then
    return jsonb_build_object('accepted', true, 'event_id', _row.id, 'duplicate', not _fresh,
                              'outcome', 'non_payment', 'match', 'non_payment',
                              'provider', null, 'review_state', _row.review_state);
  end if;

  if _fresh and _row.outcome = 'accepted' then
    _match := public.match_listener_event(_row.id);
  else
    _match := coalesce(_row.match_result, _row.outcome);
  end if;

  select * into _row from public.listener_events where id = _row.id;

  return jsonb_build_object('accepted', true, 'event_id', _row.id, 'duplicate', not _fresh,
                            'outcome', _row.outcome, 'match', _match,
                            'provider', _row.provider_id,
                            'review_state', _row.review_state,
                            'reference', _row.gcash_reference,
                            'cash_in_id', _row.consumed_cash_in_id);
end $function$;

-- 6. Matching uses the signal rule --------------------------------------------
create or replace function public.match_listener_event(_event uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _ev public.listener_events; _dev public.listener_devices;
        _candidates uuid[]; _auth_candidates uuid[]; _target uuid; _result text; _note text;
begin
  select * into _ev from public.listener_events where id = _event for update;
  if _ev.id is null then return 'not_found'; end if;
  if _ev.outcome = 'non_payment' then return 'non_payment'; end if;
  if _ev.outcome <> 'accepted' then return _ev.outcome; end if;
  if _ev.consumed_cash_in_id is not null then return 'already_consumed'; end if;
  if _ev.amount_php is null then return 'unparsed'; end if;
  select * into _dev from public.listener_devices where id = _ev.device_id;
  if _dev.id is null or _dev.status <> 'active' then return 'device_revoked'; end if;

  update public.listener_events
     set match_attempts = match_attempts + 1, last_match_attempt_at = now()
   where id = _ev.id;

  -- Two independent signals minimum, at least one of them not the amount.
  select array_agg(c.id) into _auth_candidates
    from public.cash_in_requests c
   where c.status = 'pending'
     and c.listener_event_id is null
     and public.listener_match_signals(_ev, c) >= 2
     and public.listener_has_strong_signal(_ev, c)
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
    _note := 'Informational: the payment app reported a different or masked receiving number than '
          || 'the shop''s configured number. This does not affect authentication and did not block '
          || 'matching.';
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

-- 7. Approval: platform-wide duplicate record ---------------------------------
create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text; _sender text;
        _ev public.listener_events; _receipt text; _refkey text; _paid timestamptz;
        _provider text;
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

  if coalesce(_rule.layer2_require_sender_match, true) and _sender is null then
    return 'no_sender_number';
  end if;
  if _row.receipt_sender_number_key is not null and _sender is not null
     and _row.receipt_sender_number_key <> _sender then
    return 'number_mismatch';
  end if;

  if _row.listener_event_id is null then
    if coalesce(_rule.require_listener_match, true) then return 'awaiting_listener'; end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    _provider := _ev.provider_id;
    -- Two independent signals, amount alone is never enough.
    if public.listener_match_signals(_ev, _row) < 2
       or not public.listener_has_strong_signal(_ev, _row) then
      return 'insufficient_match_signals';
    end if;
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

  _provider := coalesce(_provider, 'gcash');
  if public.payment_reference_used_elsewhere(_row.id, _provider, _refkey) then
    return 'duplicate_reference';
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

  perform public.remember_payment_reference(_provider, _refkey, _row.id, _row.ecosystem_id);

  _note := 'A payment notification from a paired listener device confirms at least two independent '
        || 'details of this payment, the receipt agrees with it, and its reference has never been '
        || 'used on any shop.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real payment notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                             'listener_event_id', _row.listener_event_id,
                             'provider_id', _provider,
                             'receipt_check', _row.receipt_check,
                             'sender_number_key', _sender));
  return 'approved';
end $function$;

-- 8. Blockers explain the new rules -------------------------------------------
create or replace function public.cash_in_auth_blockers(_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
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
      if public.listener_match_signals(_ev, _row) < 2
         or not public.listener_has_strong_signal(_ev, _row) then
        _out := _out || 'insufficient_match_signals'::text;
      end if;
      if not public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id) then
        _out := _out || 'wrong_shop'::text;
      end if;
    end if;
  end if;

  if coalesce(_row.duplicate_reference, false)
     or public.cash_in_reference_duplicate(_row.id,
          coalesce(_row.receipt_reference_key, _row.payer_reference_key),
          coalesce(_row.receipt_paid_at, _row.paid_at)) is not null
     or public.payment_reference_used_elsewhere(_row.id,
          coalesce((select e.provider_id from public.listener_events e
                     where e.id = _row.listener_event_id), 'gcash'),
          coalesce(_row.receipt_reference_key, _row.payer_reference_key)) then
    _out := _out || 'duplicate_reference'::text;
  end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    _out := _out || 'above_auto_limit'::text;
  end if;
  return _out;
end $function$;
