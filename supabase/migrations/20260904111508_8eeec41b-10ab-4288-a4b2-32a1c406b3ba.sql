-- Notification SOURCE detection before payment classification.
-- * listener_events keeps the Android channel/category alongside package + app
--   label for every notification, including blocked ones (identity only).
-- * listener_detected_sources() lists every app the phones have seen, with
--   counts, last-seen and the effective allow/block state for a scope.
-- * block/unblock helpers reuse listener_source_rules and write audit_logs.
alter table public.listener_events
  add column if not exists channel_id text,
  add column if not exists category text;

drop function if exists public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.record_listener_event(_device uuid, _event_uid text, _package text, _raw_text text DEFAULT NULL::text, _amount numeric DEFAULT NULL::numeric, _sender_number text DEFAULT NULL::text, _sender_name text DEFAULT NULL::text, _posted_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _parser_version text DEFAULT NULL::text, _gcash_reference text DEFAULT NULL::text, _provider text DEFAULT NULL::text, _app_label text DEFAULT NULL::text, _details jsonb DEFAULT NULL::jsonb, _channel text DEFAULT NULL::text, _category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                                        outcome, review_state, app_label, channel_id, category)
    values (_device, trim(_event_uid), trim(_package), coalesce(_posted_at, now()),
            'source_disabled', 'ignored', nullif(trim(coalesce(_app_label, '')), ''),
            nullif(trim(coalesce(_channel, '')), ''), nullif(trim(coalesce(_category, '')), ''))
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
                                        review_state, provider_id, app_label, details,
                                        channel_id, category)
    values (_device, trim(_event_uid), trim(_package), nullif(trim(_raw_text), ''),
            case when _outcome = 'accepted' then round(_amount, 2) end,
            nullif(trim(_sender_number), ''), public.normalize_ph_mobile(_sender_number),
            nullif(trim(_sender_name), ''), coalesce(_posted_at, now()),
            nullif(trim(_parser_version), ''), _outcome, _ref, _ref_key,
            case when _outcome = 'non_payment' then 'ignored' else 'pending' end,
            _provider_id, nullif(trim(coalesce(_app_label, '')), ''), _details,
            nullif(trim(coalesce(_channel, '')), ''), nullif(trim(coalesce(_category, '')), ''))
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
revoke all on function public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.record_listener_event(uuid, text, text, text, numeric, text, text, timestamptz, text, text, text, text, jsonb, text, text) to service_role;

-- Effective mode for one package in one scope (platform / shop / device).
create or replace function public.listener_source_effective_mode(_package text, _ecosystem uuid default null, _device uuid default null)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  with ranked as (
    select r.mode,
           (case when r.device_id is not null then 3
                 when r.ecosystem_id is not null then 2 else 1 end) as scope_rank,
           (case when r.package_name = '*' then 0 else 1 end) as pkg_rank,
           (case when r.mode = 'allow' then 1 else 0 end) as mode_rank
      from public.listener_source_rules r
     where (r.package_name = '*' or lower(r.package_name) = lower(trim(coalesce(_package, ''))))
       and ((_device is not null and r.device_id = _device)
            or (r.device_id is null and r.ecosystem_id is not null and r.ecosystem_id = _ecosystem)
            or (r.device_id is null and r.ecosystem_id is null))
  )
  select coalesce((select mode from ranked order by scope_rank desc, pkg_rank desc, mode_rank desc limit 1), 'allow');
$function$;

