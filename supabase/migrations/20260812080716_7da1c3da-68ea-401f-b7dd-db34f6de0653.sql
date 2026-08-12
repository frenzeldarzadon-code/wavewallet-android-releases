create policy "Members view reward images in their shop"
on storage.objects for select to authenticated
using (
  bucket_id = 'reward-images' and (
    public.is_super_admin(auth.uid())
    or (storage.foldername(name))[1] = public.current_ecosystem(auth.uid())::text
  )
);

create policy "Shop admins upload reward images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'reward-images' and (
    public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
);

create policy "Shop admins replace reward images"
on storage.objects for update to authenticated
using (
  bucket_id = 'reward-images' and (
    public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
);

create policy "Shop admins delete reward images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'reward-images' and (
    public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
);