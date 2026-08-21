create or replace function public.repair_listener_device(_device uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _dev public.listener_devices; _row public.listener_devices; _secret text;
begin
  select * into _dev from public.listener_devices where id = _device;
  if _dev.id is null then raise exception 'Listener device not found'; end if;
  if not (public.is_super_admin(_actor)
          or (_dev.ecosystem_id is not null and public.is_ecosystem_admin(_actor, _dev.ecosystem_id))) then
    raise exception 'You cannot re-pair this listener device';
  end if;

  -- A fresh one-time secret replaces the old credential outright: knowing the
  -- device id alone never restores access.
  _secret := encode(extensions.gen_random_bytes(24), 'hex');
  update public.listener_devices
     set secret_key_hash = encode(extensions.digest(_secret, 'sha256'), 'hex'),
         status = 'pending',
         revoked_at = null,
         revoked_by = null,
         listener_connected = null,
         notification_access = null,
         listener_state_at = null
   where id = _device
   returning * into _row;

  delete from public.listener_nonces where device_id = _device;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, _actor,
          coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Re-paired GCash listener device', _row.label,
          jsonb_build_object('device_id', _row.id, 'previous_status', _dev.status));

  return jsonb_build_object('device_id', _row.id, 'label', _row.label,
                            'pairing_secret', _secret, 'package_name', _row.package_name,
                            'receiving_number', _row.receiving_number);
end $function$;

revoke all on function public.repair_listener_device(uuid) from public, anon;
grant execute on function public.repair_listener_device(uuid) to authenticated;