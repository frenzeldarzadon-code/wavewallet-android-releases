DROP POLICY IF EXISTS "Shop reviews readable by members" ON public.ecosystem_reviews;
CREATE POLICY "Shop reviews readable by members" ON public.ecosystem_reviews
FOR SELECT TO authenticated
USING (
  user_id = public.effective_uid()
  OR public.is_super_admin(public.effective_uid())
  OR EXISTS (
    SELECT 1 FROM public.ecosystem_memberships m
     WHERE m.ecosystem_id = ecosystem_reviews.ecosystem_id
       AND m.user_id = public.effective_uid()
  )
);

DROP POLICY IF EXISTS "Product ratings readable by members" ON public.retail_product_ratings;
CREATE POLICY "Product ratings readable by members" ON public.retail_product_ratings
FOR SELECT TO authenticated
USING (
  user_id = public.effective_uid()
  OR public.is_super_admin(public.effective_uid())
  OR EXISTS (
    SELECT 1 FROM public.ecosystem_memberships m
     WHERE m.ecosystem_id = retail_product_ratings.ecosystem_id
       AND m.user_id = public.effective_uid()
  )
);