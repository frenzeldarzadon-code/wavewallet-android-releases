CREATE OR REPLACE FUNCTION public.leave_shop_preview(_ecosystem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _m public.ecosystem_memberships%rowtype;
  _deps integer := 0;
  _others integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT * INTO _m FROM public.ecosystem_memberships
   WHERE user_id = _uid AND ecosystem_id = _ecosystem_id AND membership_state = 'active';
  IF _m.id IS NULL THEN RAISE EXCEPTION 'You are not a member of that shop'; END IF;

  IF _m.role = 'reseller' THEN
    SELECT count(*) INTO _deps
      FROM public.ecosystem_memberships c
     WHERE c.ecosystem_id = _ecosystem_id
       AND c.membership_state = 'active'
       AND c.role = 'subreseller'
       AND c.reseller_id = _uid;
  END IF;

  SELECT count(*) INTO _others
    FROM public.ecosystem_memberships o
   WHERE o.user_id = _uid AND o.membership_state = 'active' AND o.ecosystem_id <> _ecosystem_id;

  RETURN jsonb_build_object(
    'ecosystem_id', _ecosystem_id,
    'ecosystem_name', (SELECT name FROM public.ecosystems WHERE id = _ecosystem_id),
    'role', _m.role,
    'needs_step_down', _m.role IN ('reseller','subreseller'),
    'dependent_subresellers', _deps,
    'other_shops', _others,
    'blocked_reason', CASE
      WHEN _m.role IN ('admin','super_admin')
        THEN 'Shop managers cannot leave their own shop. The platform owner must reassign the shop first.'
      ELSE NULL END
  );
END $function$;

CREATE OR REPLACE FUNCTION public.leave_shop(_ecosystem_id uuid, _step_down boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _m public.ecosystem_memberships%rowtype;
  _next uuid;
  _deps integer := 0;
  _name text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.acting_as() IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot leave a shop while acting as another member';
  END IF;

  SELECT * INTO _m FROM public.ecosystem_memberships
   WHERE user_id = _uid AND ecosystem_id = _ecosystem_id AND membership_state = 'active'
   FOR UPDATE;
  IF _m.id IS NULL THEN RAISE EXCEPTION 'You are not a member of that shop'; END IF;

  IF _m.role IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Shop managers cannot leave their own shop';
  END IF;

  IF _m.role IN ('reseller','subreseller') AND NOT _step_down THEN
    RAISE EXCEPTION 'Step down from your selling position before leaving this shop';
  END IF;

  -- Every subreseller that still depends on this reseller becomes an ordinary
  -- customer of the same shop. Accounts, wallets and history are untouched.
  IF _m.role = 'reseller' THEN
    SELECT count(*) INTO _deps
      FROM public.ecosystem_memberships c
     WHERE c.ecosystem_id = _ecosystem_id AND c.membership_state = 'active'
       AND c.role = 'subreseller' AND c.reseller_id = _uid;

    UPDATE public.ecosystem_memberships c
       SET role = 'customer', reseller_id = NULL,
           reseller_discount_percent = 0, reseller_commission_percent = 0,
           sale_commission_percent = NULL, updated_at = now()
     WHERE c.ecosystem_id = _ecosystem_id AND c.membership_state = 'active'
       AND c.role = 'subreseller' AND c.reseller_id = _uid;

    UPDATE public.profiles p
       SET reseller_id = NULL, reseller_discount_percent = 0,
           reseller_commission_percent = 0, sale_commission_percent = NULL
     WHERE p.active_ecosystem_id = _ecosystem_id
       AND p.reseller_id = _uid
       AND EXISTS (SELECT 1 FROM public.ecosystem_memberships c
                    WHERE c.user_id = p.id AND c.ecosystem_id = _ecosystem_id
                      AND c.role = 'customer');

    DELETE FROM public.user_roles r
     WHERE r.ecosystem_id = _ecosystem_id
       AND r.role = 'subreseller'
       AND EXISTS (SELECT 1 FROM public.ecosystem_memberships c
                    WHERE c.user_id = r.user_id AND c.ecosystem_id = _ecosystem_id
                      AND c.role = 'customer');
    INSERT INTO public.user_roles (user_id, role, ecosystem_id)
    SELECT c.user_id, 'customer', _ecosystem_id
      FROM public.ecosystem_memberships c
     WHERE c.ecosystem_id = _ecosystem_id AND c.role = 'customer'
       AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = c.user_id AND p.active_ecosystem_id = _ecosystem_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Nothing financial is deleted: only the membership is closed.
  UPDATE public.ecosystem_memberships
     SET membership_state = 'removed', role = 'customer', reseller_id = NULL,
         reseller_discount_percent = 0, reseller_commission_percent = 0,
         sale_commission_percent = NULL, updated_at = now()
   WHERE id = _m.id;

  SELECT o.ecosystem_id INTO _next
    FROM public.ecosystem_memberships o
    JOIN public.ecosystems e ON e.id = o.ecosystem_id AND e.archived_at IS NULL
   WHERE o.user_id = _uid AND o.membership_state = 'active' AND o.status = 'active'
     AND o.ecosystem_id <> _ecosystem_id
   ORDER BY e.name
   LIMIT 1;

  IF _next IS NOT NULL THEN
    PERFORM public.switch_ecosystem(_next);
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _uid AND role <> 'super_admin';
    INSERT INTO public.user_roles (user_id, role, ecosystem_id)
    VALUES (_uid, 'customer', NULL) ON CONFLICT DO NOTHING;
    UPDATE public.profiles
       SET active_ecosystem_id = NULL, ecosystem_id = NULL,
           reseller_id = NULL, reseller_discount_percent = 0,
           reseller_commission_percent = 0, sale_commission_percent = NULL
     WHERE id = _uid;
  END IF;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;
  INSERT INTO public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  VALUES (_ecosystem_id, _uid, COALESCE(_name, 'Member'),
          CASE WHEN _m.role = 'customer' THEN 'Left shop' ELSE 'Stepped down and left shop' END,
          COALESCE(_name, ''),
          jsonb_build_object('previous_role', _m.role,
                             'dependent_subresellers_reset', _deps,
                             'next_ecosystem_id', _next));

  RETURN jsonb_build_object('left_ecosystem_id', _ecosystem_id,
                            'previous_role', _m.role,
                            'subresellers_reset', _deps,
                            'next_ecosystem_id', _next);
END $function$;

REVOKE ALL ON FUNCTION public.leave_shop_preview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_shop(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_shop_preview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_shop(uuid, boolean) TO authenticated;