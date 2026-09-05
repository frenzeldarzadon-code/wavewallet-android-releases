create or replace function public.universe_product_feed(
  _section text default 'all',
  _category text default null,
  _seed integer default 0,
  _limit integer default 24,
  _offset integer default 0
)
returns table(
  kind text, id uuid, name text, description text, image_path text,
  price numeric, available integer, category text, brand text, size_label text,
  rating_avg numeric, rating_count integer, sold_30d integer, views_30d integer,
  created_at timestamptz, shop_id uuid, shop_name text, shop_slug text,
  shop_logo_path text, score numeric, is_new boolean, is_trending boolean
)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid),
  shops as (select * from public.universe_marketplace_shops()),
  base as (
    select 'retail'::text as kind, p.id, p.name, p.description, p.image_path,
           round(p.price * (1 + public.retail_platform_fee_percent() / 100), 2) as price,
           p.stock as available, p.category, p.brand, p.size_label, p.created_at,
           s.id as shop_id, s.name as shop_name, s.slug as shop_slug, s.retail_logo_path as shop_logo_path,
           coalesce((select round(avg(r.rating)::numeric,2) from public.retail_product_ratings r where r.product_id = p.id),0)::numeric as rating_avg,
           coalesce((select count(*)::int from public.retail_product_ratings r where r.product_id = p.id),0) as rating_count,
           coalesce((select sum(i.quantity)::int from public.retail_order_items i
                       join public.retail_orders o on o.id = i.order_id
                      where i.product_id = p.id and o.created_at > now() - interval '30 days'
                        and o.status not in ('rejected','cancelled')),0) as sold_30d
      from public.retail_products p join shops s on s.id = p.ecosystem_id
     where s.store_retail_enabled and p.active and p.published and not p.archived
       and p.public_visible and p.stock > 0
    union all
    select 'voucher', v.id, v.name, v.description, null,
           coalesce(v.promo_price, v.credit_price),
           (select count(*)::int from public.voucher_codes c where c.product_id = v.id and c.status = 'unused'),
           'Vouchers', null, null, v.created_at,
           s.id, s.name, s.slug, s.retail_logo_path,
           coalesce((select round(avg(r.rating)::numeric,2) from public.product_ratings r where r.product_id = v.id),0)::numeric,
           coalesce((select count(*)::int from public.product_ratings r where r.product_id = v.id),0),
           coalesce((select sum(coalesce(vs.quantity,1))::int from public.voucher_sales vs
                      where vs.product_id = v.id and vs.refunded_at is null
                        and vs.created_at > now() - interval '30 days'),0)
      from public.voucher_products v join shops s on s.id = v.ecosystem_id
     where s.store_voucher_enabled and v.active and not v.archived
  ),
  enriched as (
    select b.*,
           coalesce((select count(*)::int from public.universe_product_views pv
                      where pv.product_id = b.id and pv.viewed_at > now() - interval '30 days'),0) as views_30d,
           exists (select 1 from me, public.voucher_sales vs where vs.buyer_id = me.uid and vs.ecosystem_id = b.shop_id
                   union all
                   select 1 from me, public.retail_orders o where o.customer_id = me.uid and o.ecosystem_id = b.shop_id) as bought_here,
           exists (select 1 from me, public.universe_product_views pv
                    where pv.user_id = me.uid and pv.viewed_at > now() - interval '30 days'
                      and pv.product_id <> b.id
                      and (pv.ecosystem_id = b.shop_id or exists (
                            select 1 from public.retail_products rp where rp.id = pv.product_id and rp.category = b.category))) as affinity,
           exists (select 1 from me, public.universe_product_views pv
                    where pv.user_id = me.uid and pv.product_id = b.id
                      and pv.viewed_at > now() - interval '2 days') as seen_recently,
           ((hashtext(b.id::text || ':' || _seed::text) & 2147483647)::numeric / 2147483647) as noise
      from base b
  ),
  scored as (
    select e.*,
           (e.sold_30d + e.views_30d) as heat,
           ntile(4) over (order by (e.sold_30d + e.views_30d) desc) as heat_quartile,
           ( ln(1 + e.sold_30d) * 1.0
           + ln(1 + e.views_30d) * 0.5
           + case when e.rating_count > 0 then e.rating_avg * 0.3 else 0 end
           + greatest(0, 14 - extract(epoch from now() - e.created_at) / 86400) / 14 * 1.5
           + case when e.bought_here then 1.0 else 0 end
           + case when e.affinity then 0.8 else 0 end
           - case when e.seen_recently then 0.6 else 0 end
           + e.noise * 1.2 )::numeric as raw_score
      from enriched e
     where e.available > 0
  ),
  diversified as (
    select s.*,
           (s.raw_score - (row_number() over (partition by s.shop_id order by s.raw_score desc) - 1) * 0.5)::numeric as score
      from scored s
     where (_category is null or s.category = _category)
  )
  select d.kind, d.id, d.name, d.description, d.image_path, d.price, d.available,
         d.category, d.brand, d.size_label, d.rating_avg, d.rating_count, d.sold_30d, d.views_30d,
         d.created_at, d.shop_id, d.shop_name, d.shop_slug, d.shop_logo_path, round(d.score, 4),
         d.created_at > now() - interval '14 days' as is_new,
         (d.heat >= 10 and d.heat_quartile = 1) as is_trending
    from diversified d
   order by
     case when _section = 'new' then d.created_at end desc nulls last,
     case when _section = 'trending' then (ln(1 + d.sold_30d) + ln(1 + d.views_30d) * 0.5) end desc nulls last,
     d.score desc, d.id
   limit least(greatest(coalesce(_limit, 24), 1), 60)
   offset greatest(coalesce(_offset, 0), 0);
$$;