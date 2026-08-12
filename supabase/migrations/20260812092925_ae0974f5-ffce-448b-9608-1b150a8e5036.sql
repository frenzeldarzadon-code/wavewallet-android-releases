-- Public signup resolves shops through get_signup_ecosystem(), which returns only
-- name/slug/description. The table itself must not be browsable, because rows carry
-- the signup token, contact details and payment references of every tenant.
DROP POLICY IF EXISTS "Public can read shops with an active signup link" ON public.ecosystems;
REVOKE SELECT ON public.ecosystems FROM anon;

DROP POLICY IF EXISTS "Members can read their own ecosystem" ON public.ecosystems;
CREATE POLICY "Members read only their own ecosystem"
  ON public.ecosystems FOR SELECT TO authenticated
  USING (id = public.current_ecosystem(auth.uid()) OR public.is_super_admin(auth.uid()));