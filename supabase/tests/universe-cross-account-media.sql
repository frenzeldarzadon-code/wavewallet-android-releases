-- Universe cross-account visibility: a general post by member A, and its photo,
-- are visible to member B who shares no shop with A; blocked viewers and
-- signed-out callers are not. Always rolled back.
--
--   \i supabase/tests/universe-cross-account-media.sql

DO $$
DECLARE
  _a uuid; _b uuid; _ecoA uuid; _ecoB uuid; _post uuid; _img text;
BEGIN
 BEGIN
  SELECT m.user_id, m.ecosystem_id INTO _a, _ecoA
    FROM public.ecosystem_memberships m WHERE m.membership_state = 'active' LIMIT 1;
  SELECT m.user_id, m.ecosystem_id INTO _b, _ecoB
    FROM public.ecosystem_memberships m
   WHERE m.membership_state = 'active' AND m.ecosystem_id <> _ecoA
     AND m.user_id NOT IN (SELECT user_id FROM public.ecosystem_memberships WHERE ecosystem_id = _ecoA)
   LIMIT 1;
  IF _a IS NULL OR _b IS NULL THEN RAISE NOTICE 'SKIP: need two members of disjoint shops'; RETURN; END IF;

  _img := _ecoA || '/' || _a || '/' || gen_random_uuid() || '.webp';
  INSERT INTO public.social_posts (ecosystem_id, author_id, body, audience, status, image_path)
  VALUES (_ecoA, _a, 'cross-account regression', 'general', 'active', _img) RETURNING id INTO _post;

  IF NOT public.social_post_visible_in(_post, public.current_ecosystem(_b)) THEN
    RAISE EXCEPTION 'FAIL 1: general post not visible to a member of another shop'; END IF;
  IF NOT public.social_media_visible(_img, _b) THEN
    RAISE EXCEPTION 'FAIL 2: post photo not readable by a member of another shop'; END IF;
  IF public.social_media_visible(_img, NULL) THEN
    RAISE EXCEPTION 'FAIL 3: signed-out caller can read post media'; END IF;

  UPDATE public.social_posts SET audience = 'ecosystem' WHERE id = _post;
  IF public.social_media_visible(_img, _b) THEN
    RAISE EXCEPTION 'FAIL 4: shop-only post photo leaked to a non-member'; END IF;
  UPDATE public.social_posts SET audience = 'general' WHERE id = _post;

  INSERT INTO public.social_blocks (ecosystem_id, blocker_id, blocked_id) VALUES (_ecoA, _a, _b);
  IF public.social_media_visible(_img, _b) THEN
    RAISE EXCEPTION 'FAIL 5: blocked viewer can read post media'; END IF;

  IF has_function_privilege('anon', 'public.social_media_visible(text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.profile_media_visible(text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 6: anon can call media visibility helpers'; END IF;

  RAISE NOTICE 'PASS: cross-account Universe post + media visibility';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'ROLLBACK: test complete' THEN RAISE; END IF;
 END;
END $$;
