CREATE OR REPLACE FUNCTION public.archive_ecosystem(_ecosystem_id uuid, _reason text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _chk record;
  _name text;
  _actor text;
  _now timestamptz := now();
begin
  if auth.uid() is not null and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can delete an ecosystem';
  end if;

  select e.name into _name from public.ecosystems e where e.id = _ecosystem_id for update;
  if _name is null then
    raise exception 'Ecosystem not found';
  end if;

  select * into _chk from public.ecosystem_cleanup_check(_ecosystem_id);
  if not _chk.eligible then
    raise exception 'This shop cannot be deleted yet: %', array_to_string(_chk.blockers, ' ');
  end if;

  update public.ecosystems
     set archived_at = _now,
         archived_by = auth.uid(),
         archived_reason = nullif(trim(coalesce(_reason, '')), ''),
         signup_enabled = false,
         operations_frozen = true,
         frozen_reason = 'Shop archived',
         subscription_state = 'suspended',
         signup_token = replace(gen_random_uuid()::text, '-', ''),
         updated_at = _now
   where id = _ecosystem_id;

  update public.profiles
     set status = 'suspended', updated_at = _now
   where ecosystem_id = _ecosystem_id and status <> 'suspended';

  select coalesce(p.full_name, 'Maintenance job') into _actor
    from public.profiles p where p.id = auth.uid();

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Maintenance job'),
          'Archived ecosystem', _name,
          jsonb_build_object('reason', _reason, 'last_activity', _chk.last_activity,
                             'automatic', auth.uid() is null));

  return _now;
end;
$$;

REVOKE ALL ON FUNCTION public.archive_ecosystem(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_ecosystem(uuid, text) TO authenticated, service_role;