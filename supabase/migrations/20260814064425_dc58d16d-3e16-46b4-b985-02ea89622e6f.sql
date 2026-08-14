-- 0. The old read-only convenience view is superseded by a real table.
DROP VIEW IF EXISTS public.ecosystem_memberships;

-- 1. Membership table -------------------------------------------------------
CREATE TABLE public.ecosystem_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'customer',
  status public.account_status NOT NULL DEFAULT 'active',
  membership_state text NOT NULL DEFAULT 'active'
    CHECK (membership_state IN ('pending','active','rejected','removed')),
  reseller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reseller_discount_percent integer NOT NULL DEFAULT 0,
  reseller_commission_percent integer,
  sale_commission_percent integer,
  handle text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ecosystem_id)
);

GRANT SELECT ON public.ecosystem_memberships TO authenticated;
GRANT ALL ON public.ecosystem_memberships TO service_role;
ALTER TABLE public.ecosystem_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own memberships"
ON public.ecosystem_memberships FOR SELECT TO authenticated
USING (user_id = public.effective_uid() OR user_id = auth.uid());

CREATE POLICY "Operators read memberships in their ecosystem"
ON public.ecosystem_memberships FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = auth.uid()
      AND r.role IN ('admin','reseller','subreseller')
      AND r.ecosystem_id = public.ecosystem_memberships.ecosystem_id
  )
);

CREATE INDEX ecosystem_memberships_eco_idx
  ON public.ecosystem_memberships (ecosystem_id, membership_state);
CREATE INDEX ecosystem_memberships_reseller_idx
  ON public.ecosystem_memberships (reseller_id);

-- 2. Backfill from the existing single-ecosystem model ------------------------
INSERT INTO public.ecosystem_memberships (
  user_id, ecosystem_id, role, status, membership_state, reseller_id,
  reseller_discount_percent, reseller_commission_percent, sale_commission_percent,
  handle, joined_at, created_at
)
SELECT
  p.id,
  p.ecosystem_id,
  COALESCE(
    (SELECT r.role FROM public.user_roles r
      WHERE r.user_id = p.id
        AND (r.ecosystem_id = p.ecosystem_id OR r.ecosystem_id IS NULL)
      ORDER BY (r.ecosystem_id IS NOT NULL) DESC
      LIMIT 1),
    'customer'
  ),
  p.status,
  CASE WHEN p.deleted_at IS NOT NULL THEN 'removed' ELSE 'active' END,
  p.reseller_id,
  COALESCE(p.reseller_discount_percent, 0),
  p.reseller_commission_percent,
  p.sale_commission_percent,
  p.handle,
  p.joined_at,
  p.created_at
FROM public.profiles p
WHERE p.ecosystem_id IS NOT NULL
ON CONFLICT (user_id, ecosystem_id) DO NOTHING;

-- Any role row that points at another ecosystem also becomes a membership.
INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
SELECT r.user_id, r.ecosystem_id, r.role, 'active', 'active'
FROM public.user_roles r
WHERE r.ecosystem_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id)
ON CONFLICT (user_id, ecosystem_id) DO NOTHING;

