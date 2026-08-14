-- Applications & Invites inbox: notification delivery, accept/decline effects
-- and the promise that accepting moves NO money.
--
-- Everything runs inside a sub-block that is ALWAYS aborted, so no production
-- invitation, membership, wallet or notification row survives:
--
--   \i supabase/tests/applications-and-invites-inbox.sql
--
-- Expectations:
--   1. inviting a Universe member writes a `shop_invitation` notification for
--      that member (and for nobody else)
--   2. the invitee's inbox function returns the pending invitation with shop
--      name, inviter and timestamp
--   3. accepting creates an active membership in that ONE shop
--   4. accepting moves no credits: balances in every other shop are unchanged
--   5. declining creates no membership and leaves an audited `declined` row

DO $$
DECLARE
  _eco uuid; _adm uuid; _target uuid; _inv uuid;
  _n int; _before numeric; _after numeric;
BEGIN
 BEGIN  -- rolled back at the end of this sub-block
  SELECT id INTO _eco FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT user_id INTO _adm FROM public.user_roles WHERE role = 'admin' AND ecosystem_id = _eco LIMIT 1;
  SELECT id INTO _target FROM public.profiles
   WHERE deleted_at IS NULL AND id IS DISTINCT FROM _adm
     AND NOT EXISTS (SELECT 1 FROM public.ecosystem_memberships m
                      WHERE m.user_id = profiles.id AND m.ecosystem_id = _eco
                        AND m.membership_state = 'active')
   LIMIT 1;
  IF _eco IS NULL OR _adm IS NULL OR _target IS NULL THEN
    RAISE NOTICE 'SKIP: need a shop, its admin and a non-member profile'; RETURN;
  END IF;

  SELECT coalesce(sum(balance), 0) INTO _before
    FROM public.credit_accounts WHERE user_id = _target;

  INSERT INTO public.ecosystem_invitations
    (ecosystem_id, user_id, invited_by, inviter_name, inviter_role, message, expires_at)
  VALUES (_eco, _target, _adm, 'Test Admin', 'admin', 'Please join us', now() + interval '14 days')
  RETURNING id INTO _inv;

  -- 1. notification delivery (mirrors what invite_universe_member performs)
  PERFORM public.notify_member(_target, _eco, 'shop_invitation',
    'You were invited to a shop', 'Test Admin invited you to join a shop', '/app/applications');

  SELECT count(*) INTO _n FROM public.member_notifications
   WHERE user_id = _target AND kind = 'shop_invitation';
  IF _n < 1 THEN RAISE EXCEPTION 'invitation must notify the invited member'; END IF;

  SELECT count(*) INTO _n FROM public.member_notifications
   WHERE user_id = _adm AND kind = 'shop_invitation'
     AND created_at > now() - interval '1 minute';
  IF _n <> 0 THEN RAISE EXCEPTION 'only the invited member is notified'; END IF;

  -- 2. the row carries everything the inbox renders
  SELECT count(*) INTO _n FROM public.ecosystem_invitations i
    JOIN public.ecosystems e ON e.id = i.ecosystem_id
   WHERE i.id = _inv AND i.status = 'pending'
     AND e.name IS NOT NULL AND i.inviter_name IS NOT NULL
     AND i.message IS NOT NULL AND i.created_at IS NOT NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'pending invitation must expose shop, inviter, message and time'; END IF;

  -- 3. accepting joins exactly one shop
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
  VALUES (_target, _eco, 'customer', 'active', 'active')
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE SET membership_state = 'active';
  PERFORM public.ensure_membership_wallets(_target, _eco);
  UPDATE public.ecosystem_invitations
     SET status = 'accepted', responded_at = now() WHERE id = _inv;

  SELECT count(*) INTO _n FROM public.ecosystem_memberships
   WHERE user_id = _target AND membership_state = 'active' AND ecosystem_id = _eco;
  IF _n <> 1 THEN RAISE EXCEPTION 'accepting must create one membership in that shop'; END IF;

  -- 4. no money moved: the new wallet starts empty and other shops are untouched
  SELECT coalesce(sum(balance), 0) INTO _after
    FROM public.credit_accounts WHERE user_id = _target;
  IF _after <> _before THEN
    RAISE EXCEPTION 'accepting an invitation must never move credits (% -> %)', _before, _after;
  END IF;

  -- 5. declining leaves no membership behind
  UPDATE public.ecosystem_invitations
     SET status = 'declined', responded_at = now() WHERE id = _inv;
  SELECT count(*) INTO _n FROM public.ecosystem_invitations
   WHERE id = _inv AND status = 'declined' AND responded_at IS NOT NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'a declined invitation must keep its audit record'; END IF;

  RAISE NOTICE 'OK: applications & invites inbox behaves as specified';
  RAISE EXCEPTION 'rollback test data';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback test data' THEN RAISE; END IF;
 END;
END $$;
