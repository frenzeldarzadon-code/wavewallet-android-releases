-- 1. Notifications keep every field that could be read, plus the raw text.
alter table public.listener_events add column if not exists details jsonb;

-- 2. record_listener_event accepts the extracted details (old signature dropped to avoid overload ambiguity)
drop function if exists public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text, text, text, text);

create or replace function public.record_listener_event(
  _device uuid, _event_uid text, _package text, _raw_text text default null, _amount numeric default null,
  _sender_number text default null, _sender_name text default null, _posted_at timestamptz default null,
  _parser_version text default null, _gcash_reference text default null, _provider text default null,
  _app_label text default null, _details jsonb default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _dev public.listener_devices; _row public.listener_events; _outcome text; _match text;
        _fresh boolean := false; _ref text; _ref_key text; _provider_id text;
begin
  select * into _dev from public.listener_devices where id = _device;
  if _dev.id is null then raise exception 'Unknown listener device'; end if;
  if _dev.status = 'revoked' then raise exception 'This listener device was revoked'; end if;
  if nullif(trim(_event_uid), '') is null then raise exception 'event_uid is required'; end if;
  if nullif(trim(coalesce(_package, '')), '') is null then raise exception 'package_name is required'; end if;

  if not public.listener_source_allowed(_device, _package) then
    insert into public.listener_events (device_id, event_uid, package_name, posted_at,
                                        outcome, review_state, app_label)
    values (_device, trim(_event_uid), trim(_package), coalesce(_posted_at, now()),
            'source_disabled', 'ignored', nullif(trim(coalesce(_app_label, '')), ''))
    on conflict (device_id, event_uid) do nothing;

    update public.listener_devices
       set last_seen_at = now(),
           status = case when status = 'pending' then 'active' else status end
     where id = _device;

    return jsonb_build_object('accepted', true, 'outcome', 'source_disabled',
                              'match', 'source_disabled', 'provider', null,
                              'review_state', 'ignored');
  end if;

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
                                        review_state, provider_id, app_label, details)
    values (_device, trim(_event_uid), trim(_package), nullif(trim(_raw_text), ''),
            case when _outcome = 'accepted' then round(_amount, 2) end,
            nullif(trim(_sender_number), ''), public.normalize_ph_mobile(_sender_number),
            nullif(trim(_sender_name), ''), coalesce(_posted_at, now()),
            nullif(trim(_parser_version), ''), _outcome, _ref, _ref_key,
            case when _outcome = 'non_payment' then 'ignored' else 'pending' end,
            _provider_id, nullif(trim(coalesce(_app_label, '')), ''), _details)
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
  if _row.id is not null and _row.details is null and _details is not null then
    update public.listener_events set details = _details where id = _row.id;
    _row.details := _details;
  end if;

  update public.listener_devices
     set last_seen_at = now(), last_event_at = now(),
         status = case when status = 'pending' then 'active' else status end
   where id = _device;

  if _row.outcome in ('non_payment', 'source_disabled') then
    return jsonb_build_object('accepted', true, 'event_id', _row.id, 'duplicate', not _fresh,
                              'outcome', _row.outcome, 'match', _row.outcome,
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
revoke execute on function public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text, text, text, text, jsonb) to service_role;

-- 3. Receiver-side "received by" account: from the notification's own text first,
--    else the registered phone's informational account.
create or replace function public.listener_event_receiving_tail(_ev public.listener_events)
returns text
language sql stable set search_path to 'public'
as $function$
  select coalesce(
    public.payment_account_tail(_ev.details->>'receiving_account'),
    public.payment_account_tail(_ev.details->>'receiving_number'),
    (select public.payment_account_tail(d.receiving_number) from public.listener_devices d where d.id = _ev.device_id))
$function$;

-- Sender-side "sent to" account read off the receipt.
create or replace function public.cash_in_receiving_tail(_row public.cash_in_requests)
returns text
language sql immutable set search_path to 'public'
as $function$
  select coalesce(
    public.payment_account_tail(_row.receipt_receiving_account_masked),
    public.payment_account_tail(_row.receipt_receiving_number))
$function$;

