-- Profile photos for platform-level members (no ecosystem) were impossible to
-- upload, because every storage policy required the first folder to equal the
-- caller's ecosystem id (NULL for the platform owner). They now use a
-- dedicated "platform" folder, still scoped to their own user id.

DROP POLICY IF EXISTS "Members upload their own avatar" ON storage.objects;
CREATE POLICY "Members upload their own avatar"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[2] = (auth.uid())::text
  AND (
    (storage.foldername(name))[1] = (public.current_ecosystem(auth.uid()))::text
    OR (
      public.current_ecosystem(auth.uid()) IS NULL
      AND (storage.foldername(name))[1] = 'platform'
    )
  )
);

DROP POLICY IF EXISTS "Shop members view avatars" ON storage.objects;
CREATE POLICY "Shop members view avatars"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    public.is_super_admin(auth.uid())
    OR (storage.foldername(name))[2] = (auth.uid())::text
    OR (storage.foldername(name))[1] = (public.current_ecosystem(auth.uid()))::text
  )
);
