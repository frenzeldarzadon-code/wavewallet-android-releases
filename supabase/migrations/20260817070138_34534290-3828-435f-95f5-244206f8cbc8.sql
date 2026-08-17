CREATE OR REPLACE FUNCTION public.notify_financial(
  _user uuid, _ecosystem uuid, _kind text, _title text,
  _body text DEFAULT NULL, _link text DEFAULT NULL, _event_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _id uuid; _muted boolean := false; _account_push boolean := false; _devices integer := 0;
begin
  if _user is null or _event_key is null or _kind is null then return null; end if;
  if exists (select 1 from public.profiles p where p.id = _user and p.deleted_at is not null) then
    return null;
  end if;

  insert into public.member_notifications
    (user_id, ecosystem_id, kind, category, title, body, link, event_key)
  values (_user, _ecosystem, _kind, 'financial', _title, _body, _link, _event_key)
  on conflict (event_key) where event_key is not null do nothing
  returning id into _id;

  if _id is null then return null; end if;

  select coalesce(bool_or(_kind = any(p.disabled_kinds)), false),
         coalesce(bool_or(p.push_enabled), false)
    into _muted, _account_push
    from public.notification_preferences p
   where p.user_id = _user;

  if _muted then
    insert into public.notification_deliveries (notification_id, user_id, status, reason)
    values (_id, _user, 'skipped', 'category_muted');
    return _id;
  end if;

  if not _account_push then
    insert into public.notification_deliveries (notification_id, user_id, status, reason)
    values (_id, _user, 'skipped', 'account_push_disabled');
    return _id;
  end if;

  insert into public.notification_deliveries (notification_id, user_id, device_id, status)
  select _id, _user, d.id, 'pending'
    from public.push_devices d
   where d.user_id = _user and d.push_enabled and d.expired_at is null;
  get diagnostics _devices = row_count;

  if _devices = 0 then
    insert into public.notification_deliveries (notification_id, user_id, status, reason)
    values (_id, _user, 'skipped', 'no_active_device');
  end if;

  return _id;
end $$;

REVOKE EXECUTE ON FUNCTION public.notify_financial(uuid, uuid, text, text, text, text, text)
  FROM anon, authenticated;