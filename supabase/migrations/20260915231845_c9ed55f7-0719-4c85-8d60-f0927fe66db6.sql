drop function if exists public.seller_storefront(text);
create function public.seller_storefront(_handle text)
 returns table(seller_id uuid, seller_name text, seller_handle text, avatar_path text, store_name text, shop_id uuid, shop_name text, shop_slug text, product_id uuid, product_name text, description text, price numeric, available integer, points_price integer, credits_per_point numeric, display_position integer)
 language sql stable security definer set search_path to 'public'
as $function$
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
         e.credits_per_point,
         coalesce(o.display_position, 2147483647)
    from seller s
    join public.shop_seller_authorizations a on a.user_id = s.id and a.active
    join public.ecosystems e on e.id = a.ecosystem_id
         and e.shop_kind = 'universe' and e.archived_at is null
         and e.frozen_at is null and not coalesce(e.operations_frozen, false)
         and e.public_storefront_enabled and e.store_voucher_enabled
         and (not e.is_test or public.can_see_test_shop(e.id))
    join public.voucher_products v on v.ecosystem_id = e.id and v.active and not v.archived
    left join public.seller_storefront_section_order(_handle) o
      on o.section_key = 'voucher:' || e.id::text
   order by coalesce(o.display_position, 2147483647), e.name, v.name;
$function$;
revoke all on function public.seller_storefront(text) from public, anon;
grant execute on function public.seller_storefront(text) to authenticated, service_role;

drop function if exists public.seller_storefront_retail(text);
create function public.seller_storefront_retail(_handle text)
 returns table(seller_id uuid, seller_name text, seller_handle text, avatar_path text, store_name text, shop_id uuid, shop_name text, shop_slug text, shop_description text, logo_path text, product_count integer, accepting_orders boolean, display_position integer)
 language sql stable security definer set search_path to 'public'
as $function$
  with seller as (
    select p.id, p.full_name, p.handle, p.avatar_path,
           coalesce(nullif(btrim(p.preferences->>'storefront_name'), ''), p.full_name || '''s Store') as store_name
      from public.profiles p
     where lower(p.handle) = lower(ltrim(_handle, '@')) and p.deleted_at is null and p.status = 'active'
  )
  select s.id, s.full_name, s.handle, s.avatar_path, s.store_name,
         e.id, e.name, e.slug, e.description, e.retail_logo_path,
         (select count(*)::int from public.retail_products r
           where r.ecosystem_id = e.id and r.published and not r.archived),
         coalesce(e.retail_accepting_orders, true),
         coalesce(o.display_position, 2147483647)
    from seller s
    join public.shop_seller_authorizations a on a.user_id = s.id and a.active
    join public.ecosystems e on e.id = a.ecosystem_id
         and e.shop_kind = 'universe' and e.archived_at is null
         and e.frozen_at is null and not coalesce(e.operations_frozen, false)
         and e.public_storefront_enabled and e.store_retail_enabled
         and (not e.is_test or public.can_see_test_shop(e.id))
    left join public.seller_storefront_section_order(_handle) o
      on o.section_key = 'retail:' || e.id::text
   order by coalesce(o.display_position, 2147483647), e.name;
$function$;
revoke all on function public.seller_storefront_retail(text) from public, anon;
grant execute on function public.seller_storefront_retail(text) to authenticated, service_role;

revoke all on function public.seller_storefront_section_order(text) from public, anon, authenticated;
grant execute on function public.seller_storefront_section_order(text) to service_role;