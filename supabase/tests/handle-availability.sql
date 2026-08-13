-- Social handle availability regression tests.
--
-- Everything runs inside a sub-block that is ALWAYS rolled back:
--   \i supabase/tests/handle-availability.sql
--
-- Expectations:
--   1. a genuinely unused handle is available
--   2. a handle used by another member of the SAME shop is taken
--   3. the caller's own current handle stays available (they can re-save it)
--   4. case, whitespace and a leading @ normalize to the same handle
--   5. the same handle in a DIFFERENT shop is still available
--   6. an empty handle is never reported as available (it is simply optional)
--   7. platform-level members (no shop) can still check handles

DO $$
DECLARE
  _eco uuid; _eco2 uuid; _a uuid; _b uuid; _c uuid; _plat uuid;
BEGIN
 BEGIN
  SELECT id INTO _eco FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _eco2 FROM public.ecosystems WHERE id <> _eco ORDER BY created_at LIMIT 1;
  IF _eco IS NULL THEN RAISE NOTICE 'SKIP: no ecosystem'; RETURN; END IF;

  SELECT id INTO _a FROM public.profiles WHERE ecosystem_id = _eco AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO _b FROM public.profiles WHERE ecosystem_id = _eco AND deleted_at IS NULL AND id <> _a LIMIT 1;
  IF _a IS NULL OR _b IS NULL THEN RAISE NOTICE 'SKIP: need two members'; RETURN; END IF;

  UPDATE public.profiles SET handle = 'takenone' WHERE id = _b;
  UPDATE public.profiles SET handle = 'mineown' WHERE id = _a;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _a::text, 'role', 'authenticated')::text, true);

  -- 1. unused handle
  IF NOT public.handle_available('brandnewhandle') THEN
    RAISE EXCEPTION 'FAIL 1: unused handle reported as taken';
  END IF;

  -- 2. taken inside the same shop
  IF public.handle_available('takenone') THEN
    RAISE EXCEPTION 'FAIL 2: duplicate handle reported as available';
  END IF;

  -- 3. the caller's own handle
  IF NOT public.handle_available('mineown') THEN
    RAISE EXCEPTION 'FAIL 3: own handle reported as taken';
  END IF;
  IF NOT public.handle_available('  @MineOwn ') THEN
    RAISE EXCEPTION 'FAIL 3b: own handle not normalized';
  END IF;

  -- 4. normalization of case / whitespace / @
  IF public.handle_available(' @TakenOne  ') THEN
    RAISE EXCEPTION 'FAIL 4: normalization missed a duplicate';
  END IF;

  -- 5. different shop, same handle
  IF _eco2 IS NOT NULL THEN
    SELECT id INTO _c FROM public.profiles WHERE ecosystem_id = _eco2 AND deleted_at IS NULL LIMIT 1;
    IF _c IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _c::text, 'role', 'authenticated')::text, true);
      IF NOT public.handle_available('takenone') THEN
        RAISE EXCEPTION 'FAIL 5: handle scope leaked across shops';
      END IF;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _a::text, 'role', 'authenticated')::text, true);
    END IF;
  END IF;

  -- 6. empty handle
  IF public.handle_available('   ') OR public.handle_available('@') THEN
    RAISE EXCEPTION 'FAIL 6: empty handle reported as available';
  END IF;

  -- 7. platform-level member (no ecosystem)
  SELECT id INTO _plat FROM public.profiles WHERE ecosystem_id IS NULL AND deleted_at IS NULL LIMIT 1;
  IF _plat IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _plat::text, 'role', 'authenticated')::text, true);
    IF NOT public.handle_available('platformhandle') THEN
      RAISE EXCEPTION 'FAIL 7: platform member cannot claim a free handle';
    END IF;
  END IF;

  RAISE NOTICE 'PASS: handle availability rules hold';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'ROLLBACK:%' THEN RAISE NOTICE '%', SQLERRM; ELSE RAISE; END IF;
 END;
END $$;
