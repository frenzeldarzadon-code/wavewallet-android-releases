drop policy if exists "Retail images follow product visibility" on storage.objects;
create policy "Retail images follow product visibility"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'retail-images'
    and (
      exists (
        select 1 from public.retail_products p
        join public.ecosystems e on e.id = p.ecosystem_id
        where p.image_path = storage.objects.name
          and p.active and not p.archived and p.public_visible
          and e.public_storefront_enabled and e.store_retail_enabled
          and e.archived_at is null
      )
      or exists (
        select 1 from public.ecosystems e
        where (e.retail_logo_path = storage.objects.name or e.retail_cover_path = storage.objects.name)
          and e.public_storefront_enabled
          and public.is_universe_shop(e.id)
          and e.archived_at is null
      )
      or (
        split_part(storage.objects.name, '/', 1)
          ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and (
          public.is_super_admin(auth.uid())
          or public.is_ecosystem_admin(auth.uid(), split_part(storage.objects.name, '/', 1)::uuid)
          or public.has_membership(auth.uid(), split_part(storage.objects.name, '/', 1)::uuid)
        )
      )
    )
  );