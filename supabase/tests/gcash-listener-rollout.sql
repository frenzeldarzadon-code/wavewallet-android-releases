-- Staged rollout safety for listener-corroborated Cash In approval.
-- Requiring listener confirmation must be impossible until a paired phone has
-- actually delivered at least one notification.
do $$
declare _blocked boolean := false;
begin
  -- 1. Without a proven device, turning the requirement on must fail.
  if not exists (select 1 from public.listener_devices
                  where status = 'active' and last_event_at is not null) then
    begin
      update public.cash_in_auto_rules set require_listener_match = true where ecosystem_id is null;
    exception when others then _blocked := true;
    end;
    if not _blocked then
      raise exception 'FAIL: listener requirement enabled with no proven listener device';
    end if;
  end if;

  -- 2. The platform rule must never ship with the requirement silently on.
  if exists (select 1 from public.cash_in_auto_rules r
              where r.require_listener_match
                and not exists (select 1 from public.listener_devices d
                                 where d.status = 'active' and d.last_event_at is not null)) then
    raise exception 'FAIL: a rule requires listener confirmation but no device can supply it';
  end if;

  raise notice 'PASS: listener rollout gate holds';
end $$;
