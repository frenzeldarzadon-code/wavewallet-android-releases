-- Customer profile identity (@handle + avatar) regression tests.
--
-- Everything runs inside a PL/pgSQL sub-block that is ALWAYS aborted, so no
-- production profile, wallet, ledger or audit row survives this script:
--
--   \i supabase/tests/profile-handles.sql
--
-- Expectations:
--   1. handles normalize: leading @, case and whitespace are stripped
--   2. two members of the same shop cannot share a handle (case-insensitive)
--   3. the same handle may exist in a different shop (tenant scoped)
--   4. a soft-deleted member frees their handle
--   5. handles stay optional — many members may have none
--   6. avatar_path is a plain text pointer, never image bytes

DO $$
DECLARE
  _eco uuid; _eco2 uuid; _a uuid; _b uuid; _c uuid; _n int;
BEGIN
 BEGIN  -- rolled back at the end of this sub-block
  SELECT id INTO _eco FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _eco2 FROM public.ecosystems WHERE id <> _eco ORDER BY created_at LIMIT 1;
  IF _eco IS NULL THEN RAISE NOTICE 'SKIP: no ecosystem available'; RETURN; END IF;

  SELECT id INTO _a FROM public.profiles WHERE ecosystem_id = _eco AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO _b FROM public.profiles WHERE ecosystem_id = _eco AND deleted_at IS NULL AND id <> _a LIMIT 1;
  IF _a IS NULL OR _b IS NULL THEN RAISE NOTICE 'SKIP: need two members'; RETURN; END IF;

  -- 1. normalization
  IF public.normalize_handle('  @Maria_DC ') <> 'maria_dc' THEN
    RAISE EXCEPTION 'FAIL 1: handle not normalized';
  END IF;
  IF public.normalize_handle('   ') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 1: blank handle should be null';
  END IF;

  UPDATE public.profiles SET handle = 'wavetester' WHERE id = _a;

  -- 2. duplicate inside the same shop, case-insensitive
  BEGIN
    UPDATE public.profiles SET handle = 'WaveTester' WHERE id = _b;
    RAISE EXCEPTION 'FAIL 2: duplicate handle accepted in the same shop';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 3. same handle in another shop is fine
  IF _eco2 IS NOT NULL THEN
    SELECT id INTO _c FROM public.profiles WHERE ecosystem_id = _eco2 AND deleted_at IS NULL LIMIT 1;
    IF _c IS NOT NULL THEN
      UPDATE public.profiles SET handle = 'wavetester' WHERE id = _c;
    END IF;
  END IF;

  -- 4. soft-deleted members free their handle
  UPDATE public.profiles SET deleted_at = now() WHERE id = _a;
  UPDATE public.profiles SET handle = 'wavetester' WHERE id = _b;
  UPDATE public.profiles SET deleted_at = NULL, handle = NULL WHERE id = _a;

  -- 5. handles are optional
  SELECT count(*) INTO _n FROM public.profiles WHERE ecosystem_id = _eco AND handle IS NULL;
  IF _n = 0 THEN RAISE EXCEPTION 'FAIL 5: handle should be optional'; END IF;

  -- 6. avatars are pointers only
  UPDATE public.profiles SET avatar_path = _eco::text || '/' || _b::text || '/x.webp' WHERE id = _b;
  PERFORM 1 FROM public.profiles WHERE id = _b AND avatar_path LIKE _eco::text || '/%';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 6: avatar path not stored'; END IF;

  RAISE NOTICE 'PASS: profile handle + avatar rules hold';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'ROLLBACK:%' THEN RAISE NOTICE '%', SQLERRM; ELSE RAISE; END IF;
 END;
END $$;
