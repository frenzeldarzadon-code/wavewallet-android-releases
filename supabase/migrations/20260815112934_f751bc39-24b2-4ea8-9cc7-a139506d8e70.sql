-- 1. Profiles admin policies: restrict to authenticated role
DROP POLICY IF EXISTS "Admins read profiles in their ecosystem" ON public.profiles;
CREATE POLICY "Admins read profiles in their ecosystem"
ON public.profiles FOR SELECT TO authenticated
USING ((ecosystem_id IS NOT NULL) AND is_ecosystem_admin(auth.uid(), ecosystem_id) AND (NOT is_super_admin(id)));

DROP POLICY IF EXISTS "Admins update profiles in their ecosystem" ON public.profiles;
CREATE POLICY "Admins update profiles in their ecosystem"
ON public.profiles FOR UPDATE TO authenticated
USING ((ecosystem_id IS NOT NULL) AND is_ecosystem_admin(auth.uid(), ecosystem_id) AND (NOT is_super_admin(id)));

-- 2. Reward redemptions staff policy: authenticated only
DROP POLICY IF EXISTS "Shop staff read redemptions" ON public.reward_redemptions;
CREATE POLICY "Shop staff read redemptions"
ON public.reward_redemptions FOR SELECT TO authenticated
USING (
  is_ecosystem_admin(auth.uid(), ecosystem_id)
  OR is_super_admin(auth.uid())
  OR ((has_role(auth.uid(), 'reseller'::app_role) OR has_role(auth.uid(), 'subreseller'::app_role))
      AND (ecosystem_id = current_ecosystem(auth.uid())))
);

-- 3. Reviews / ratings: no direct anonymous table reads (public storefront uses public_shop_reviews)
DROP POLICY IF EXISTS "Shop reviews are public" ON public.ecosystem_reviews;
CREATE POLICY "Shop reviews readable by members"
ON public.ecosystem_reviews FOR SELECT TO authenticated
USING (true);
REVOKE SELECT ON public.ecosystem_reviews FROM anon;

DROP POLICY IF EXISTS "Product ratings are public" ON public.retail_product_ratings;
CREATE POLICY "Product ratings readable by members"
ON public.retail_product_ratings FOR SELECT TO authenticated
USING (true);
REVOKE SELECT ON public.retail_product_ratings FROM anon;

-- 4. Revoke anonymous EXECUTE on non-public SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.cashback_chain(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cashback_split_preview(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.member_cashback_rate(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.voucher_discount_percent_for(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_member_cashback_rate(uuid, uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_expense(numeric, text, text, uuid, text, timestamptz, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_see_test_shop(uuid) FROM anon;

-- 5. Internal trigger function must not be callable by API roles
REVOKE EXECUTE ON FUNCTION public.membership_wallet_guard() FROM anon, authenticated, public;