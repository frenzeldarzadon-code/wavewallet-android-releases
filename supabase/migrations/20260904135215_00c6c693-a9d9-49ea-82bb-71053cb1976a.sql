DROP FUNCTION IF EXISTS public.my_push_devices();
CREATE OR REPLACE FUNCTION public.my_push_devices()
RETURNS TABLE(id uuid, device_label text, user_agent text, push_enabled boolean,
              expired_at timestamptz, last_error text, last_seen_at timestamptz,
              created_at timestamptz, endpoint text, push_capable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select d.id, d.device_label, d.user_agent, d.push_enabled, d.expired_at,
         d.last_error, d.last_seen_at, d.created_at,
         case when d.endpoint like 'local:%' then null else d.endpoint end,
         (d.endpoint not like 'local:%' and d.p256dh is not null and d.auth_secret is not null)
    from public.push_devices d
   where d.user_id = auth.uid()
   order by d.created_at desc
$$;
REVOKE EXECUTE ON FUNCTION public.my_push_devices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_push_devices() TO authenticated, service_role;