-- 3. Active ecosystem pointer (defaults to the member's current ecosystem) ----
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_ecosystem_id uuid REFERENCES public.ecosystems(id) ON DELETE SET NULL;
UPDATE public.profiles SET active_ecosystem_id = ecosystem_id WHERE ecosystem_id IS NOT NULL;

-- 4. Wallets become unique per (user, ecosystem) ------------------------------
ALTER TABLE public.credit_accounts DROP CONSTRAINT IF EXISTS credit_accounts_user_id_key;
ALTER TABLE public.points_accounts DROP CONSTRAINT IF EXISTS points_accounts_user_id_key;
ALTER TABLE public.social_credit_accounts DROP CONSTRAINT IF EXISTS social_credit_accounts_user_id_key;

CREATE UNIQUE INDEX credit_accounts_user_eco_key
  ON public.credit_accounts (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE UNIQUE INDEX points_accounts_user_eco_key
  ON public.points_accounts (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE UNIQUE INDEX social_credit_accounts_user_eco_key
  ON public.social_credit_accounts (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 5. Applications become per-ecosystem ----------------------------------------
ALTER TABLE public.membership_applications DROP CONSTRAINT IF EXISTS membership_applications_user_id_key;
CREATE UNIQUE INDEX membership_applications_open_unique
  ON public.membership_applications (user_id, ecosystem_id)
  WHERE status = 'pending';

-- 6. Context helpers ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.active_ecosystem(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(active_ecosystem_id, ecosystem_id) FROM public.profiles WHERE id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.membership_role(_user_id uuid, _ecosystem_id uuid)
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.ecosystem_memberships
  WHERE user_id = _user_id AND ecosystem_id = _ecosystem_id AND membership_state = 'active';
$$;

CREATE OR REPLACE FUNCTION public.has_membership(_user_id uuid, _ecosystem_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ecosystem_memberships
    WHERE user_id = _user_id AND ecosystem_id = _ecosystem_id AND membership_state = 'active'
  ) OR public.is_super_admin(_user_id);
$$;

-- 7. Keep the legacy profile/role columns as mirrors of the active membership --
CREATE OR REPLACE FUNCTION public.sync_membership_from_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.ecosystem_id IS NOT NULL THEN
    INSERT INTO public.ecosystem_memberships (
      user_id, ecosystem_id, role, status, membership_state, reseller_id,
      reseller_discount_percent, reseller_commission_percent, sale_commission_percent,
      handle, joined_at
    ) VALUES (
      new.id, new.ecosystem_id,
      COALESCE((SELECT r.role FROM public.user_roles r
                 WHERE r.user_id = new.id AND r.ecosystem_id = new.ecosystem_id LIMIT 1), 'customer'),
      new.status,
      CASE WHEN new.deleted_at IS NOT NULL THEN 'removed' ELSE 'active' END,
      new.reseller_id, COALESCE(new.reseller_discount_percent, 0),
      new.reseller_commission_percent, new.sale_commission_percent,
      new.handle, new.joined_at
    )
    ON CONFLICT (user_id, ecosystem_id) DO UPDATE SET
      status = excluded.status,
      membership_state = excluded.membership_state,
      reseller_id = excluded.reseller_id,
      reseller_discount_percent = excluded.reseller_discount_percent,
      reseller_commission_percent = excluded.reseller_commission_percent,
      sale_commission_percent = excluded.sale_commission_percent,
      handle = excluded.handle,
      updated_at = now();
  END IF;
  RETURN new;
END $$;

CREATE TRIGGER profiles_sync_membership
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_membership_from_profile();

CREATE OR REPLACE FUNCTION public.sync_membership_from_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.ecosystem_id IS NOT NULL THEN
    INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
    VALUES (new.user_id, new.ecosystem_id, new.role, 'active', 'active')
    ON CONFLICT (user_id, ecosystem_id) DO UPDATE SET role = excluded.role, updated_at = now();
  END IF;
  RETURN new;
END $$;

CREATE TRIGGER user_roles_sync_membership
AFTER INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_membership_from_role();

-- 8. Wallet initialisation, now keyed per ecosystem ---------------------------
CREATE OR REPLACE FUNCTION public.ensure_wallets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.ecosystem_id IS NOT NULL THEN
    INSERT INTO public.credit_accounts (user_id, ecosystem_id)
    VALUES (new.id, new.ecosystem_id)
    ON CONFLICT (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
    INSERT INTO public.points_accounts (user_id, ecosystem_id)
    VALUES (new.id, new.ecosystem_id)
    ON CONFLICT (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_credit_account(_user_id uuid, _ecosystem_id uuid DEFAULT NULL::uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _acct uuid; _eco uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  SELECT COALESCE(_ecosystem_id, public.active_ecosystem(_user_id)) INTO _eco;

  SELECT id INTO _acct FROM public.credit_accounts
  WHERE user_id = _user_id AND ecosystem_id IS NOT DISTINCT FROM _eco FOR UPDATE;
  IF _acct IS NOT NULL THEN RETURN _acct; END IF;

  INSERT INTO public.credit_accounts (user_id, ecosystem_id, balance)
  VALUES (_user_id, _eco, 0)
  ON CONFLICT (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

  SELECT id INTO _acct FROM public.credit_accounts
  WHERE user_id = _user_id AND ecosystem_id IS NOT DISTINCT FROM _eco FOR UPDATE;
  RETURN _acct;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_membership_wallets(_user_id uuid, _ecosystem_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.credit_accounts (user_id, ecosystem_id)
  VALUES (_user_id, _ecosystem_id)
  ON CONFLICT (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
  INSERT INTO public.points_accounts (user_id, ecosystem_id)
  VALUES (_user_id, _ecosystem_id)
  ON CONFLICT (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
END $$;

-- 9. Membership listing + secure switching ------------------------------------
CREATE OR REPLACE FUNCTION public.my_memberships()
RETURNS TABLE (
  ecosystem_id uuid,
  ecosystem_name text,
  ecosystem_slug text,
  role public.app_role,
  membership_state text,
  status public.account_status,
  is_active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.ecosystem_id, e.name, e.slug, m.role, m.membership_state, m.status,
         m.ecosystem_id = public.active_ecosystem(public.effective_uid())
  FROM public.ecosystem_memberships m
  JOIN public.ecosystems e ON e.id = m.ecosystem_id
  WHERE m.user_id = public.effective_uid()
    AND m.membership_state = 'active'
  ORDER BY e.name;
$$;

CREATE OR REPLACE FUNCTION public.switch_ecosystem(_ecosystem_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _m public.ecosystem_memberships%rowtype;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.acting_as() IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot switch shops while acting as another member';
  END IF;

  SELECT * INTO _m FROM public.ecosystem_memberships
  WHERE user_id = _uid AND ecosystem_id = _ecosystem_id AND membership_state = 'active';
  IF _m.id IS NULL THEN RAISE EXCEPTION 'You do not have an approved membership in that shop'; END IF;
  IF _m.status <> 'active' THEN RAISE EXCEPTION 'Your membership in that shop is suspended'; END IF;

  PERFORM public.ensure_membership_wallets(_uid, _ecosystem_id);

  -- Legacy columns mirror the active membership so existing scoped logic follows.
  UPDATE public.profiles SET
    active_ecosystem_id = _ecosystem_id,
    ecosystem_id = _ecosystem_id,
    status = _m.status,
    reseller_id = _m.reseller_id,
    reseller_discount_percent = COALESCE(_m.reseller_discount_percent, 0),
    reseller_commission_percent = _m.reseller_commission_percent,
    sale_commission_percent = _m.sale_commission_percent,
    handle = _m.handle
  WHERE id = _uid;

  DELETE FROM public.user_roles WHERE user_id = _uid AND role <> 'super_admin';
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_uid, _m.role, _ecosystem_id)
  ON CONFLICT (user_id, role) DO UPDATE SET ecosystem_id = excluded.ecosystem_id;

  PERFORM public.log_operator_action(
    _uid, _ecosystem_id, 'switch_ecosystem', 'ecosystem_membership', _m.id,
    jsonb_build_object('ecosystem_id', _ecosystem_id, 'role', _m.role)
  );

  RETURN _ecosystem_id;
END $$;

REVOKE ALL ON FUNCTION public.switch_ecosystem(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.switch_ecosystem(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_memberships() TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_ecosystem(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.membership_role(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_membership(uuid, uuid) TO authenticated;