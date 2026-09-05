CREATE OR REPLACE FUNCTION public.seller_storefront_retail(_handle text)
 RETURNS TABLE(seller_id uuid, shop_id uuid, shop_name text, shop_slug text, shop_description text, logo_path text, product_count integer, accepting_orders boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with seller as (
    select p.id
      from public.profiles p
     where lower(p.handle) = lower(ltrim(_handle, '@')) and p.deleted_at is null and p.status = 'active'
  )
  select s.id, e.id, e.name, e.slug, e.description, e.retail_logo_path,
         (select count(*)::int from public.retail_products r
           where r.ecosystem_id = e.id and r.published and not r.archived),
         coalesce(e.retail_accepting_orders, true)
    from seller s
    join public.shop_seller_authorizations a on a.user_id = s.id and a.active
    join public.ecosystems e on e.id = a.ecosystem_id
         and e.shop_kind = 'universe' and e.archived_at is null
         and e.frozen_at is null and not coalesce(e.operations_frozen, false)
         and e.public_storefront_enabled and e.store_retail_enabled
         and (not e.is_test or public.can_see_test_shop(e.id))
   order by e.name;
$function$;

REVOKE ALL ON FUNCTION public.seller_storefront_retail(text) FROM public;
GRANT EXECUTE ON FUNCTION public.seller_storefront_retail(text) TO anon, authenticated, service_role;