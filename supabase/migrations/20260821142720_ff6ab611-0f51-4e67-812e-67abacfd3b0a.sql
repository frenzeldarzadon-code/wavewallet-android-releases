drop function if exists public.listener_heartbeat(uuid);
-- GCash listener reliability: report Android listener health to the server.
--
-- A running foreground service proves nothing: Android can unbind the
-- NotificationListenerService while the process (and the heartbeat) stays
-- alive. The phone now reports its own listener state and notification-access
-- state with every heartbeat, and a device only counts as online when Android
-- actually has the listener connected.

alter table public.listener_devices
  add column if not exists listener_connected boolean,
  add column if not exists notification_access boolean,
  add column if not exists listener_state_at timestamptz,
  add column if not exists received_count integer not null default 0,
  add column if not exists last_received_at timestamptz,
  add column if not exists app_version text;

create or replace function public.listener_heartbeat(
  _device uuid,
  _listener_connected boolean default null,
  _notification_access boolean default null,
  _received_count integer default null,
  _last_received_at timestamptz default null,
  _app_version text default null
)
returns public.listener_devices
language plpgsql
security definer
set search_path = public
as $$
declare _row public.listener_devices;
begin
  update public.listener_devices
     set last_seen_at = now(),
         status = case when status = 'pending' then 'active' else status end,
         listener_connected = coalesce(_listener_connected, listener_connected),
         notification_access = coalesce(_notification_access, notification_access),
         listener_state_at = case
             when _listener_connected is null and _notification_access is null
               then listener_state_at else now() end,
         received_count = greatest(coalesce(_received_count, received_count), received_count),
         last_received_at = greatest(coalesce(_last_received_at, last_received_at), last_received_at),
         app_version = coalesce(_app_version, app_version)
   where id = _device and status <> 'revoked' returning * into _row;
  if _row.id is null then raise exception 'Unknown or revoked listener device'; end if;
  delete from public.listener_nonces where seen_at < now() - interval '30 minutes';
  return _row;
end
$$;

revoke all on function public.listener_heartbeat(uuid, boolean, boolean, integer, timestamptz, text) from public;
revoke all on function public.listener_heartbeat(uuid, boolean, boolean, integer, timestamptz, text) from anon;
revoke all on function public.listener_heartbeat(uuid, boolean, boolean, integer, timestamptz, text) from authenticated;

create or replace function public.listener_device_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
        'listener_connected', d.listener_connected,
        'notification_access', d.notification_access,
        'listener_state_at', d.listener_state_at,
        'received_count', d.received_count,
        'last_received_at', d.last_received_at,
        'app_version', d.app_version,
        'online', d.status = 'active' and d.last_seen_at is not null
                  and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes)
                  and coalesce(d.listener_connected, true)
                  and coalesce(d.notification_access, true),
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
end
$$;

grant execute on function public.listener_device_status() to authenticated;