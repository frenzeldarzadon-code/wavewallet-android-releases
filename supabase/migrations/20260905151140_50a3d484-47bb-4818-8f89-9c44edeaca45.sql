create or replace function public.retail_image_visible(_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    -- A published, publicly visible product of a public, live shop.
    exists (
      select 1
        from public.retail_products p
        join public.ecosystems e on e.id = p.ecosystem_id
       where p.image_path = _name
         and p.active and p.published and not p.archived and p.public_visible
         and e.public_storefront_enabled and e.store_retail_enabled
         and e.archived_at is null and e.frozen_at is null
         and not coalesce(e.operations_frozen, false)
         and (not e.is_test or public.can_see_test_shop(e.id))
    )
    -- The public logo / cover of a Universe shop.
    or exists (
      select 1 from public.ecosystems e
       where (e.retail_logo_path = _name or e.retail_cover_path = _name)
         and e.public_storefront_enabled
         and e.shop_kind = 'universe'
         and e.archived_at is null
    )
    -- Shop members, shop admins and the Super Admin see their own shop's folder.
    or (
      split_part(_name, '/', 1)
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and auth.uid() is not null
      and (
        public.is_super_admin(auth.uid())
        or public.is_ecosystem_admin(auth.uid(), split_part(_name, '/', 1)::uuid)
        or public.has_membership(auth.uid(), split_part(_name, '/', 1)::uuid)
      )
    );
$$;

revoke all on function public.retail_image_visible(text) from public;
grant execute on function public.retail_image_visible(text) to anon, authenticated, service_role;

drop policy if exists "Retail images follow product visibility" on storage.objects;
create policy "Retail images follow product visibility"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'retail-images' and public.retail_image_visible(name));