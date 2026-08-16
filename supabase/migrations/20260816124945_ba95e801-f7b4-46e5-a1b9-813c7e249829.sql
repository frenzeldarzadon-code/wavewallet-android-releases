DROP FUNCTION IF EXISTS public.platform_user_deletion_check(uuid);

CREATE FUNCTION public.platform_user_deletion_check(_user uuid, _override boolean DEFAULT false)
RETURNS TABLE(
  eligible boolean,
  credit_total numeric,
  points_total integer,
  social_purchased integer,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _credit_details text;
  _credits numeric := 0;
  _points integer := 0;
  _social integer := 0;
  _reason text := '';
  _shop_block text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION USING MESSAGE = 'Only the platform owner can review account deletion';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user AND p.deleted_at IS NULL) THEN
    RETURN QUERY SELECT false, 0::numeric, 0::integer, 0::integer, 'Member not found or already removed.'::text;
    RETURN;
  END IF;

  SELECT
    COALESCE(sum(c.balance), 0),
    string_agg(
      COALESCE(e.name, 'Platform wallet') || ': ' || trim(to_char(c.balance, 'FM999999999999990.########')) || ' credits',
      '; ' ORDER BY COALESCE(e.name, 'Platform wallet')
    ) FILTER (WHERE c.balance <> 0)
  INTO _credits, _credit_details
  FROM public.credit_accounts c
  LEFT JOIN public.ecosystems e ON e.id = c.ecosystem_id
  WHERE c.user_id = _user;

  SELECT COALESCE(sum(p.balance + p.held), 0)::integer
  INTO _points
  FROM public.points_accounts p
  WHERE p.user_id = _user;

  SELECT COALESCE(sum(s.balance), 0)::integer
  INTO _social
  FROM public.social_credit_accounts s
  WHERE s.user_id = _user;

  IF _credit_details IS NOT NULL THEN
    _reason := concat_ws(' ', NULLIF(_reason, ''), 'Non-zero Shop credit wallet(s): ' || _credit_details || '.');
  END IF;

  IF _points <> 0 THEN
    _reason := concat_ws(' ', NULLIF(_reason, ''), 'The account has ' || _points::text || ' points or held points.');
  END IF;

  IF _social <> 0 THEN
    _reason := concat_ws(' ', NULLIF(_reason, ''), 'The account has ' || _social::text || ' purchased social credits.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.cash_in_requests r WHERE r.user_id = _user AND r.status = 'pending') THEN
    _reason := concat_ws(' ', NULLIF(_reason, ''), 'A cash-in request is still pending.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.withdrawal_requests r WHERE r.user_id = _user AND r.status IN ('pending', 'approved')) THEN
    _reason := concat_ws(' ', NULLIF(_reason, ''), 'A cash-out request or credit hold is still open.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.reward_redemptions r WHERE r.user_id = _user AND r.status = 'pending') THEN
    _reason := concat_ws(' ', NULLIF(_reason, ''), 'A reward redemption is still pending.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.retail_orders r WHERE r.customer_id = _user AND r.status = 'pending') THEN
    _reason := concat_ws(' ', NULLIF(_reason, ''), 'A retail order or credit hold is still pending.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.credit_purchase_orders o WHERE o.buyer_id = _user AND o.status IN ('pending', 'frozen')) THEN
    _reason := concat_ws(' ', NULLIF(_reason, ''), 'A credit purchase request is pending or frozen.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user
      AND ur.role IN ('super_admin', 'admin', 'reseller', 'subreseller')
  ) THEN
    IF NOT COALESCE(_override, false)
       OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user AND ur.role = 'super_admin')
    THEN
      _reason := concat_ws(' ', NULLIF(_reason, ''),
        CASE WHEN COALESCE(_override, false)
             THEN 'A platform owner account cannot be removed here.'
             ELSE 'This account holds an operator role; restructure it first.' END);
    ELSE
      -- Override: an operator may go, but only when the shops they run have
      -- no money in flight.
      SELECT string_agg(DISTINCT e.name, '; ')
      INTO _shop_block
      FROM public.user_roles ur
      JOIN public.ecosystems e ON e.id = ur.ecosystem_id
      WHERE ur.user_id = _user
        AND ur.role = 'admin'
        AND (
          EXISTS (SELECT 1 FROM public.cash_in_requests r WHERE r.ecosystem_id = e.id AND r.status = 'pending')
          OR EXISTS (SELECT 1 FROM public.withdrawal_requests r WHERE r.ecosystem_id = e.id AND r.status IN ('pending', 'approved'))
          OR EXISTS (SELECT 1 FROM public.credit_purchase_orders o WHERE o.ecosystem_id = e.id AND o.status IN ('pending', 'frozen'))
          OR EXISTS (SELECT 1 FROM public.reward_redemptions r WHERE r.ecosystem_id = e.id AND r.status = 'pending')
          OR EXISTS (SELECT 1 FROM public.retail_orders r WHERE r.ecosystem_id = e.id AND r.status = 'pending')
        );

      IF _shop_block IS NOT NULL THEN
        _reason := concat_ws(' ', NULLIF(_reason, ''),
          'Money is still moving in the shop(s) they run: ' || _shop_block || '.');
      END IF;
    END IF;
  END IF;

  IF _user = auth.uid() THEN
    _reason := concat_ws(' ', NULLIF(_reason, ''), 'You cannot delete your own account.');
  END IF;

  eligible := _reason = '';
  credit_total := _credits;
  points_total := _points;
  social_purchased := _social;
  reason := CASE
    WHEN eligible AND COALESCE(_override, false)
      THEN 'Platform owner override: all balances are zero and no money is in flight, so every other rule is waived.'
    WHEN eligible
      THEN 'All Shop credit balances are zero and no protected financial activity is pending.'
    ELSE _reason END;
  RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION public.platform_user_deletion_check(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_user_deletion_check(uuid, boolean) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.superadmin_delete_platform_user(uuid, text);

CREATE FUNCTION public.superadmin_delete_platform_user(
  _user uuid,
  _reason text DEFAULT NULL::text,
  _override boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _check record;
  _actor text;
  _target text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION USING MESSAGE = 'Only the platform owner can delete a platform account';
  END IF;

  SELECT p.full_name || ' — ' || COALESCE(p.email, p.phone, '')
  INTO _target
  FROM public.profiles p
  WHERE p.id = _user AND p.deleted_at IS NULL;

  IF _target IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Member not found or already removed';
  END IF;

  SELECT * INTO STRICT _check FROM public.platform_user_deletion_check(_user, COALESCE(_override, false));
  IF NOT _check.eligible THEN
    RAISE EXCEPTION USING MESSAGE = 'This account cannot be deleted: ' || _check.reason;
  END IF;

  UPDATE public.profiles
  SET full_name = 'Deleted member',
      email = 'deleted+' || _user::text || '@deleted.invalid',
      phone = '',
      handle = NULL,
      avatar_path = NULL,
      bio = NULL,
      status = 'suspended',
      deleted_at = now(),
      deleted_by = auth.uid(),
      deleted_reason = NULLIF(btrim(COALESCE(_reason, '')), '')
  WHERE id = _user;

  DELETE FROM public.user_roles WHERE user_id = _user;
  DELETE FROM public.social_follows WHERE follower_id = _user OR followee_id = _user;
  DELETE FROM public.social_friendships WHERE requester_id = _user OR addressee_id = _user;
  DELETE FROM public.member_notifications WHERE user_id = _user;
  UPDATE public.ecosystem_memberships
  SET membership_state = 'removed', updated_at = now()
  WHERE user_id = _user;

  SELECT COALESCE(p.full_name, 'Platform owner') INTO _actor
  FROM public.profiles p
  WHERE p.id = auth.uid();

  INSERT INTO public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  VALUES (
    NULL,
    auth.uid(),
    COALESCE(_actor, 'Platform owner'),
    CASE WHEN COALESCE(_override, false)
      THEN 'Purged platform account (owner override, anonymised)'
      ELSE 'Deleted platform account (anonymised)' END,
    _target,
    jsonb_build_object(
      'user_id', _user,
      'reason', NULLIF(btrim(COALESCE(_reason, '')), ''),
      'override', COALESCE(_override, false),
      'history_preserved', true,
      'may_register_again', true,
      'eligible', true,
      'eligibility_reason', _check.reason,
      'credit_total', _check.credit_total,
      'points_total', _check.points_total,
      'social_purchased', _check.social_purchased,
      'checked_at', now()
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.superadmin_delete_platform_user(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_delete_platform_user(uuid, text, boolean) TO authenticated, service_role;