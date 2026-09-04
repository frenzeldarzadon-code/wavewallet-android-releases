CREATE OR REPLACE FUNCTION public.finish_push_delivery(
  _delivery_id uuid, _status text, _reason text DEFAULT NULL, _device_gone boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _device uuid; _failures integer;
begin
  if _status not in ('sent', 'failed', 'skipped', 'pending') then
    raise exception 'Invalid delivery status %', _status;
  end if;
  update public.notification_deliveries
     set status = _status,
         reason = case when _status = 'pending' then 'retry:' || left(coalesce(_reason, ''), 190)
                       else left(_reason, 200) end,
         updated_at = now()
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
       and (d.reason is null or d.reason not like 'retry:%'
            or d.updated_at < now() - interval '5 minutes')
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