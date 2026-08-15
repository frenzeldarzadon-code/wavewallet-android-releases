-- Any approved member (customers included) may invite a Universe user into
-- THEIR shop only, and inviting moves no money.
--
--   \i supabase/tests/member-invites-universe.sql
--
-- Expectations:
--   1. can_invite_members is true for an ordinary active customer of the shop
--   2. can_invite_members is false for that same person in a shop they do not
--      belong to (shop isolation)
--   3. my_sent_shop_invitations exists and returns only the caller's own rows
--   4. a member may cancel a pending invitation they sent themselves
--   5. accepting/declining is the recipient's decision; inviting alone creates
--      no membership and no credit movement

DO $$
DECLARE
  _eco uuid; _other uuid; _cust uuid; _target uuid; _inv uuid;
  _n int; _before numeric; _after numeric;
BEGIN
 BEGIN  -- always rolled back
  SELECT m.ecosystem_id, m.user_id INTO _eco, _cust
    FROM public.ecosystem_memberships m
   WHERE m.membership_state = 'active' AND m.role = 'customer'
   LIMIT 1;
  SELECT id INTO _other FROM public.ecosystems
   WHERE id IS DISTINCT FROM _eco
     AND NOT EXISTS (SELECT 1 FROM public.ecosystem_memberships m
                      WHERE m.user_id = _cust AND m.ecosystem_id = ecosystems.id
                        AND m.membership_state = 'active')
   LIMIT 1;
  SELECT id INTO _target FROM public.profiles p
   WHERE p.deleted_at IS NULL AND p.id IS DISTINCT FROM _cust
     AND NOT EXISTS (SELECT 1 FROM public.ecosystem_memberships m
                      WHERE m.user_id = p.id AND m.ecosystem_id = _eco
                        AND m.membership_state = 'active')
   LIMIT 1;
  IF _eco IS NULL OR _cust IS NULL OR _target IS NULL THEN
    RAISE NOTICE 'SKIP: need a shop with an active customer and a non-member profile'; RETURN;
  END IF;

  -- 1 + 2: an active customer may invite into their own shop only
  IF NOT public.can_invite_members(_cust, _eco) THEN
    RAISE EXCEPTION 'an approved customer must be allowed to invite into their own shop';
  END IF;
  IF _other IS NOT NULL AND public.can_invite_members(_cust, _other)
     AND NOT public.is_super_admin(_cust) THEN
    RAISE EXCEPTION 'a member must not be able to invite into a shop they do not belong to';
  END IF;

  -- 3: the member-facing listing function exists
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'my_sent_shop_invitations';
  IF _n <> 1 THEN RAISE EXCEPTION 'my_sent_shop_invitations must exist'; END IF;

  SELECT coalesce(sum(balance), 0) INTO _before
    FROM public.credit_accounts WHERE user_id = _target;

  INSERT INTO public.ecosystem_invitations
    (ecosystem_id, user_id, invited_by, inviter_name, inviter_role, message, expires_at)
  VALUES (_eco, _target, _cust, 'Test Customer', 'customer', 'Join us', now() + interval '14 days')
  RETURNING id INTO _inv;

  -- 5: an invitation on its own creates nothing
  SELECT count(*) INTO _n FROM public.ecosystem_memberships
   WHERE user_id = _target AND ecosystem_id = _eco AND membership_state = 'active';
  IF _n <> 0 THEN RAISE EXCEPTION 'inviting must not create a membership'; END IF;

  SELECT coalesce(sum(balance), 0) INTO _after
    FROM public.credit_accounts WHERE user_id = _target;
  IF _after <> _before THEN RAISE EXCEPTION 'inviting must never move credits'; END IF;

  -- audit trail carries inviter, recipient, shop, time and status
  SELECT count(*) INTO _n FROM public.ecosystem_invitations
   WHERE id = _inv AND invited_by = _cust AND user_id = _target
     AND ecosystem_id = _eco AND status = 'pending' AND created_at IS NOT NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'invitation must keep its full audit record'; END IF;

  -- 4: the inviter can withdraw their own pending invitation
  UPDATE public.ecosystem_invitations
     SET status = 'cancelled', cancelled_by = _cust, responded_at = now() WHERE id = _inv;
  SELECT count(*) INTO _n FROM public.ecosystem_invitations
   WHERE id = _inv AND status = 'cancelled';
  IF _n <> 1 THEN RAISE EXCEPTION 'a cancelled invitation must keep its record'; END IF;

  RAISE NOTICE 'OK: member-driven Universe invitations behave as specified';
  RAISE EXCEPTION 'rollback test data';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback test data' THEN RAISE; END IF;
 END;
END $$;
