-- 1. Shop ID + shop address on New Generation shops -------------------------
ALTER TABLE public.ecosystems
  ADD COLUMN IF NOT EXISTS shop_code text,
  ADD COLUMN IF NOT EXISTS shop_province text,
  ADD COLUMN IF NOT EXISTS shop_city_municipality text,
  ADD COLUMN IF NOT EXISTS shop_barangay text,
  ADD COLUMN IF NOT EXISTS shop_street text;

CREATE UNIQUE INDEX IF NOT EXISTS ecosystems_shop_code_key ON public.ecosystems (shop_code);

CREATE OR REPLACE FUNCTION public.generate_shop_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _c text; _i int := 0;
BEGIN
  LOOP
    _i := _i + 1;
    _c := lpad(((floor(random() * 9000000))::bigint + 1000000)::text, 7, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ecosystems WHERE shop_code = _c);
    IF _i > 200 THEN RAISE EXCEPTION 'Could not allocate a Shop ID'; END IF;
  END LOOP;
  RETURN _c;
END $$;

CREATE OR REPLACE FUNCTION public.assign_shop_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- New Generation shops only. Legacy shops keep slug + signup_token joining.
  IF NEW.shop_kind = 'subscription' AND NEW.shop_code IS NULL THEN
    NEW.shop_code := public.generate_shop_code();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ecosystems_assign_shop_code ON public.ecosystems;
CREATE TRIGGER ecosystems_assign_shop_code
BEFORE INSERT OR UPDATE OF shop_kind ON public.ecosystems
FOR EACH ROW EXECUTE FUNCTION public.assign_shop_code();

-- Backfill existing New Generation shops.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.ecosystems WHERE shop_kind = 'subscription' AND shop_code IS NULL LOOP
    UPDATE public.ecosystems SET shop_code = public.generate_shop_code() WHERE id = r.id;
  END LOOP;
END $$;

