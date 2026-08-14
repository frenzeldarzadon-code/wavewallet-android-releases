CREATE POLICY "Anyone can view retail product images" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'retail-images');

CREATE POLICY "Shop admins upload retail images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'retail-images'
    AND (public.is_super_admin(auth.uid())
         OR public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)));

CREATE POLICY "Shop admins replace retail images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'retail-images'
    AND (public.is_super_admin(auth.uid())
         OR public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)));

CREATE POLICY "Shop admins delete retail images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'retail-images'
    AND (public.is_super_admin(auth.uid())
         OR public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)));