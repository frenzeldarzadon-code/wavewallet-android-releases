create or replace function public.voucher_sales_attribution(_ecosystem uuid, _from timestamptz default null)
returns table (
  sale_id uuid, occurred_at timestamptz, generator_id uuid, generator_name text,
  generator_role text, quantity integer, sale_amount numeric, scope text
)
language plpgsql stable security definer set search_path = public
as $$
declare
  _me uuid := auth.uid();
  _is_admin boolean;
begin
  if _me is null then raise exception 'Not signed in'; end if;
  _is_admin := public.is_ecosystem_admin(_me, _ecosystem);
  return query
  select s.id, s.created_at, s.buyer_id,
         coalesce(nullif(p.full_name, ''), p.handle, 'Member')::text,
         s.buyer_role::text, s.quantity::integer, s.sale_price::numeric,
         case when s.buyer_id = _me then 'own' else 'network' end
  from voucher_sales s
  left join profiles p on p.id = s.buyer_id
  where s.ecosystem_id = _ecosystem
    and s.refunded_at is null
    and s.buyer_role in ('admin','reseller','subreseller')
    and (_from is null or s.created_at >= _from)
    and (
      s.buyer_id = _me
      or (_is_admin and s.buyer_role in ('reseller','subreseller'))
      or (s.buyer_role = 'subreseller' and s.parent_reseller_id = _me)
    );
end $$;