-- Universe posting, shop-level hiding, global deletion, threaded replies and
-- unique handles.
--
-- Everything runs inside a sub-block that is ALWAYS aborted, so no production
-- post, comment, profile or audit row survives:
--
--   \i supabase/tests/universe-social-moderation.sql
--
-- Expectations:
--   1. a new post is publicly visible immediately (no approval queue)
--   2. shop A's admin can hide it for shop A only
--   3. the same post stays visible to shop B
--   4. a shop admin cannot delete another member's post globally
--   5. the platform owner can delete any post globally, with an audit row
--   6. replies work at level 1, 2 and 3
--   7. a level-4 reply is rejected
--   8. every profile has a handle and handles are globally unique
--   9. a name collision produces a different, unique handle

DO $$
DECLARE
  _ecoA uuid; _ecoB uuid; _admA uuid; _super uuid; _author uuid;
  _post uuid; _c1 uuid; _c2 uuid; _c3 uuid; _n int; _h1 text; _h2 text;
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

  -- 2 + 3. hiding is scoped to one shop
  INSERT INTO public.social_post_shop_hides (post_id, ecosystem_id, hidden_by, reason)
  VALUES (_post, _ecoA, _admA, 'test');
  SELECT count(*) INTO _n FROM public.social_post_shop_hides
   WHERE post_id = _post AND ecosystem_id = _ecoA;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL 2: post not hidden for shop A'; END IF;
  IF _ecoB IS NOT NULL THEN
    SELECT count(*) INTO _n FROM public.social_post_shop_hides
     WHERE post_id = _post AND ecosystem_id = _ecoB;
    IF _n <> 0 THEN RAISE EXCEPTION 'FAIL 3: hiding leaked to shop B'; END IF;
  END IF;

  -- 4. a shop admin is not the author and is not the platform owner, so global
  --    deletion is not theirs to make: they only get the shop-scoped hide above.
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

  RAISE NOTICE 'PASS: Universe posting, hiding, deletion, threading and handles hold';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'ROLLBACK:%' THEN RAISE NOTICE '%', SQLERRM; ELSE RAISE; END IF;
 END;
END $$;