-- 4. Signals. Each category is one independent fact; aliases of the same fact
--    never count twice. Identity categories: reference, sending account
--    (number or masked tail — one category), payer name. Supporting
--    categories: amount, recipient account, payment time. Supporting
--    categories only lift the count when at least one identity category agrees.
create or replace function public.listener_match_signal_details(_ev public.listener_events, _row public.cash_in_requests)
returns jsonb
language sql stable set search_path to 'public'
as $function$
  with c as (
    select public.cash_in_sender_key(_row) as sender_key,
           coalesce(_row.receipt_reference_key, _row.payer_reference_key) as ref_key,
           public.cash_in_account_tail(_row) as tail,
           public.listener_event_account_tail(_ev) as ev_tail,
           public.payment_name_key(_row.receipt_sender_name) as name_key,
           public.payment_name_key(_ev.sender_name) as ev_name_key,
           public.cash_in_receiving_tail(_row) as recv_tail,
           public.listener_event_receiving_tail(_ev) as ev_recv_tail,
           coalesce(_row.receipt_paid_at, _row.paid_at) as paid_at,
           coalesce((select r.amount_tolerance_php
                       from public.cash_in_auto_rule(_row.ecosystem_id) r), 0) as tol
  )
  select jsonb_build_array(
    jsonb_build_object(
      'signal', 'reference', 'category', 'identity', 'strength', 'normal',
      'receipt_label', 'Reference no.', 'notification_label', 'Reference no.',
      'receipt', c.ref_key, 'notification', _ev.reference_key,
      'agreed', (_ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key = c.ref_key)),
    jsonb_build_object(
      'signal', 'sender_account', 'category', 'identity', 'strength', 'normal',
      'receipt_label', 'Paid from / Sender', 'notification_label', 'Received from',
      'receipt', c.sender_key, 'notification', _ev.sender_number_key,
      'agreed', (_ev.sender_number_key is not null and c.sender_key is not null
                 and _ev.sender_number_key = c.sender_key)),
    jsonb_build_object(
      'signal', 'account_tail', 'category', 'identity', 'strength', 'normal',
      'receipt_label', 'Paid from (masked)', 'notification_label', 'Received from (masked)',
      'receipt', c.tail, 'notification', c.ev_tail,
      'agreed', (not (_ev.sender_number_key is not null and c.sender_key is not null)
                 and c.tail is not null and c.ev_tail is not null and c.tail = c.ev_tail)),
    jsonb_build_object(
      'signal', 'payer_name', 'category', 'identity', 'strength', 'normal',
      'receipt_label', 'Sender name', 'notification_label', 'Received from (name)',
      'receipt', c.name_key, 'notification', c.ev_name_key,
      'agreed', (c.name_key is not null and c.ev_name_key is not null
                 and c.name_key = c.ev_name_key)),
    jsonb_build_object(
      'signal', 'amount', 'category', 'supporting', 'strength', 'normal',
      'receipt_label', 'Amount sent', 'notification_label', 'Amount received',
      'receipt', _row.amount_php, 'notification', _ev.amount_php,
      'tolerance_php', c.tol,
      'agreed', (_ev.amount_php is not null
                 and abs(_ev.amount_php - _row.amount_php) <= c.tol)),
    jsonb_build_object(
      'signal', 'recipient_account', 'category', 'supporting', 'strength', 'normal',
      'receipt_label', 'Sent to / Paid to', 'notification_label', 'Received by',
      'receipt', c.recv_tail, 'notification', c.ev_recv_tail,
      'agreed', (c.recv_tail is not null and c.ev_recv_tail is not null and c.recv_tail = c.ev_recv_tail)),
    jsonb_build_object(
      'signal', 'payment_time', 'category', 'supporting', 'strength', 'normal',
      'receipt_label', 'Date / time on receipt', 'notification_label', 'Notification time',
      'receipt', c.paid_at, 'notification', _ev.posted_at,
      'agreed', (c.paid_at is not null and _ev.posted_at is not null
                 and abs(extract(epoch from (_ev.posted_at - c.paid_at))) <= 600)),
    jsonb_build_object(
      'signal', 'reference_difference', 'category', 'informational', 'strength', 'informational',
      'receipt', c.ref_key, 'notification', _ev.reference_key,
      'agreed', (_ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key <> c.ref_key))
  )
  from c
$function$;

create or replace function public.listener_match_signals(_ev public.listener_events, _row public.cash_in_requests)
returns integer
language sql stable set search_path to 'public'
as $function$
  with s as (
    select (x->>'category') as category, (x->>'agreed')::boolean as agreed
      from jsonb_array_elements(public.listener_match_signal_details(_ev, _row)) x
  ),
  t as (
    select count(*) filter (where category = 'identity' and agreed) as identity_n,
           count(*) filter (where category = 'supporting' and agreed) as supporting_n
      from s
  )
  select case when identity_n > 0 then identity_n + supporting_n
              else least(supporting_n, 1) end::integer
  from t
$function$;

