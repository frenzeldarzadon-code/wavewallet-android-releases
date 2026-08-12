-- Voucher inventory deletion regression tests.
--
-- Uses isolated fixture codes only (prefix QA-DEL-) inside a transaction that
-- is always rolled back. No production voucher, sale or ledger row is touched.
--
--   BEGIN; \i supabase/tests/voucher-inventory-deletion.sql ROLLBACK;
--
-- Expectations:
--   1. individual unused code delete succeeds
--   2. individual sold/assigned code delete is blocked
--   3. whole fully-unused batch delete succeeds and is atomic
--   4. mixed batch delete is blocked and deletes nothing
--   5. every deletion writes an audit_logs row
--   6. cross-ecosystem deletion is refused
--   7. duplicate-code protection still holds after deletions

BEGIN;

DO $$
DECLARE
  _admin uuid := '6b045d74-c678-4f49-822a-ce81efb89cba';  -- replace: ecosystem admin
  _eco uuid;
  _product uuid;
  _other_admin uuid;
  _other_eco uuid;
  _batch_a uuid; _batch_b uuid;
  _code uuid; _sold uuid;
  _n int; _before int; _after int; _ok boolean;
BEGIN
  SELECT ecosystem_id INTO _eco FROM public.profiles WHERE id = _admin;
  SELECT id INTO _product FROM public.voucher_products WHERE ecosystem_id = _eco AND NOT archived LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  -- Fixture batch A: fully unused
  SELECT batch_id INTO _batch_a
  FROM public.import_voucher_codes(_product, ARRAY['QA-DEL-A1','QA-DEL-A2','QA-DEL-A3'], 'paste');

  -- 1. individual unused delete succeeds
  SELECT id INTO _code FROM public.voucher_codes WHERE import_id = _batch_a AND code = 'QA-DEL-A1';
  PERFORM public.delete_voucher_code(_code);
  IF EXISTS (SELECT 1 FROM public.voucher_codes WHERE id = _code) THEN
    RAISE EXCEPTION 'FAIL 1: unused code was not deleted';
  END IF;

  -- 5. audit logged for the single deletion
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE ecosystem_id = _eco AND action = 'Deleted voucher code'
      AND metadata->>'scope' = 'single' AND metadata->>'batch' = _batch_a::text
  ) THEN RAISE EXCEPTION 'FAIL 5: single deletion not audited'; END IF;

  -- Fixture batch B: one code marked as sold (simulated commitment, fixture only)
  SELECT batch_id INTO _batch_b
  FROM public.import_voucher_codes(_product, ARRAY['QA-DEL-B1','QA-DEL-B2'], 'paste');
  SELECT id INTO _sold FROM public.voucher_codes WHERE import_id = _batch_b AND code = 'QA-DEL-B1';
  UPDATE public.voucher_codes SET status = 'sold', sold_to = _admin, sold_at = now() WHERE id = _sold;

  -- 2. individual sold delete blocked
  BEGIN
    PERFORM public.delete_voucher_code(_sold);
    RAISE EXCEPTION 'FAIL 2: sold code deletion was allowed';
  EXCEPTION WHEN others THEN
    IF position('already been sold' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 4. mixed batch delete blocked, nothing removed
  SELECT count(*) INTO _before FROM public.voucher_codes WHERE import_id = _batch_b;
  BEGIN
    PERFORM public.delete_voucher_batch(_batch_b);
    RAISE EXCEPTION 'FAIL 4: mixed batch deletion was allowed';
  EXCEPTION WHEN others THEN
    IF position('cannot be deleted' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  SELECT count(*) INTO _after FROM public.voucher_codes WHERE import_id = _batch_b;
  IF _before <> _after THEN RAISE EXCEPTION 'FAIL 4/atomicity: blocked batch still removed rows'; END IF;

  -- 3. whole unused batch delete succeeds (batch A remainder)
  SELECT count(*) INTO _before FROM public.voucher_codes WHERE import_id = _batch_a;
  SELECT public.delete_voucher_batch(_batch_a) INTO _n;
  IF _n <> _before THEN RAISE EXCEPTION 'FAIL 3: expected % deleted, got %', _before, _n; END IF;
  IF EXISTS (SELECT 1 FROM public.voucher_codes WHERE import_id = _batch_a) THEN
    RAISE EXCEPTION 'FAIL 3: batch codes remain';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action = 'Deleted voucher batch' AND metadata->>'batch' = _batch_a::text
      AND (metadata->>'codes')::int = _n
  ) THEN RAISE EXCEPTION 'FAIL 5: batch deletion not audited'; END IF;

  -- 6. cross-ecosystem authorization
  SELECT p.id, p.ecosystem_id INTO _other_admin, _other_eco
  FROM public.profiles p
  JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'admin'
  WHERE p.ecosystem_id IS DISTINCT FROM _eco
  LIMIT 1;
  IF _other_admin IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _other_admin)::text, true);
    BEGIN
      PERFORM public.delete_voucher_batch(_batch_b);
      RAISE EXCEPTION 'FAIL 6: foreign admin deleted another shop''s batch';
    EXCEPTION WHEN others THEN
      IF position('Not authorized' in SQLERRM) = 0 THEN RAISE; END IF;
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  END IF;

  -- 7. duplicate protection intact: re-importing a live code is still a duplicate
  SELECT duplicate_count INTO _n
  FROM public.import_voucher_codes(_product, ARRAY['QA-DEL-B1'], 'paste');
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL 7: duplicate protection broken (dupes=%)', _n; END IF;

  RAISE NOTICE 'voucher inventory deletion: all checks passed';
END $$;

ROLLBACK;
