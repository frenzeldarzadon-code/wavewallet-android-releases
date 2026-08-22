create or replace function public.listener_device_source_rules(_device uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with dev as (select id, ecosystem_id from public.listener_devices where id = _device)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'package_name', lower(trim(r.package_name)),
        'mode', r.mode,
        'scope', case
                   when r.device_id is not null then 'device'
                   when r.ecosystem_id is not null then 'shop'
                   else 'platform'
                 end
      )
      order by r.package_name
    ),
    '[]'::jsonb)
  from public.listener_source_rules r, dev d
  where r.device_id = d.id
     or (r.device_id is null and r.ecosystem_id is not null and r.ecosystem_id = d.ecosystem_id)
     or (r.device_id is null and r.ecosystem_id is null);
$$;

revoke all on function public.listener_device_source_rules(uuid) from public;
revoke all on function public.listener_device_source_rules(uuid) from anon;
revoke all on function public.listener_device_source_rules(uuid) from authenticated;
grant execute on function public.listener_device_source_rules(uuid) to service_role;