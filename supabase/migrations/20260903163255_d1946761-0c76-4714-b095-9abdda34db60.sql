drop function if exists public.universe_market_pulse(integer);
create function public.universe_market_pulse(_limit integer default 8)
returns table(section text, rank integer, shop_id uuid, shop_name text, shop_slug text,
              commerce_kind text, item_id uuid, item_name text, image_path text,
              price numeric, sales_count bigint, rating_avg numeric, rating_count integer,
              logo_path text, cover_path text)
language sql stable security definer set search_path = public as $$
  with shops as (
    select e.id, e.name, e.slug,
           case when e.store_retail_enabled then 'retail' else 'voucher' end kind,
           coalesce((select count(*) from public.voucher_sales v where v.ecosystem_id=e.id and v.refunded_at is null),0)
           + coalesce((select count(*) from public.retail_orders o where o.ecosystem_id=e.id and o.status='approved'),0) sales,
           coalesce((select round(avg(r.rating)::numeric,2) from public.ecosystem_reviews r where r.ecosystem_id=e.id),0)::numeric rating,
           coalesce((select count(*)::int from public.ecosystem_reviews r where r.ecosystem_id=e.id),0) ratings,
           e.retail_logo_path logo, e.retail_cover_path cover
      from public.ecosystems e
     where e.archived_at is null and e.public_storefront_enabled and public.is_universe_shop(e.id)
       and (e.store_retail_enabled or e.store_voucher_enabled)
       and (not e.is_test or public.can_see_test_shop(e.id))
  ), shop_rank as (
    select *, row_number() over(order by sales desc, rating desc, name) r from shops
  ), products as (
    select e.id shop_id, e.name shop_name, e.slug shop_slug, 'retail'::text kind,
           p.id item_id, p.name item_name, p.image_path,
           round((p.price * (1 + public.retail_platform_fee_percent()/100.0))::numeric,2) price,
           coalesce(sum(case when o.status='approved' then oi.quantity else 0 end),0)::bigint sales
      from public.retail_products p join public.ecosystems e on e.id=p.ecosystem_id
      left join public.retail_order_items oi on oi.product_id=p.id
      left join public.retail_orders o on o.id=oi.order_id
     where p.active and not p.archived and p.public_visible and e.public_storefront_enabled
       and e.store_retail_enabled and public.is_universe_shop(e.id)
       and (not e.is_test or public.can_see_test_shop(e.id))
     group by e.id,e.name,e.slug,p.id,p.name,p.image_path,p.price
    union all
    select e.id,e.name,e.slug,'voucher',v.id,v.name,null::text as image_path,v.credit_price,
           coalesce(sum(case when s.refunded_at is null then s.quantity else 0 end),0)::bigint
      from public.voucher_products v join public.ecosystems e on e.id=v.ecosystem_id
      left join public.voucher_sales s on s.product_id=v.id
     where v.active and not v.archived and e.public_storefront_enabled and e.store_voucher_enabled
       and public.is_universe_shop(e.id) and (not e.is_test or public.can_see_test_shop(e.id))
     group by e.id,e.name,e.slug,v.id,v.name,v.credit_price
  ), product_rank as (
    select *, row_number() over(order by sales desc, item_name) r from products
  )
  select 'featured', r::int, id, name, slug, kind, null::uuid, null::text, null::text, null::numeric,
         sales, rating, ratings, logo, cover
    from shop_rank where r <= least(greatest(_limit,1),12)
  union all
  select 'top_shops', r::int, id, name, slug, kind, null::uuid, null::text, null::text, null::numeric,
         sales, rating, ratings, logo, cover
    from shop_rank where sales > 0 and r <= least(greatest(_limit,1),12)
  union all
  select 'top_products', r::int, shop_id, shop_name, shop_slug, kind, item_id, item_name, image_path, price,
         sales, 0::numeric, 0, null::text, null::text
    from product_rank where sales > 0 and r <= least(greatest(_limit,1),12)
  order by 1,2
$$;
revoke all on function public.universe_market_pulse(integer) from public;
grant execute on function public.universe_market_pulse(integer) to anon, authenticated;