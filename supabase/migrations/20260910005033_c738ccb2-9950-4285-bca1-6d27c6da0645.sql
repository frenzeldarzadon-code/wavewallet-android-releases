-- The global @handle belongs to the profile, never to a shop membership.
-- Switching shops used to copy the membership's mirrored (and sometimes stale
-- or empty) handle back onto the profile, which could collide with another
-- member's handle (profiles_handle_unique) or silently regenerate a new one.

CREATE OR REPLACE FUNCTION public.switch_ecosystem(_ecosystem_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _m public.ecosystem_memberships%rowtype;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.acting_as() IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot switch shops while acting as another member';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ecosystems WHERE id = _ecosystem_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  -- Platform-level access: no membership, no role change, no wallet.
  IF public.is_super_admin(_uid) THEN
    UPDATE public.profiles SET active_ecosystem_id = _ecosystem_id, ecosystem_id = _ecosystem_id
     WHERE id = _uid;
    PERFORM public.log_operator_action(
      _uid, _ecosystem_id, 'switch_ecosystem', 'ecosystem', _ecosystem_id,
      jsonb_build_object('ecosystem_id', _ecosystem_id, 'platform_access', true)
    );
    RETURN _ecosystem_id;
  END IF;

  SELECT * INTO _m FROM public.ecosystem_memberships
  WHERE user_id = _uid AND ecosystem_id = _ecosystem_id AND membership_state = 'active';
  IF _m.id IS NULL THEN RAISE EXCEPTION 'You do not have an approved membership in that shop'; END IF;
  IF _m.status <> 'active' THEN RAISE EXCEPTION 'Your membership in that shop is suspended'; END IF;

  IF NOT public.ecosystem_has_admin(_ecosystem_id) AND _m.role <> 'admin' THEN
    RAISE EXCEPTION 'This shop has no admin assigned yet and is not open';
  END IF;

  PERFORM public.ensure_membership_wallets(_uid, _ecosystem_id);

  -- Shop-scoped state only. handle / full_name are global and stay untouched.
  UPDATE public.profiles SET
    active_ecosystem_id = _ecosystem_id,
    ecosystem_id = _ecosystem_id,
    status = _m.status,
    reseller_id = _m.reseller_id,
    reseller_discount_percent = COALESCE(_m.reseller_discount_percent, 0),
    reseller_commission_percent = _m.reseller_commission_percent,
    sale_commission_percent = _m.sale_commission_percent
  WHERE id = _uid;

  DELETE FROM public.user_roles WHERE user_id = _uid AND role <> 'super_admin';
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_uid, _m.role, _ecosystem_id)
  ON CONFLICT (user_id, ecosystem_id, role) DO UPDATE SET ecosystem_id = excluded.ecosystem_id;

  PERFORM public.log_operator_action(
    _uid, _ecosystem_id, 'switch_ecosystem', 'ecosystem_membership', _m.id,
    jsonb_build_object('ecosystem_id', _ecosystem_id, 'role', _m.role)
  );

  RETURN _ecosystem_id;
END $function$;

-- Repair drifted mirrors so every membership shows the real global handle.
UPDATE public.ecosystem_memberships m
   SET handle = p.handle, updated_at = now()
  FROM public.profiles p
 WHERE p.id = m.user_id
   AND m.handle IS DISTINCT FROM p.handle;