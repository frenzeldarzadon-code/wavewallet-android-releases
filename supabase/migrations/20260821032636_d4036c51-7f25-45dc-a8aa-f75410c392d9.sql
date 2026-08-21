DROP POLICY IF EXISTS "Shop staff read redemptions" ON public.reward_redemptions;
CREATE POLICY "Shop staff read redemptions"
ON public.reward_redemptions
FOR SELECT
TO authenticated
USING (
  is_ecosystem_admin(auth.uid(), ecosystem_id)
  OR is_super_admin(auth.uid())
  OR membership_role(auth.uid(), ecosystem_id) IN ('reseller'::app_role, 'subreseller'::app_role)
);

DROP POLICY IF EXISTS "Staff read retention runs" ON public.retention_runs;
CREATE POLICY "Staff read retention runs"
ON public.retention_runs
FOR SELECT
TO authenticated
USING (is_super_admin(auth.uid()));