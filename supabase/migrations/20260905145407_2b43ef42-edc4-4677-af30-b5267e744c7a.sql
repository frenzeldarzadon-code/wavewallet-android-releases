create table public.universe_product_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  product_kind text not null check (product_kind in ('voucher','retail')),
  product_id uuid not null,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
grant select, insert on public.universe_product_views to authenticated;
grant all on public.universe_product_views to service_role;
alter table public.universe_product_views enable row level security;
create policy "members read own product views" on public.universe_product_views
  for select to authenticated using (user_id = auth.uid());
create policy "members insert own product views" on public.universe_product_views
  for insert to authenticated with check (user_id = auth.uid());
create index universe_product_views_product_idx on public.universe_product_views (product_id, viewed_at desc);
create index universe_product_views_user_idx on public.universe_product_views (user_id, viewed_at desc);

-- Shops whose products may appear anywhere in the Universe marketplace.
create or replace function public.universe_marketplace_shops()
returns setof public.ecosystems
language sql stable security definer set search_path = public as $$
  select e.* from public.ecosystems e
   where e.shop_kind = 'universe'
     and e.archived_at is null and e.frozen_at is null
     and not coalesce(e.operations_frozen, false)
     and e.public_storefront_enabled
     and (not e.is_test or public.can_see_test_shop(e.id));
$$;
revoke all on function public.universe_marketplace_shops() from public, anon;

create or replace function public.record_universe_product_view(_kind text, _product_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  _eco uuid;
begin
  if auth.uid() is null then return; end if;
  if _kind = 'retail' then
    select p.ecosystem_id into _eco from public.retail_products p
      join public.universe_marketplace_shops() s on s.id = p.ecosystem_id and s.store_retail_enabled
     where p.id = _product_id and p.active and p.published and not p.archived and p.public_visible;
  elsif _kind = 'voucher' then
    select v.ecosystem_id into _eco from public.voucher_products v
      join public.universe_marketplace_shops() s on s.id = v.ecosystem_id and s.store_voucher_enabled
     where v.id = _product_id and v.active and not v.archived;
  else
    return;
  end if;
  if _eco is null then return; end if;
  if exists (select 1 from public.universe_product_views
              where user_id = auth.uid() and product_id = _product_id
                and viewed_at > now() - interval '10 minutes') then
    return;
  end if;
  insert into public.universe_product_views (user_id, product_kind, product_id, ecosystem_id)
  values (auth.uid(), _kind, _product_id, _eco);
end;
$$;
revoke all on function public.record_universe_product_view(text, uuid) from public, anon;
grant execute on function public.record_universe_product_view(text, uuid) to authenticated, service_role;

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
       and (_category is null or e.category = _category)
  ),
  diversified as (
    select s.*,
           (s.raw_score - (row_number() over (partition by s.shop_id order by s.raw_score desc) - 1) * 0.5)::numeric as score
      from scored s
  )
  select d.kind, d.id, d.name, d.description, d.image_path, d.price, d.available,
         d.category, d.brand, d.size_label, d.rating_avg, d.rating_count, d.sold_30d, d.views_30d,
         d.created_at, d.shop_id, d.shop_name, d.shop_slug, d.shop_logo_path, round(d.score, 4),
         d.created_at > now() - interval '14 days' as is_new,
         (d.sold_30d + d.views_30d) >= 3 as is_trending
    from diversified d
   order by
     case when _section = 'new' then d.created_at end desc nulls last,
     case when _section = 'trending' then (ln(1 + d.sold_30d) + ln(1 + d.views_30d) * 0.5) end desc nulls last,
     d.score desc, d.id
   limit least(greatest(coalesce(_limit, 24), 1), 60)
   offset greatest(coalesce(_offset, 0), 0);
$$;
revoke all on function public.universe_product_feed(text, text, integer, integer, integer) from public, anon;
grant execute on function public.universe_product_feed(text, text, integer, integer, integer) to authenticated, service_role;

create or replace function public.universe_product_categories()
returns table(category text, product_count integer)
language sql stable security definer set search_path = public as $$
  select p.category, count(*)::int
    from public.retail_products p
    join public.universe_marketplace_shops() s on s.id = p.ecosystem_id and s.store_retail_enabled
   where p.active and p.published and not p.archived and p.public_visible and p.stock > 0
     and p.category is not null
   group by p.category order by 2 desc, 1;
$$;
revoke all on function public.universe_product_categories() from public, anon;
grant execute on function public.universe_product_categories() to authenticated, service_role;