-- 5. Duplicate fingerprint without a reference: same provider, amount, sender
--    and time (within 3 minutes) as an already-credited request.
create or replace function public.cash_in_credited_duplicate(_id uuid, _refkey text, _proof_hash text, _provider text)
returns uuid
language sql stable security definer set search_path to 'public'
as $function$
  with me as (select * from public.cash_in_requests where id = _id)
  select c.id
    from public.cash_in_requests c
   where c.id is distinct from _id
     and c.status = 'approved'
     and (
          (_proof_hash is not null and c.proof_hash = _proof_hash)
       or (_refkey is not null and _refkey in (coalesce(c.payer_reference_key,''), coalesce(c.receipt_reference_key,'')))
       or (_refkey is not null and exists (
             select 1 from public.payment_reference_seen s
              where s.reference_hash = public.payment_reference_hash(coalesce(_provider,'gcash'), _refkey)
                and s.cash_in_id = c.id))
       or (_refkey is not null and exists (
             select 1 from public.listener_events e
              where e.reference_key = _refkey and e.consumed_cash_in_id = c.id))
       or (_refkey is null and exists (
             select 1 from me
              where public.cash_in_sender_key(me) is not null
                and public.cash_in_sender_key(c) = public.cash_in_sender_key(me)
                and c.amount_php = me.amount_php
                and coalesce(c.provider_id, 'gcash') = coalesce(me.provider_id, _provider, 'gcash')
                and coalesce(c.receipt_paid_at, c.paid_at) is not null
                and coalesce(me.receipt_paid_at, me.paid_at) is not null
                and abs(extract(epoch from (coalesce(c.receipt_paid_at, c.paid_at) - coalesce(me.receipt_paid_at, me.paid_at)))) <= 180))
     )
   order by c.created_at asc
   limit 1
$function$;

-- 6. Full side-by-side explanation for manual review.
create or replace function public.cash_in_match_explanation(_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _ev public.listener_events; _actor uuid := auth.uid();
        _signals jsonb := '[]'::jsonb; _count integer := 0; _dup uuid;
begin
  select * into _row from public.cash_in_requests where id = _id;
  if _row.id is null then return null; end if;
  if not public.is_super_admin(_actor)
     and not (_row.ecosystem_id is not null and public.is_ecosystem_admin(_actor, _row.ecosystem_id)) then
    raise exception 'Only the platform owner or that shop''s admin can review this cash in';
  end if;
  if _row.listener_event_id is not null then
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    _signals := public.listener_match_signal_details(_ev, _row);
    _count := public.listener_match_signals(_ev, _row);
  end if;
  _dup := public.cash_in_credited_duplicate(_row.id, coalesce(_row.receipt_reference_key, _row.payer_reference_key),
                                            _row.proof_hash, _row.provider_id);
  return jsonb_build_object(
    'cash_in_id', _row.id,
    'status', _row.status,
    'viewpoints', jsonb_build_object(
      'receipt', 'sender',
      'notification', 'receiver',
      'note', 'The receipt is the customer''s (sender) view; the notification is the platform''s (receiver) view of the same transfer. "Sent to" on the receipt is compared with "Received by" on the notification, and "Paid from" with "Received from".'),
    'receipt', jsonb_strip_nulls(jsonb_build_object(
      'proof_path', _row.proof_path,
      'proof_hash', _row.proof_hash,
      'check', _row.receipt_check,
      'checked_at', _row.receipt_checked_at,
      'provider', _row.provider_id,
      'reference', _row.receipt_reference,
      'amount_php', _row.receipt_amount_php,
      'sender_number', _row.receipt_sender_number,
      'sender_name', _row.receipt_sender_name,
      'sender_account_masked', _row.receipt_sender_account_masked,
      'receiving_number', _row.receipt_receiving_number,
      'receiving_account_masked', _row.receipt_receiving_account_masked,
      'paid_at', _row.receipt_paid_at,
      'submitted_reference', _row.payer_reference,
      'submitted_sender', _row.sender_number,
      'requested_amount_php', _row.amount_php,
      'details', _row.receipt_details)),
    'notification', case when _ev.id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'event_id', _ev.id,
      'device_id', _ev.device_id,
      'provider', _ev.provider_id,
      'app_label', _ev.app_label,
      'package_name', _ev.package_name,
      'amount_php', _ev.amount_php,
      'sender_number', _ev.sender_number,
      'sender_name', _ev.sender_name,
      'reference', _ev.gcash_reference,
      'posted_at', _ev.posted_at,
      'raw_text', _ev.raw_text,
      'details', _ev.details)) end,
    'signals', _signals,
    'independent_matches', _count,
    'auto_candidate', _count >= 2,
    'duplicate_of_credited', _dup,
    'blockers', case when _row.status = 'pending' then public.cash_in_auth_blockers(_row.id) else null end);
end $function$;
revoke execute on function public.cash_in_match_explanation(uuid) from public, anon;
grant execute on function public.cash_in_match_explanation(uuid) to authenticated, service_role;