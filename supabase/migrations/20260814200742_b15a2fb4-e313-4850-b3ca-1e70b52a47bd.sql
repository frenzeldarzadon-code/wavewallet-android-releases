ALTER TABLE public.ecosystems ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.ecosystems.is_test IS 'Internal/test shop: hidden from ordinary discovery, storefront and signup surfaces.';

UPDATE public.ecosystems SET is_test = true WHERE slug = 'demo-preview';

-- Who may still see internal/test shops: platform owners, and members of that shop.
CREATE OR REPLACE FUNCTION public.can_see_test_shop(_ecosystem_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND (
       public.is_super_admin(auth.uid())
       OR EXISTS (SELECT 1 FROM public.ecosystem_memberships m
                   WHERE m.ecosystem_id = _ecosystem_id
                     AND m.user_id = auth.uid()
                     AND m.membership_state = 'active')
     );
$function$;

REVOKE ALL ON FUNCTION public.can_see_test_shop(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_test_shop(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_public_shops(_q text DEFAULT NULL::text, _limit integer DEFAULT 30)
 RETURNS TABLE(id uuid, name text, slug text, description text, member_count integer, rating_avg numeric, rating_count integer, voucher_enabled boolean, retail_enabled boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.name, e.slug, e.description,
         (SELECT count(*)::int FROM public.ecosystem_memberships m
           WHERE m.ecosystem_id = e.id AND m.membership_state = 'active'),
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.ecosystem_reviews r
                    WHERE r.ecosystem_id = e.id),0)::numeric,
         coalesce((SELECT count(*)::int FROM public.ecosystem_reviews r
                    WHERE r.ecosystem_id = e.id),0),
         e.store_voucher_enabled, e.store_retail_enabled
    FROM public.ecosystems e
   WHERE e.archived_at IS NULL AND e.public_storefront_enabled
     AND (NOT e.is_test OR public.can_see_test_shop(e.id))
     AND (_q IS NULL OR btrim(_q) = '' OR lower(e.name) LIKE '%' || lower(btrim(_q)) || '%')
   ORDER BY e.name
   LIMIT least(greatest(coalesce(_limit, 30), 1), 100);
$function$;

CREATE OR REPLACE FUNCTION public.list_signup_ecosystems()
 RETURNS TABLE(id uuid, name text, slug text, description text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id, e.name, e.slug, e.description
  from public.ecosystems e
  where e.signup_enabled
    and e.archived_at is null
    and e.subscription_state = 'active'
    and not coalesce(e.operations_frozen, false)
    and not e.is_test
    and public.ecosystem_has_admin(e.id)
  order by e.name
$function$;

CREATE OR REPLACE FUNCTION public.joinable_ecosystems()
 RETURNS TABLE(id uuid, name text, slug text, description text, pending boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.name, e.slug, e.description,
         EXISTS (SELECT 1 FROM public.membership_applications a
                  WHERE a.user_id = public.effective_uid()
                    AND a.ecosystem_id = e.id AND a.status = 'pending')
  FROM public.ecosystems e
  WHERE e.signup_enabled AND e.archived_at IS NULL
    AND e.subscription_state = 'active'
    AND NOT COALESCE(e.operations_frozen, false)
    AND (NOT e.is_test OR public.is_super_admin(auth.uid()))
    AND public.ecosystem_has_admin(e.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.ecosystem_memberships m
       WHERE m.user_id = public.effective_uid()
         AND m.ecosystem_id = e.id AND m.membership_state = 'active')
  ORDER BY e.name;
$function$;

CREATE OR REPLACE FUNCTION public.public_shop_overview(_slug text)
 RETURNS TABLE(id uuid, name text, slug text, description text, contact_email text, contact_phone text, facebook_page_url text, admin_name text, member_count integer, product_count integer, sales_count integer, rating_avg numeric, rating_count integer, voucher_enabled boolean, retail_enabled boolean, storefront_public boolean, has_admin boolean, is_member boolean, pending_application boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.name, e.slug, e.description, e.contact_email, e.contact_phone, e.facebook_page_url,
         (SELECT pr.full_name FROM public.user_roles ur
            JOIN public.profiles pr ON pr.id = ur.user_id
           WHERE ur.ecosystem_id = e.id AND ur.role = 'admin' LIMIT 1),
         (SELECT count(*)::int FROM public.ecosystem_memberships m
           WHERE m.ecosystem_id = e.id AND m.membership_state = 'active'),
         (SELECT count(*)::int FROM public.retail_products p
           WHERE p.ecosystem_id = e.id AND p.active AND NOT p.archived AND p.public_visible)
         + (SELECT count(*)::int FROM public.voucher_products v
             WHERE v.ecosystem_id = e.id AND v.active AND NOT v.archived),
         (SELECT count(*)::int FROM public.voucher_sales s
           WHERE s.ecosystem_id = e.id AND s.refunded_at IS NULL)
         + (SELECT count(*)::int FROM public.retail_orders o
             WHERE o.ecosystem_id = e.id AND o.status = 'approved'),
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.ecosystem_reviews r
                    WHERE r.ecosystem_id = e.id), 0)::numeric,
         coalesce((SELECT count(*)::int FROM public.ecosystem_reviews r
                    WHERE r.ecosystem_id = e.id), 0),
         e.store_voucher_enabled, e.store_retail_enabled, e.public_storefront_enabled,
         public.ecosystem_has_admin(e.id),
         auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m
            WHERE m.ecosystem_id = e.id AND m.user_id = auth.uid() AND m.membership_state = 'active'),
         auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.membership_applications a
            WHERE a.ecosystem_id = e.id AND a.user_id = auth.uid() AND a.status = 'pending')
    FROM public.ecosystems e
   WHERE e.slug = _slug AND e.archived_at IS NULL AND e.public_storefront_enabled
     AND (NOT e.is_test OR public.can_see_test_shop(e.id));
$function$;

CREATE OR REPLACE FUNCTION public.public_shop_products(_slug text)
 RETURNS TABLE(kind text, id uuid, name text, description text, image_path text, price numeric, available integer, rating_avg numeric, rating_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH shop AS (
    SELECT e.* FROM public.ecosystems e
     WHERE e.slug = _slug AND e.archived_at IS NULL AND e.public_storefront_enabled
       AND (NOT e.is_test OR public.can_see_test_shop(e.id)))
  SELECT 'retail'::text, p.id, p.name, p.description, p.image_path, p.price, p.stock,
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.retail_product_ratings r
                    WHERE r.product_id = p.id),0)::numeric,
         coalesce((SELECT count(*)::int FROM public.retail_product_ratings r
                    WHERE r.product_id = p.id),0)
    FROM public.retail_products p JOIN shop s ON s.id = p.ecosystem_id
   WHERE s.store_retail_enabled AND p.active AND NOT p.archived AND p.public_visible
  UNION ALL
  SELECT 'voucher'::text, v.id, v.name, v.description, NULL, v.credit_price,
         (SELECT count(*)::int FROM public.voucher_codes c
           WHERE c.product_id = v.id AND c.status = 'unused'),
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.product_ratings r
                    WHERE r.product_id = v.id),0)::numeric,
         coalesce((SELECT count(*)::int FROM public.product_ratings r
                    WHERE r.product_id = v.id),0)
    FROM public.voucher_products v JOIN shop s ON s.id = v.ecosystem_id
   WHERE s.store_voucher_enabled AND v.active AND NOT v.archived
   ORDER BY 1, 3;
$function$;

CREATE OR REPLACE FUNCTION public.public_shop_reviews(_slug text, _limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, author_name text, rating integer, comment text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.id, r.author_name, r.rating, r.comment, r.created_at
    FROM public.ecosystem_reviews r
    JOIN public.ecosystems e ON e.id = r.ecosystem_id
   WHERE e.slug = _slug AND e.public_storefront_enabled
     AND (NOT e.is_test OR public.can_see_test_shop(e.id))
   ORDER BY r.created_at DESC
   LIMIT least(greatest(coalesce(_limit, 20), 1), 100);
$function$;