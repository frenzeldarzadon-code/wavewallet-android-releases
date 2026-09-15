create or replace function public.seller_storefront_section_order(_handle text)
returns table(section_key text, section_kind text, shop_id uuid, display_position integer)
language sql
stable
security definer
set search_path = public
as $$
  with seller as (
    select p.id, coalesce(p.preferences->'storefront_section_order', '[]'::jsonb) as saved_order
      from public.profiles p
     where lower(p.handle) = lower(ltrim(_handle, '@'))
       and p.deleted_at is null
       and p.status = 'active'
  ), visible_sections as (
    select distinct
           'voucher:' || e.id::text as section_key,
           'voucher'::text as section_kind,
           e.id as shop_id,
           e.name as shop_name
      from seller s
      join public.shop_seller_authorizations a on a.user_id = s.id and a.active
      join public.ecosystems e on e.id = a.ecosystem_id
       and e.shop_kind = 'universe'
       and e.archived_at is null
       and e.frozen_at is null
       and not coalesce(e.operations_frozen, false)
       and e.public_storefront_enabled
       and e.store_voucher_enabled
       and (not e.is_test or public.can_see_test_shop(e.id))
     where exists (
       select 1 from public.voucher_products v
        where v.ecosystem_id = e.id and v.active and not v.archived
     )
    union all
    select distinct
           'retail:' || e.id::text,
           'retail'::text,
           e.id,
           e.name
      from seller s
      join public.shop_seller_authorizations a on a.user_id = s.id and a.active
      join public.ecosystems e on e.id = a.ecosystem_id
       and e.shop_kind = 'universe'
       and e.archived_at is null
       and e.frozen_at is null
       and not coalesce(e.operations_frozen, false)
       and e.public_storefront_enabled
       and e.store_retail_enabled
       and (not e.is_test or public.can_see_test_shop(e.id))
  ), ranked as (
    select v.*,
           (
             select min(o.ordinality)::int
               from seller s
               cross join lateral jsonb_array_elements_text(
                 case when jsonb_typeof(s.saved_order) = 'array' then s.saved_order else '[]'::jsonb end
               ) with ordinality as o(value, ordinality)
              where o.value = v.section_key
           ) as saved_position
      from visible_sections v
  )
  select r.section_key, r.section_kind, r.shop_id,
         row_number() over (
           order by r.saved_position nulls last, r.shop_name, r.section_kind
         )::int as display_position
    from ranked r
   order by display_position;
$$;

revoke all on function public.seller_storefront_section_order(text) from public, anon;
grant execute on function public.seller_storefront_section_order(text) to authenticated, service_role;

comment on function public.seller_storefront_section_order(text) is
  'Safe Profile storefront section order: intersects the owner preference with currently visible authorized Voucher and Retail shop sections, appending new sections deterministically.';