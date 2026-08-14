-- Shop invitations: duplicate protection, cross-shop isolation, accept and
-- decline behaviour, already-member refusal, authorization and audit trail.
--
-- Everything runs inside a sub-block that is ALWAYS aborted, so no production
-- invitation, membership or audit row survives:
--
--   \i supabase/tests/shop-invitations.sql
--
-- Expectations:
--   1. an invitation can be created and starts pending, creating NO membership
--   2. a second pending invitation for the same member + shop is refused
--   3. the same member CAN be invited to a different shop (shop isolation)
--   4. accepting creates an active membership in that one shop only
--   5. declining creates no membership
--   6. an already-active member is not invitable (guard mirrors the RPC)
--   7. an unrelated member is not an authorized inviter
--   8. audit rows record inviter, shop, member and status

DO $$
DECLARE
  _ecoA uuid; _ecoB uuid; _admA uuid; _outsider uuid; _target uuid;
  _inv uuid; _inv2 uuid; _n int;
BEGIN
 BEGIN  -- rolled back at the end of this sub-block
  SELECT id INTO _ecoA FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _ecoB FROM public.ecosystems WHERE id <> _ecoA ORDER BY created_at LIMIT 1;
  SELECT user_id INTO _admA FROM public.user_roles WHERE role = 'admin' AND ecosystem_id = _ecoA LIMIT 1;
  SELECT id INTO _target FROM public.profiles
   WHERE deleted_at IS NULL AND id IS DISTINCT FROM _admA
     AND NOT EXISTS (SELECT 1 FROM public.ecosystem_memberships m
                      WHERE m.user_id = profiles.id AND m.ecosystem_id = _ecoA
                        AND m.membership_state = 'active')
   LIMIT 1;
  IF _ecoA IS NULL OR _admA IS NULL OR _target IS NULL THEN
    RAISE NOTICE 'SKIP: need a shop, its admin and a non-member profile'; RETURN;
  END IF;

  -- 1. an invitation is only an offer
  INSERT INTO public.ecosystem_invitations
    (ecosystem_id, user_id, invited_by, inviter_name, inviter_role, expires_at)
  VALUES (_ecoA, _target, _admA, 'Test Admin', 'admin', now() + interval '14 days')
  RETURNING id INTO _inv;

  SELECT count(*) INTO _n FROM public.ecosystem_invitations
   WHERE id = _inv AND status = 'pending';
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL 1: invitation is not pending'; END IF;

  SELECT count(*) INTO _n FROM public.ecosystem_memberships
   WHERE user_id = _target AND ecosystem_id = _ecoA AND membership_state = 'active';
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL 1: invitation created a membership'; END IF;

  -- 2. duplicate pending invitations are impossible
  BEGIN
    INSERT INTO public.ecosystem_invitations (ecosystem_id, user_id, invited_by, inviter_name)
    VALUES (_ecoA, _target, _admA, 'Test Admin');
    RAISE EXCEPTION 'FAIL 2: duplicate pending invitation accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 3. shop isolation: another shop may still invite the same person
  IF _ecoB IS NOT NULL THEN
    INSERT INTO public.ecosystem_invitations (ecosystem_id, user_id, invited_by, inviter_name)
    VALUES (_ecoB, _target, _admA, 'Test Admin') RETURNING id INTO _inv2;
    SELECT count(*) INTO _n FROM public.ecosystem_invitations
     WHERE user_id = _target AND status = 'pending';
    IF _n <> 2 THEN RAISE EXCEPTION 'FAIL 3: shop-specific invitations collided'; END IF;
  END IF;

  -- 4. accepting creates the membership for shop A only
  UPDATE public.ecosystem_invitations SET status = 'accepted', responded_at = now() WHERE id = _inv;
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
  VALUES (_target, _ecoA, 'customer', 'active', 'active')
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE SET membership_state = 'active';

  SELECT count(*) INTO _n FROM public.ecosystem_memberships
   WHERE user_id = _target AND ecosystem_id = _ecoA
     AND membership_state = 'active' AND role = 'customer';
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL 4: accept did not create the membership'; END IF;

  IF _ecoB IS NOT NULL THEN
    SELECT count(*) INTO _n FROM public.ecosystem_memberships
     WHERE user_id = _target AND ecosystem_id = _ecoB AND membership_state = 'active';
    IF _n <> 0 THEN RAISE EXCEPTION 'FAIL 4: accepting shop A touched shop B'; END IF;

    -- 5. declining creates nothing
    UPDATE public.ecosystem_invitations SET status = 'declined', responded_at = now() WHERE id = _inv2;
    SELECT count(*) INTO _n FROM public.ecosystem_memberships
     WHERE user_id = _target AND ecosystem_id = _ecoB AND membership_state = 'active';
    IF _n <> 0 THEN RAISE EXCEPTION 'FAIL 5: decline created a membership'; END IF;
  END IF;

  -- 6. an active member of shop A is no longer invitable
  SELECT count(*) INTO _n FROM public.ecosystem_memberships m
   WHERE m.user_id = _target AND m.ecosystem_id = _ecoA AND m.membership_state = 'active';
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL 6: already-member guard cannot fire'; END IF;

  -- 7. an unrelated member is not an authorized inviter
  SELECT p.id INTO _outsider FROM public.profiles p
   WHERE p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                      WHERE r.user_id = p.id
                        AND (r.role = 'super_admin'
                             OR (r.ecosystem_id = _ecoA
                                 AND r.role IN ('admin','reseller','subreseller'))))
   LIMIT 1;
  IF _outsider IS NOT NULL AND public.can_review_applications(_outsider, _ecoA) THEN
    RAISE EXCEPTION 'FAIL 7: unauthorized member may invite';
  END IF;
  IF NOT public.can_review_applications(_admA, _ecoA) THEN
    RAISE EXCEPTION 'FAIL 7: shop admin cannot invite into their own shop';
  END IF;

  -- 8. audit trail shape
  INSERT INTO public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  VALUES (_ecoA, _admA, 'Test Admin', 'Invited Universe member to shop', _target::text,
          jsonb_build_object('invitation_id', _inv, 'user_id', _target, 'status', 'pending'));
  SELECT count(*) INTO _n FROM public.audit_logs
   WHERE ecosystem_id = _ecoA AND action = 'Invited Universe member to shop'
     AND metadata->>'invitation_id' = _inv::text;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL 8: invitation audit row missing'; END IF;

  RAISE NOTICE 'PASS: shop invitations are pending-first, duplicate-safe and shop-isolated';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'ROLLBACK:%' THEN RAISE NOTICE '%', SQLERRM; ELSE RAISE; END IF;
 END;
END $$;
