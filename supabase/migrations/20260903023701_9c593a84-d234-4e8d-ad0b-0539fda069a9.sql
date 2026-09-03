DROP FUNCTION IF EXISTS public.seller_storefront(text);
CREATE OR REPLACE FUNCTION public.seller_storefront(_handle text)
 RETURNS TABLE(seller_id uuid, seller_name text, seller_handle text, avatar_path text, store_name text, shop_id uuid, shop_name text, shop_slug text, product_id uuid, product_name text, description text, price numeric, available integer, points_price integer, credits_per_point numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with seller as (
    select p.id, p.full_name, p.handle, p.avatar_path,
           coalesce(nullif(btrim(p.preferences->>'storefront_name'), ''), p.full_name || '''s Store') as store_name
      from public.profiles p
     where lower(p.handle) = lower(ltrim(_handle, '@')) and p.deleted_at is null and p.status = 'active'
  )
  select s.id, s.full_name, s.handle, s.avatar_path, s.store_name,
         e.id, e.name, e.slug,
         v.id, v.name, v.description, coalesce(v.promo_price, v.credit_price),
         (select count(*)::int from public.voucher_codes c where c.product_id = v.id and c.status = 'unused'),
         v.points_price,
         e.credits_per_point
    from seller s
    join public.shop_seller_authorizations a on a.user_id = s.id and a.active
    join public.ecosystems e on e.id = a.ecosystem_id
         and e.shop_kind = 'universe' and e.archived_at is null
         and e.frozen_at is null and not coalesce(e.operations_frozen, false)
         and e.public_storefront_enabled and e.store_voucher_enabled
         and (not e.is_test or public.can_see_test_shop(e.id))
    join public.voucher_products v on v.ecosystem_id = e.id and v.active and not v.archived
   order by e.name, v.name;
$function$;
REVOKE ALL ON FUNCTION public.seller_storefront(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.seller_storefront(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.universe_sellers_for_shop(_slug text)
 RETURNS TABLE(seller_id uuid, seller_name text, seller_handle text, avatar_path text, store_name text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select p.id, p.full_name, p.handle, p.avatar_path,
         coalesce(nullif(btrim(p.preferences->>'storefront_name'), ''), p.full_name || '''s Store')
    from public.ecosystems e
    join public.shop_seller_authorizations a on a.ecosystem_id = e.id and a.active
    join public.profiles p on p.id = a.user_id and p.deleted_at is null and p.status = 'active' and p.handle is not null
   where e.slug = _slug and e.shop_kind = 'universe' and e.archived_at is null
     and e.frozen_at is null and not coalesce(e.operations_frozen, false)
     and e.public_storefront_enabled and e.store_voucher_enabled
     and (not e.is_test or public.can_see_test_shop(e.id))
   order by p.full_name;
$function$;

CREATE OR REPLACE FUNCTION public.universe_shop_search(_q text DEFAULT NULL::text, _limit integer DEFAULT 20)
 RETURNS TABLE(shop_id uuid, shop_name text, shop_slug text, shop_description text, product_id uuid, product_name text, product_description text, price numeric, available integer, product_matches boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with q as (
    select nullif(lower(btrim(coalesce(_q, ''))), '') as term
  ),
  shops as (
    select e.id, e.name, e.slug, e.description
      from public.ecosystems e, q
     where e.shop_kind = 'universe'
       and e.archived_at is null
       and e.frozen_at is null
       and not coalesce(e.operations_frozen, false)
       and e.public_storefront_enabled
       and e.store_voucher_enabled
       and (not e.is_test or public.can_see_test_shop(e.id))
       and (
         q.term is null
         or lower(e.name) like '%' || q.term || '%'
         or exists (
           select 1 from public.voucher_products v
            where v.ecosystem_id = e.id and v.active and not v.archived
              and lower(v.name) like '%' || q.term || '%'
         )
       )
     order by e.name
     limit least(greatest(coalesce(_limit, 20), 1), 50)
  )
  select s.id, s.name, s.slug, s.description,
         v.id, v.name, v.description,
         coalesce(v.promo_price, v.credit_price),
         (select count(*)::int from public.voucher_codes c where c.product_id = v.id and c.status = 'unused'),
         (q.term is not null and lower(v.name) like '%' || q.term || '%')
    from shops s
    cross join q
    left join public.voucher_products v on v.ecosystem_id = s.id and v.active and not v.archived
   order by s.name, v.name;
$function$;