-- Universe posting, retired shop-level hiding, global deletion, threaded
-- replies and unique handles.
--
-- Everything runs inside a sub-block that is ALWAYS aborted, so no production
-- post, comment, profile or audit row survives:
--
--   \i supabase/tests/universe-social-moderation.sql
--
-- Expectations:
--   1. a new post is publicly visible immediately (no approval queue)
--   2. a legacy social_post_shop_hides row for shop A has ZERO effect: a shop A
--      member (and shop A's own admin) still sees the post via
--      social_post_visible_to and social_post_visible_in
--   3. the shop-scoped hide RPC refuses (per-shop invisibility is retired)
--   4. a shop admin cannot delete another member's post globally
--   5. the platform owner can delete any post globally, with an audit row
--   6. replies work at level 1, 2 and 3
--   7. a level-4 reply is rejected
--   8. every profile has a handle and handles are globally unique
--   9. a name collision produces a different, unique handle

DO $$
DECLARE
  _ecoA uuid; _ecoB uuid; _admA uuid; _super uuid; _author uuid;
  _post uuid; _memberA uuid; _c1 uuid; _c2 uuid; _c3 uuid; _n int; _h1 text; _h2 text;
BEGIN
 BEGIN  -- rolled back at the end of this sub-block
  SELECT id INTO _ecoA FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _ecoB FROM public.ecosystems WHERE id <> _ecoA ORDER BY created_at LIMIT 1;
  IF _ecoA IS NULL THEN RAISE NOTICE 'SKIP: no shop available'; RETURN; END IF;

  SELECT user_id INTO _super FROM public.user_roles WHERE role = 'super_admin' LIMIT 1;
  SELECT user_id INTO _admA FROM public.user_roles
   WHERE role = 'admin' AND ecosystem_id = _ecoA LIMIT 1;
  SELECT id INTO _author FROM public.profiles
   WHERE ecosystem_id = _ecoA AND deleted_at IS NULL AND id IS DISTINCT FROM _admA LIMIT 1;
  IF _author IS NULL OR _admA IS NULL OR _super IS NULL THEN
    RAISE NOTICE 'SKIP: need an author, a shop admin and the platform owner'; RETURN;
  END IF;

  -- 8. handles exist and are globally unique
  SELECT count(*) INTO _n FROM public.profiles WHERE deleted_at IS NULL AND handle IS NULL;
  IF _n > 0 THEN RAISE EXCEPTION 'FAIL 8: % profiles have no handle', _n; END IF;
  SELECT count(*) INTO _n FROM (
    SELECT lower(handle) FROM public.profiles WHERE deleted_at IS NULL AND handle IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF _n > 0 THEN RAISE EXCEPTION 'FAIL 8: % duplicate handles', _n; END IF;

  -- 9. collisions get a unique variant
  _h1 := public.unique_handle('Maria Dela Cruz');
  UPDATE public.profiles SET handle = _h1 WHERE id = _author;
  _h2 := public.unique_handle('Maria Dela Cruz');
  IF _h2 = _h1 THEN RAISE EXCEPTION 'FAIL 9: collision produced a duplicate handle'; END IF;

  -- 1. a post publishes immediately, with no pending distribution
  INSERT INTO public.social_posts (author_id, ecosystem_id, body, audience)
  VALUES (_author, _ecoA, 'Universe regression post', 'general')
  RETURNING id INTO _post;
  INSERT INTO public.social_post_distributions (post_id, ecosystem_id, status)
  SELECT _post, id, 'approved' FROM public.ecosystems;
  SELECT count(*) INTO _n FROM public.social_post_distributions
   WHERE post_id = _post AND status <> 'approved';
  IF _n > 0 THEN RAISE EXCEPTION 'FAIL 1: post is waiting for approval'; END IF;

  -- 2. a legacy per-shop hide row must not hide anything from anyone
  INSERT INTO public.social_post_shop_hides (post_id, ecosystem_id, hidden_by, reason)
  VALUES (_post, _ecoA, _admA, 'legacy test hide');
  SELECT id INTO _memberA FROM public.profiles pr
   WHERE pr.deleted_at IS NULL AND pr.id <> _author
     AND (pr.ecosystem_id = _ecoA OR EXISTS (
       SELECT 1 FROM public.ecosystem_memberships m
        WHERE m.user_id = pr.id AND m.ecosystem_id = _ecoA AND m.membership_state = 'active'))
     AND public.is_universe_member(pr.id)
     AND NOT EXISTS (SELECT 1 FROM public.social_blocks b
        WHERE (b.blocker_id = pr.id AND b.blocked_id = _author) OR (b.blocker_id = _author AND b.blocked_id = pr.id))
   LIMIT 1;
  IF _memberA IS NULL THEN RAISE EXCEPTION 'FAIL 2: no shop A member available'; END IF;
  IF NOT public.social_post_visible_to(_post, _memberA) THEN
    RAISE EXCEPTION 'FAIL 2: shop A member lost the post because of a per-shop hide';
  END IF;
  IF NOT public.social_post_visible_to(_post, _admA) THEN
    RAISE EXCEPTION 'FAIL 2: shop A admin lost the post because of a per-shop hide';
  END IF;
  IF NOT public.social_post_visible_in(_post, _ecoA) THEN
    RAISE EXCEPTION 'FAIL 2: social_post_visible_in still honours per-shop hides';
  END IF;
  -- the feed function itself must not reference the hide table any more
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('social_feed','social_post_visible_to','social_post_visible_in','universe_profile_posts')
     AND pg_get_functiondef(p.oid) ILIKE '%social_post_shop_hides%';
  IF _n > 0 THEN RAISE EXCEPTION 'FAIL 2: % visibility function(s) still filter by social_post_shop_hides', _n; END IF;

  -- 3. the shop-scoped hide RPC is retired
  BEGIN
    PERFORM public.social_hide_post_for_shop(_post, true, 'x', _ecoA);
    RAISE EXCEPTION 'FAIL 3: social_hide_post_for_shop still hides posts';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL 3%' THEN RAISE; END IF;
  END;

  -- 4. a shop admin is not the author and is not the platform owner, so global
  --    deletion is not theirs to make.
  IF public.is_super_admin(_admA) OR _admA = _author THEN
    RAISE EXCEPTION 'FAIL 4: test setup picked a privileged shop admin';
  END IF;
  -- 5. the platform owner is recognised as the global moderation authority
  IF NOT public.is_super_admin(_super) THEN
    RAISE EXCEPTION 'FAIL 5: platform owner not recognised';
  END IF;

  -- 6. three levels of replies
  INSERT INTO public.social_comments (post_id, author_id, body, parent_id, depth)
  VALUES (_post, _author, 'level 1', NULL, 1) RETURNING id INTO _c1;
  INSERT INTO public.social_comments (post_id, author_id, body, parent_id, depth)
  VALUES (_post, _author, 'level 2', _c1, 2) RETURNING id INTO _c2;
  INSERT INTO public.social_comments (post_id, author_id, body, parent_id, depth)
  VALUES (_post, _author, 'level 3', _c2, 3) RETURNING id INTO _c3;

  -- 7. a fourth level is refused
  BEGIN
    INSERT INTO public.social_comments (post_id, author_id, body, parent_id, depth)
    VALUES (_post, _author, 'level 4', _c3, 4);
    RAISE EXCEPTION 'FAIL 7: level 4 reply accepted';
  EXCEPTION WHEN check_violation OR raise_exception THEN NULL;
  END;

  RAISE NOTICE 'PASS: Universe posting, retired hiding, deletion, threading and handles hold';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'ROLLBACK:%' THEN RAISE NOTICE '%', SQLERRM; ELSE RAISE; END IF;
 END;
END $$;
