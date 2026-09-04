-- Universe social access model: shop membership never gates posting, viewing,
-- replying, liking or messaging. Always rolled back.
--
--   \i supabase/tests/universe-social-access.sql
--
--   A. a member with NO shop can post; another member sees it
--   B. shop-A member posts; shop-B member (no shared shop) sees it
--   C. an NG-shop member posts and sees general posts from others
--   D. photos on general posts are readable across unrelated shops
--   E. no create path requires a shop or an operational shop
--   F. shop-only posts stay shop-only; blocks still hide
--   G. direct messages open across shops and for zero-shop members

DO $$
DECLARE
  _zero uuid; _a uuid; _b uuid; _ng uuid; _ecoA uuid; _ecoB uuid;
  _p1 uuid; _p2 uuid; _p3 uuid; _img text; _t uuid; _c uuid;
BEGIN
 BEGIN
  SELECT id INTO _zero FROM public.profiles
   WHERE ecosystem_id IS NULL AND deleted_at IS NULL AND status = 'active'
     AND NOT public.is_super_admin(id)
     AND NOT EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.user_id = profiles.id AND m.membership_state = 'active')
   LIMIT 1;
  SELECT m.user_id, m.ecosystem_id INTO _a, _ecoA FROM public.ecosystem_memberships m
    JOIN public.ecosystems e ON e.id = m.ecosystem_id
   WHERE m.membership_state = 'active' AND e.shop_kind <> 'subscription' LIMIT 1;
  SELECT m.user_id, m.ecosystem_id INTO _b, _ecoB FROM public.ecosystem_memberships m
   WHERE m.membership_state = 'active' AND m.ecosystem_id <> _ecoA
     AND m.user_id NOT IN (SELECT user_id FROM public.ecosystem_memberships WHERE ecosystem_id = _ecoA)
     AND m.user_id <> coalesce(_zero, '00000000-0000-0000-0000-000000000000') LIMIT 1;
  SELECT m.user_id INTO _ng FROM public.ecosystem_memberships m
    JOIN public.ecosystems e ON e.id = m.ecosystem_id
   WHERE m.membership_state = 'active' AND e.shop_kind = 'subscription' LIMIT 1;
  IF _a IS NULL OR _b IS NULL THEN RAISE NOTICE 'SKIP: need two members of disjoint shops'; RETURN; END IF;

  -- A. zero-shop author (falls back to member B if the DB has none)
  _zero := coalesce(_zero, _b);
  INSERT INTO public.social_posts (ecosystem_id, author_id, body, audience)
  VALUES (NULL, _zero, 'zero-shop post', 'general') RETURNING id INTO _p1;
  IF NOT public.social_post_visible_to(_p1, _a) THEN RAISE EXCEPTION 'FAIL A: zero-shop post invisible'; END IF;

  -- B + D. cross-shop general post with a photo
  _img := 'universe/' || _a || '/' || gen_random_uuid() || '.webp';
  INSERT INTO public.social_posts (ecosystem_id, author_id, body, audience, image_path)
  VALUES (_ecoA, _a, 'cross-shop post', 'general', _img) RETURNING id INTO _p2;
  IF NOT public.social_post_visible_to(_p2, _b) THEN RAISE EXCEPTION 'FAIL B: shop-B member cannot see shop-A post'; END IF;
  IF NOT public.social_media_visible(_img, _b) THEN RAISE EXCEPTION 'FAIL D: photo not readable across shops'; END IF;
  IF public.social_media_visible(_img, NULL) THEN RAISE EXCEPTION 'FAIL D: signed-out caller reads photo'; END IF;

  -- C. NG member participates like anyone else
  IF _ng IS NOT NULL THEN
    INSERT INTO public.social_posts (ecosystem_id, author_id, body, audience)
    VALUES (public.current_ecosystem(_ng), _ng, 'ng member post', 'general') RETURNING id INTO _p3;
    IF NOT public.social_post_visible_to(_p3, _b) THEN RAISE EXCEPTION 'FAIL C: NG post invisible to others'; END IF;
    IF NOT public.social_post_visible_to(_p2, _ng) THEN RAISE EXCEPTION 'FAIL C: NG member cannot see general post'; END IF;
  END IF;

  -- E. replies and likes carry the post's (possibly null) shop, never a requirement
  INSERT INTO public.social_comments (post_id, ecosystem_id, author_id, body, depth)
  VALUES (_p1, NULL, _b, 'reply from another shop', 1) RETURNING id INTO _c;
  INSERT INTO public.social_likes (post_id, user_id, ecosystem_id) VALUES (_p1, _a, NULL);
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'social_create_post') LIKE '%require_operational%'
     OR (SELECT prosrc FROM pg_proc WHERE proname = 'social_create_comment') LIKE '%require_operational%'
     OR (SELECT prosrc FROM pg_proc WHERE proname = 'social_create_post') LIKE '%Your account is not part of a shop%' THEN
    RAISE EXCEPTION 'FAIL E: posting still gated by shop membership / shop state';
  END IF;
  IF (SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'social_create_post') NOT LIKE '%_audience text DEFAULT ''general''%' THEN
    RAISE EXCEPTION 'FAIL E: default audience is not general';
  END IF;

  -- F. shop-only stays shop-only; blocks still hide
  UPDATE public.social_posts SET audience = 'ecosystem' WHERE id = _p2;
  IF public.social_post_visible_to(_p2, _b) THEN RAISE EXCEPTION 'FAIL F: shop-only post leaked'; END IF;
  IF public.social_media_visible(_img, _b) THEN RAISE EXCEPTION 'FAIL F: shop-only photo leaked'; END IF;
  UPDATE public.social_posts SET audience = 'general' WHERE id = _p2;
  INSERT INTO public.social_blocks (ecosystem_id, blocker_id, blocked_id) VALUES (NULL, _a, _b);
  IF public.social_post_visible_to(_p2, _b) THEN RAISE EXCEPTION 'FAIL F: blocked viewer sees post'; END IF;
  DELETE FROM public.social_blocks WHERE blocker_id = _a AND blocked_id = _b;

  -- G. one global direct thread per pair, shop-independent
  INSERT INTO public.dm_threads (ecosystem_id, user_a, user_b, kind)
  VALUES (NULL, least(_a, _b), greatest(_a, _b), 'direct') RETURNING id INTO _t;
  BEGIN
    INSERT INTO public.dm_threads (ecosystem_id, user_a, user_b, kind)
    VALUES (_ecoA, least(_a, _b), greatest(_a, _b), 'direct');
    RAISE EXCEPTION 'FAIL G: duplicate direct thread accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'dm_open_thread') LIKE '%ecosystem_id = _eco%' THEN
    RAISE EXCEPTION 'FAIL G: dm_open_thread still requires the same shop';
  END IF;

  RAISE NOTICE 'PASS: Universe social access is shop-independent';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'ROLLBACK: test complete' THEN RAISE; END IF;
 END;
END $$;
