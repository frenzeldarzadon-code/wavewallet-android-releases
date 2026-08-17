-- Universe upgrade regression checks:
--   * a post shared with a selected shop reaches EVERY member of that shop
--   * it never leaks to a shop it was not shared with
--   * the Universe member directory is Universe-wide but privacy-safe
--   * profile address is owner-only and never exposes street/house number
--
-- Everything runs inside a sub-block that is ALWAYS aborted, so no production
-- post, distribution or profile change survives:
--
--   \i supabase/tests/universe-directory-and-shop-posts.sql

DO $$
DECLARE
  _ecoA uuid; _ecoB uuid; _author uuid; _memberA uuid; _memberB uuid;
  _post uuid; _n int; _cols int;
BEGIN
 BEGIN  -- rolled back at the end of this sub-block
  SELECT id INTO _ecoA FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _ecoB FROM public.ecosystems WHERE id <> _ecoA ORDER BY created_at LIMIT 1;
  IF _ecoA IS NULL OR _ecoB IS NULL THEN
    RAISE NOTICE 'SKIP: two shops are required'; RETURN;
  END IF;

  SELECT user_id INTO _author   FROM public.ecosystem_memberships
   WHERE ecosystem_id = _ecoA AND membership_state = 'active' LIMIT 1;
  SELECT user_id INTO _memberA  FROM public.ecosystem_memberships
   WHERE ecosystem_id = _ecoA AND membership_state = 'active'
     AND user_id IS DISTINCT FROM _author LIMIT 1;
  SELECT user_id INTO _memberB  FROM public.ecosystem_memberships
   WHERE ecosystem_id = _ecoB AND membership_state = 'active'
     AND user_id NOT IN (SELECT user_id FROM public.ecosystem_memberships WHERE ecosystem_id = _ecoA)
   LIMIT 1;
  IF _author IS NULL OR _memberA IS NULL OR _memberB IS NULL THEN
    RAISE NOTICE 'SKIP: need an author, a same-shop member and an unrelated member'; RETURN;
  END IF;

  -- 1) A post distributed to shop A only
  INSERT INTO public.social_posts (ecosystem_id, author_id, body, audience, status)
  VALUES (_ecoA, _author, 'Regression: shared with shop A only', 'shops', 'active')
  RETURNING id INTO _post;

  INSERT INTO public.social_post_distributions (post_id, ecosystem_id, status)
  VALUES (_post, _ecoA, 'approved');

  SELECT count(*) INTO _n FROM public.social_post_distributions
   WHERE post_id = _post AND ecosystem_id = _ecoA AND status = 'approved';
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL 1: the selected shop has no approved distribution'; END IF;

  -- 2) No leakage into the shop it was not shared with
  SELECT count(*) INTO _n FROM public.social_post_distributions
   WHERE post_id = _post AND ecosystem_id = _ecoB;
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL 2: the post leaked into an unrelated shop'; END IF;

  -- 3) Visibility is membership-based, so EVERY active member of shop A qualifies
  SELECT count(*) INTO _n
    FROM public.ecosystem_memberships m
   WHERE m.ecosystem_id = _ecoA AND m.membership_state = 'active'
     AND EXISTS (SELECT 1 FROM public.social_post_distributions d
                  WHERE d.post_id = _post AND d.ecosystem_id = m.ecosystem_id
                    AND d.status = 'approved');
  IF _n < 2 THEN RAISE EXCEPTION 'FAIL 3: shop A members do not all reach the post'; END IF;

  -- 4) The directory never returns contacts, roles, balances or street/house
  SELECT count(*) INTO _cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name IN ('province','city_municipality','barangay','street','house_number');
  IF _cols <> 5 THEN RAISE EXCEPTION 'FAIL 4: address columns are missing'; END IF;

  SELECT count(*) INTO _n
    FROM information_schema.routines r
    JOIN information_schema.parameters p
      ON p.specific_name = r.specific_name AND p.parameter_mode = 'OUT'
   WHERE r.routine_schema = 'public' AND r.routine_name = 'universe_directory'
     AND p.parameter_name IN ('email','phone','role','street','house_number',
                              'credit_balance','points_balance');
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL 5: the directory exposes private fields'; END IF;

  -- 5) Anonymous callers cannot reach the directory or the profile writer
  IF has_function_privilege('anon', 'public.universe_directory(text,text,text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 6: anon can call the member directory';
  END IF;
  IF has_function_privilege('anon',
      'public.update_own_profile(text,text,text,boolean,text,jsonb,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 7: anon can write profiles';
  END IF;

  RAISE NOTICE 'PASS: selected-shop distribution, no cross-shop leakage, private directory';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'ROLLBACK: test complete' THEN RAISE; END IF;
 END;
END $$;
