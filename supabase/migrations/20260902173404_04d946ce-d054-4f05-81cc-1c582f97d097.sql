CREATE OR REPLACE FUNCTION public.universe_shop_search(_q text DEFAULT NULL::text, _limit integer DEFAULT 20)
 RETURNS TABLE(
   shop_id uuid, shop_name text, shop_slug text, shop_description text,
   product_id uuid, product_name text, product_description text,
   price numeric, available integer, product_matches boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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

REVOKE ALL ON FUNCTION public.universe_shop_search(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.universe_shop_search(text, integer) TO authenticated, service_role;

UPDATE public.ecosystems
   SET public_storefront_enabled = true
 WHERE id = '3a972878-ff7b-4dfb-8a5b-b681b1c81205'
   AND slug = 'sagadawave'
   AND shop_kind = 'universe';