-- 2. Effective discovery location: shop address, else the shop admin's address
CREATE OR REPLACE FUNCTION public.shop_effective_location(_ecosystem_id uuid)
RETURNS TABLE(province text, city_municipality text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(NULLIF(btrim(e.shop_province), ''), NULLIF(btrim(p.province), '')),
    COALESCE(NULLIF(btrim(e.shop_city_municipality), ''), NULLIF(btrim(p.city_municipality), ''))
  FROM public.ecosystems e
  LEFT JOIN LATERAL (
    SELECT pr.province, pr.city_municipality
    FROM public.ecosystem_memberships m
    JOIN public.profiles pr ON pr.id = m.user_id
    WHERE m.ecosystem_id = e.id AND m.role = 'admin' AND m.membership_state = 'active'
    ORDER BY m.joined_at NULLS LAST
    LIMIT 1
  ) p ON true
  WHERE e.id = _ecosystem_id;
$$;

-- Shops eligible for discovery / Shop-ID joining.
CREATE OR REPLACE VIEW public.discoverable_shops AS
SELECT e.id, e.name, e.shop_code, loc.province, loc.city_municipality
FROM public.ecosystems e
CROSS JOIN LATERAL public.shop_effective_location(e.id) loc
WHERE e.shop_kind = 'subscription'
  AND e.shop_code IS NOT NULL
  AND e.archived_at IS NULL
  AND e.signup_enabled
  AND e.subscription_state = 'active'
  AND NOT COALESCE(e.operations_frozen, false)
  AND NOT COALESCE(e.is_test, false)
  AND NOT COALESCE(e.is_review, false)
  AND public.ecosystem_has_admin(e.id);

REVOKE ALL ON public.discoverable_shops FROM anon, authenticated;

-- 3. Minimal, privacy-safe lookups ------------------------------------------
CREATE OR REPLACE FUNCTION public.find_shop_by_code(_code text)
RETURNS TABLE(id uuid, name text, shop_code text, province text, city_municipality text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT d.id, d.name, d.shop_code, d.province, d.city_municipality
  FROM public.discoverable_shops d
  WHERE d.shop_code = btrim(_code)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.shop_discovery_municipalities()
RETURNS TABLE(province text, city_municipality text, shop_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT d.province, d.city_municipality, count(*)
  FROM public.discoverable_shops d
  WHERE d.province IS NOT NULL AND d.city_municipality IS NOT NULL
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

CREATE OR REPLACE FUNCTION public.shops_in_municipality(_province text, _city text)
RETURNS TABLE(id uuid, name text, shop_code text, province text, city_municipality text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT d.id, d.name, d.shop_code, d.province, d.city_municipality
  FROM public.discoverable_shops d
  WHERE lower(btrim(d.province)) = lower(btrim(_province))
    AND lower(btrim(d.city_municipality)) = lower(btrim(_city))
  ORDER BY d.name
  LIMIT 100;
$$;

-- 4. Join by Shop ID (reuses the existing join rules) ------------------------
CREATE OR REPLACE FUNCTION public.join_shop_by_code(_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _eco uuid;
BEGIN
  SELECT d.id INTO _eco FROM public.discoverable_shops d WHERE d.shop_code = btrim(_code);
  IF _eco IS NULL THEN
    RAISE EXCEPTION 'No shop found with that Shop ID.';
  END IF;
  PERFORM public.request_join_ecosystem(_eco);
  RETURN _eco;
END $$;

-- 5. Shop address maintenance (shop admin, New Generation only) --------------
CREATE OR REPLACE FUNCTION public.set_shop_address(
  _ecosystem_id uuid,
  _province text DEFAULT NULL,
  _city_municipality text DEFAULT NULL,
  _barangay text DEFAULT NULL,
  _street text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _kind text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT shop_kind INTO _kind FROM public.ecosystems WHERE id = _ecosystem_id;
  IF _kind IS NULL THEN RAISE EXCEPTION 'Shop not found'; END IF;
  IF _kind <> 'subscription' THEN
    RAISE EXCEPTION 'Shop Address applies to New Generation shops only.';
  END IF;
  IF NOT public.is_super_admin(_uid) AND NOT EXISTS (
    SELECT 1 FROM public.ecosystem_memberships m
    WHERE m.user_id = _uid AND m.ecosystem_id = _ecosystem_id
      AND m.role = 'admin' AND m.membership_state = 'active'
  ) THEN
    RAISE EXCEPTION 'Only the shop admin can change the Shop Address.';
  END IF;

  UPDATE public.ecosystems SET
    shop_province = NULLIF(btrim(COALESCE(_province, '')), ''),
    shop_city_municipality = NULLIF(btrim(COALESCE(_city_municipality, '')), ''),
    shop_barangay = NULLIF(btrim(COALESCE(_barangay, '')), ''),
    shop_street = NULLIF(btrim(COALESCE(_street, '')), ''),
    updated_at = now()
  WHERE id = _ecosystem_id;
END $$;

-- 6. Execute grants ----------------------------------------------------------
REVOKE ALL ON FUNCTION public.generate_shop_code() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_shop_code() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.shop_effective_location(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_shop_by_code(text) FROM public;
REVOKE ALL ON FUNCTION public.shop_discovery_municipalities() FROM public;
REVOKE ALL ON FUNCTION public.shops_in_municipality(text, text) FROM public;
REVOKE ALL ON FUNCTION public.join_shop_by_code(text) FROM public;
REVOKE ALL ON FUNCTION public.set_shop_address(uuid, text, text, text, text) FROM public;

GRANT EXECUTE ON FUNCTION public.find_shop_by_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_discovery_municipalities() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_in_municipality(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_shop_by_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_shop_address(uuid, text, text, text, text) TO authenticated;

-- 7. Username minimum length relaxed to 1 character ---------------------------
ALTER TABLE public.login_usernames DROP CONSTRAINT IF EXISTS login_usernames_username_check;
ALTER TABLE public.login_usernames
  ADD CONSTRAINT login_usernames_username_check
  CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{0,31}$');