-- Every notification source the listener phones in this scope have ever seen.
-- Platform owner with _ecosystem null = platform (Universe) phones; a shop admin
-- gets their own shop's phones only. No notification content is returned.
create or replace function public.listener_detected_sources(_ecosystem uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _super boolean;
begin
  _super := public.is_super_admin(_actor);
  if not (_super or (_ecosystem is not null and public.is_ecosystem_admin(_actor, _ecosystem))) then
    raise exception 'You cannot read notification sources for this scope';
  end if;

  return coalesce((
    with ev as (
      select e.package_name, e.app_label, e.channel_id, e.category, e.outcome, e.provider_id,
             e.created_at, e.posted_at
        from public.listener_events e
        join public.listener_devices d on d.id = e.device_id
       where d.ecosystem_id is not distinct from _ecosystem
    ),
    agg as (
      select lower(package_name) as package_name,
             (array_remove(array_agg(app_label order by created_at desc), null))[1] as app_label,
             (array_remove(array_agg(channel_id order by created_at desc), null))[1] as channel_id,
             (array_remove(array_agg(category order by created_at desc), null))[1] as category,
             (array_remove(array_agg(provider_id order by created_at desc), null))[1] as provider_id,
             count(*) as total,
             count(*) filter (where outcome = 'accepted') as payments,
             count(*) filter (where outcome = 'non_payment') as non_payment,
             count(*) filter (where outcome = 'unparsed') as unparsed,
             count(*) filter (where outcome = 'source_disabled') as blocked_count,
             min(created_at) as first_seen_at,
             max(coalesce(posted_at, created_at)) as last_seen_at
        from ev group by lower(package_name)
    )
    select jsonb_agg(jsonb_build_object(
      'package_name', a.package_name, 'app_label', a.app_label,
      'channel_id', a.channel_id, 'category', a.category, 'provider_id', a.provider_id,
      'total', a.total, 'payments', a.payments, 'non_payment', a.non_payment,
      'unparsed', a.unparsed, 'blocked_count', a.blocked_count,
      'first_seen_at', a.first_seen_at, 'last_seen_at', a.last_seen_at,
      'effective_mode', public.listener_source_effective_mode(a.package_name, _ecosystem, null),
      'rule_id', (select r.id from public.listener_source_rules r
                   where lower(r.package_name) = a.package_name and r.device_id is null
                     and r.ecosystem_id is not distinct from _ecosystem),
      'rule_mode', (select r.mode from public.listener_source_rules r
                     where lower(r.package_name) = a.package_name and r.device_id is null
                       and r.ecosystem_id is not distinct from _ecosystem),
      'rule_updated_at', (select r.updated_at from public.listener_source_rules r
                           where lower(r.package_name) = a.package_name and r.device_id is null
                             and r.ecosystem_id is not distinct from _ecosystem),
      'rule_by', (select p.full_name from public.listener_source_rules r
                   join public.profiles p on p.id = r.created_by
                  where lower(r.package_name) = a.package_name and r.device_id is null
                    and r.ecosystem_id is not distinct from _ecosystem))
      order by a.last_seen_at desc)
      from agg a), '[]'::jsonb);
end $function$;
revoke all on function public.listener_detected_sources(uuid) from public, anon;
grant execute on function public.listener_detected_sources(uuid) to authenticated;

-- Audit every rule change (who / when / which scope / which app).
create or replace function public.tg_listener_source_rule_audit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _r public.listener_source_rules; _actor uuid; _name text; _action text;
begin
  _r := coalesce(new, old);
  _actor := coalesce(auth.uid(), _r.created_by);
  select full_name into _name from public.profiles where id = _actor;
  _action := case
    when tg_op = 'DELETE' then 'Notification source rule removed'
    when _r.mode = 'deny' then 'Notification source blocked'
    else 'Notification source enabled' end;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_r.ecosystem_id, _actor, coalesce(_name, 'Platform owner'), _action, _r.package_name,
          jsonb_build_object('rule_id', _r.id, 'package_name', _r.package_name, 'mode', _r.mode,
                             'device_id', _r.device_id, 'note', _r.note, 'operation', tg_op,
                             'previous_mode', case when tg_op = 'UPDATE' then old.mode end));
  return coalesce(new, old);
end $function$;
drop trigger if exists listener_source_rule_audit on public.listener_source_rules;
create trigger listener_source_rule_audit
  after insert or update or delete on public.listener_source_rules
  for each row execute function public.tg_listener_source_rule_audit();

-- Unblock = restore the default for this scope. If a wider rule still blocks
-- the app (for example a platform-wide '*' deny), an explicit allow is saved.
create or replace function public.unblock_listener_source(_package text, _ecosystem uuid default null, _device uuid default null)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _eco uuid := _ecosystem; _pkg text := lower(trim(coalesce(_package, '')));
begin
  if _device is not null then
    select ecosystem_id into _eco from public.listener_devices where id = _device;
    if not found then raise exception 'Unknown listener device'; end if;
  end if;
  if not (public.is_super_admin(_actor) or (_eco is not null and public.is_ecosystem_admin(_actor, _eco))) then
    raise exception 'You cannot configure notification sources for this scope';
  end if;
  if _pkg = '' then raise exception 'Give the app package name'; end if;

  delete from public.listener_source_rules
   where lower(package_name) = _pkg and mode = 'deny'
     and device_id is not distinct from _device
     and (_device is not null or ecosystem_id is not distinct from _eco);

  if public.listener_source_effective_mode(_pkg, _eco, _device) = 'deny' then
    perform public.set_listener_source_rule(_pkg, 'allow', _eco, _device, 'Re-enabled');
    return 'allowed_explicitly';
  end if;
  return 'restored_default';
end $function$;
revoke all on function public.unblock_listener_source(text, uuid, uuid) from public, anon;
grant execute on function public.unblock_listener_source(text, uuid, uuid) to authenticated;