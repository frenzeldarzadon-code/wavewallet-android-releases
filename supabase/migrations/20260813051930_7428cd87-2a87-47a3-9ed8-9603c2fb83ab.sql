create or replace function public.admin_sale_commission_rate_for(_eco uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    nullif((select admin_sale_commission_percent from public.ecosystems where id = _eco), 0),
    (select default_admin_sale_commission_percent from public.platform_settings where id = 1),
    0)
$$;