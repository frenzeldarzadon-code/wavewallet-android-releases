-- Reporting-only first-use time per voucher code (never affects status or money).
alter table public.voucher_codes add column if not exists first_used_at timestamptz;

-- Codes behind the caller's attributed sales, same hierarchy scope as
-- voucher_sales_attribution, with the best known first-use time.
create or replace function public.voucher_sales_attribution_codes(_ecosystem uuid)
returns table (sale_id uuid, code text, first_used_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select c.sale_id, upper(c.code)::text,
         coalesce(c.first_used_at, (
           select min(coalesce(u.connected_at, u.first_seen_at))
           from voucher_usage_sessions u
           where u.ecosystem_id = c.ecosystem_id and upper(u.voucher_code) = upper(c.code)
         ))
  from public.voucher_sales_attribution(_ecosystem, null) a
  join voucher_codes c on c.sale_id = a.sale_id
$$;
revoke all on function public.voucher_sales_attribution_codes(uuid) from public, anon;
grant execute on function public.voucher_sales_attribution_codes(uuid) to authenticated;