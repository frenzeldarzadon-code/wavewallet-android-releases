-- lovable-cron-fallback-reviewed: 144 runs/day; wake-on-enqueue trigger is primary, this only re-wakes the sender when a pending delivery still exists (missed wake / sender crash)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 1. Private dispatcher configuration ---------------------------------
CREATE TABLE IF NOT EXISTS public.push_dispatch_config (
  id integer PRIMARY KEY CHECK (id = 1),
  endpoint_url text,
  secret text,
  last_wake_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.push_dispatch_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_dispatch_config TO service_role;
ALTER TABLE public.push_dispatch_config ENABLE ROW LEVEL SECURITY;

-- 2. Wake the background sender (never fails the caller) --------------
CREATE OR REPLACE FUNCTION public.wake_push_dispatcher(_force boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _cfg public.push_dispatch_config%rowtype;
begin
  select * into _cfg from public.push_dispatch_config where id = 1;
  if _cfg.endpoint_url is null or _cfg.secret is null then return; end if;
  if not exists (select 1 from public.notification_deliveries d where d.status = 'pending') then
    return;
  end if;
  if not _force and _cfg.last_wake_at is not null and _cfg.last_wake_at > now() - interval '2 seconds' then
    return;
  end if;
  update public.push_dispatch_config set last_wake_at = now() where id = 1;
  begin
    perform net.http_post(
      url := _cfg.endpoint_url,
      headers := jsonb_build_object('content-type', 'application/json',
                                    'x-push-dispatch-secret', _cfg.secret),
      body := jsonb_build_object('source', case when _force then 'cron' else 'trigger' end),
      timeout_milliseconds := 15000);
  exception when others then
    null; -- the safety check will retry
  end;
end $$;
REVOKE EXECUTE ON FUNCTION public.wake_push_dispatcher(boolean) FROM PUBLIC, anon, authenticated;

-- 3. One queueing path for every notification -------------------------
CREATE OR REPLACE FUNCTION public.queue_notification_deliveries()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _muted boolean := false; _account_push boolean := false; _devices integer := 0;
begin
  select coalesce(bool_or(NEW.kind = any(p.disabled_kinds)), false),
         coalesce(bool_or(p.push_enabled), false)
    into _muted, _account_push
    from public.notification_preferences p
   where p.user_id = NEW.user_id;

  if _muted then
    insert into public.notification_deliveries (notification_id, user_id, status, reason)
    values (NEW.id, NEW.user_id, 'skipped', 'category_muted');
    return NEW;
  end if;

  if not _account_push then
    insert into public.notification_deliveries (notification_id, user_id, status, reason)
    values (NEW.id, NEW.user_id, 'skipped', 'account_push_disabled');
    return NEW;
  end if;

  insert into public.notification_deliveries (notification_id, user_id, device_id, status)
  select NEW.id, NEW.user_id, d.id, 'pending'
    from public.push_devices d
   where d.user_id = NEW.user_id and d.push_enabled and d.expired_at is null
     and d.endpoint not like 'local:%';
  get diagnostics _devices = row_count;

  if _devices = 0 then
    insert into public.notification_deliveries (notification_id, user_id, status, reason)
    values (NEW.id, NEW.user_id, 'skipped', 'no_active_device');
  else
    perform public.wake_push_dispatcher(false);
  end if;
  return NEW;
end $$;

DROP TRIGGER IF EXISTS member_notifications_queue_push ON public.member_notifications;
CREATE TRIGGER member_notifications_queue_push
  AFTER INSERT ON public.member_notifications
  FOR EACH ROW EXECUTE FUNCTION public.queue_notification_deliveries();

-- notify_financial: keep the mandatory in-app history; queueing moved to the trigger.
CREATE OR REPLACE FUNCTION public.notify_financial(
  _user uuid, _ecosystem uuid, _kind text, _title text,
  _body text DEFAULT NULL, _link text DEFAULT NULL, _event_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _id uuid;
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
  return _id;
end $$;

-- 4. Sender helpers (service role only) -------------------------------
CREATE OR REPLACE FUNCTION public.claim_push_deliveries(_limit integer DEFAULT 50)
RETURNS TABLE(delivery_id uuid, notification_id uuid, device_id uuid, user_id uuid,
              endpoint text, p256dh text, auth_secret text,
              kind text, category text, title text, body text, link text,
              created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  update public.notification_deliveries d
     set status = 'pending', updated_at = now()
   where d.status = 'sending' and d.updated_at < now() - interval '10 minutes';
  update public.notification_deliveries d
     set status = 'expired', reason = 'stale', updated_at = now()
   where d.status = 'pending' and d.created_at < now() - interval '24 hours';

  return query
  with picked as (
    select d.id
      from public.notification_deliveries d
      join public.push_devices pd on pd.id = d.device_id
     where d.status = 'pending' and pd.expired_at is null and pd.push_enabled
     order by d.created_at
     limit greatest(1, least(coalesce(_limit, 50), 200))
     for update of d skip locked
  ), marked as (
    update public.notification_deliveries d
       set status = 'sending', updated_at = now()
      from picked
     where d.id = picked.id
    returning d.id, d.notification_id, d.device_id, d.user_id, d.created_at
  )
  select m.id, m.notification_id, m.device_id, m.user_id,
         pd.endpoint, pd.p256dh, pd.auth_secret,
         n.kind, n.category, n.title, n.body, n.link, m.created_at
    from marked m
    join public.push_devices pd on pd.id = m.device_id
    join public.member_notifications n on n.id = m.notification_id;
end $$;
REVOKE EXECUTE ON FUNCTION public.claim_push_deliveries(integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finish_push_delivery(
  _delivery_id uuid, _status text, _reason text DEFAULT NULL, _device_gone boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _device uuid; _failures integer;
begin
  if _status not in ('sent', 'failed', 'skipped') then
    raise exception 'Invalid delivery status %', _status;
  end if;
  update public.notification_deliveries
     set status = _status, reason = left(_reason, 200), updated_at = now()
   where id = _delivery_id
  returning device_id into _device;
  if _device is null then return; end if;

  if _status = 'sent' then
    update public.push_devices
       set failure_count = 0, last_error = null, last_seen_at = now()
     where id = _device;
  elsif _status = 'failed' then
    update public.push_devices
       set failure_count = failure_count + 1, last_error = left(_reason, 200)
     where id = _device
    returning failure_count into _failures;
    if _device_gone or coalesce(_failures, 0) >= 5 then
      update public.push_devices
         set expired_at = coalesce(expired_at, now()), push_enabled = false
       where id = _device;
      update public.notification_deliveries
         set status = 'expired', reason = 'device_expired', updated_at = now()
       where device_id = _device and status in ('pending', 'sending');
    end if;
  end if;
end $$;
REVOKE EXECUTE ON FUNCTION public.finish_push_delivery(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- 5. Self test for the Notifications screen ----------------------------
CREATE OR REPLACE FUNCTION public.send_test_notification()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.member_notifications n
              where n.user_id = auth.uid() and n.kind = 'test'
                and n.created_at > now() - interval '1 minute') then
    raise exception 'Please wait a minute before sending another test';
  end if;
  insert into public.member_notifications (user_id, ecosystem_id, kind, category, title, body, link)
  values (auth.uid(), null, 'test', 'social', 'Test notification',
          'Phone notifications are working on this device.', '/universe/notifications')
  returning id into _id;
  return _id;
end $$;
REVOKE EXECUTE ON FUNCTION public.send_test_notification() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_test_notification() TO authenticated, service_role;

-- 6. Safety net: re-wake only while something is still pending -------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wavewallet-push-dispatch') THEN
    PERFORM cron.schedule('wavewallet-push-dispatch', '*/10 * * * *',
                          $job$select public.wake_push_dispatcher(true)$job$);
  END IF;
END $$;