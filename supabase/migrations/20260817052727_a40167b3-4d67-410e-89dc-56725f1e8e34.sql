-- Tenant isolation: a member may only claim a shop on their own profile row
-- when an approved membership already exists. UPDATE was already guarded by
-- public.guard_profile_update; this closes the INSERT path and states the same
-- rule in the policies so it is enforced declaratively too.

DROP POLICY IF EXISTS "Insert own profile" ON public.profiles;
CREATE POLICY "Insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  id = auth.uid()
  AND (
    ecosystem_id IS NULL
    OR public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.ecosystem_memberships m
       WHERE m.user_id = auth.uid()
         AND m.ecosystem_id = profiles.ecosystem_id
         AND m.membership_state = 'active'
    )
  )
  AND (
    active_ecosystem_id IS NULL
    OR public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.ecosystem_memberships m
       WHERE m.user_id = auth.uid()
         AND m.ecosystem_id = profiles.active_ecosystem_id
         AND m.membership_state = 'active'
    )
  )
);

DROP POLICY IF EXISTS "Update own profile" ON public.profiles;
CREATE POLICY "Update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND (
    ecosystem_id IS NULL
    OR public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.ecosystem_memberships m
       WHERE m.user_id = auth.uid()
         AND m.ecosystem_id = profiles.ecosystem_id
         AND m.membership_state = 'active'
    )
  )
  AND (
    active_ecosystem_id IS NULL
    OR public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.ecosystem_memberships m
       WHERE m.user_id = auth.uid()
         AND m.ecosystem_id = profiles.active_ecosystem_id
         AND m.membership_state = 'active'
    )
  )
);