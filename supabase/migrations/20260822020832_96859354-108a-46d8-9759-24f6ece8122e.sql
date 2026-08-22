
-- Remove the legacy overload so exactly one ingest entry point exists.
drop function if exists public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text, text);

create or replace function public.record_listener_event(
  _device uuid, _event_uid text, _package text,
  _raw_text text default null, _amount numeric default null,
  _sender_number text default null, _sender_name text default null,
  _posted_at timestamptz default null, _parser_version text default null,
  _gcash_reference text default null, _provider text default null, _app_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _dev public.listener_devices; _row public.listener_events; _outcome text; _match text;
        _fresh boolean := false; _ref text; _ref_key text; _provider_id text;
begin
  select * into _dev from public.listener_devices where id = _device;
  if _dev.id is null then raise exception 'Unknown listener device'; end if;
  if _dev.status = 'revoked' then raise exception 'This listener device was revoked'; end if;
  if nullif(trim(_event_uid), '') is null then raise exception 'event_uid is required'; end if;
  if nullif(trim(coalesce(_package, '')), '') is null then raise exception 'package_name is required'; end if;

  -- Source filtering happens before anything is read or stored. A disabled
  -- source keeps only the app identity for diagnostics: no text, no amount,
  -- no sender, no reference, and it can never become a payment candidate.
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
end $$;

grant execute on function public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text, text, text, text) to service_role;
