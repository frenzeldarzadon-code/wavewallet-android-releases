-- Automatic voucher deletion regression tests.
--
-- Tests coordinated cleanup of automatic batches (Omada-linked).
--
--   BEGIN; \i supabase/tests/voucher-automatic-deletion.sql ROLLBACK;
--

BEGIN;

DO $$
DECLARE
  _admin uuid := '6b045d74-c678-4f49-822a-ce81efb89cba';
  _eco uuid;
  _product uuid;
  _import_a uuid; _import_b uuid; _import_manual uuid;
  _batch_a uuid; _batch_b uuid;
  _token uuid;
  _n int; _status text; _error text; _ok boolean;
BEGIN
  SELECT ecosystem_id INTO _eco FROM public.profiles WHERE id = _admin;
  SELECT id INTO _product FROM public.voucher_products WHERE ecosystem_id = _eco AND NOT archived LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  -- 1. Create two auto batches for the same product
  INSERT INTO public.voucher_imports (ecosystem_id, product_id, actor_id, actor_name, source)
  VALUES (_eco, _product, _admin, 'Tester', 'omada-auto') RETURNING id INTO _import_a;
  
  INSERT INTO public.omada_voucher_batches (ecosystem_id, product_id, import_id, group_id, group_name, generation_origin, remote_link_status)
  VALUES (_eco, _product, _import_a, 'GRP-A', 'Group A', 'automatic', 'exact') RETURNING id INTO _batch_a;

  INSERT INTO public.voucher_replenishment_runs (ecosystem_id, product_id, status, trigger_source, requested_count, batch_id)
  VALUES (_eco, _product, 'completed', 'sweep', 500, _batch_a);

  INSERT INTO public.voucher_imports (ecosystem_id, product_id, actor_id, actor_name, source)
  VALUES (_eco, _product, _admin, 'Tester', 'omada-auto') RETURNING id INTO _import_b;

  INSERT INTO public.omada_voucher_batches (ecosystem_id, product_id, import_id, group_id, group_name, generation_origin, remote_link_status)
  VALUES (_eco, _product, _import_b, 'GRP-B', 'Group B', 'automatic', 'exact') RETURNING id INTO _batch_b;

  INSERT INTO public.voucher_replenishment_runs (ecosystem_id, product_id, status, trigger_source, requested_count, batch_id)
  VALUES (_eco, _product, 'completed', 'sweep', 500, _batch_b);

  -- Add codes to both
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, import_id, code, status)
  VALUES (_eco, _product, _import_a, 'AUTO-A1', 'unused'),
         (_eco, _product, _import_a, 'AUTO-A2', 'unused'),
         (_eco, _product, _import_b, 'AUTO-B1', 'unused');

  -- 2. Verify manual delete_voucher_batch is blocked for automatic batches
  BEGIN
    PERFORM public.delete_voucher_batch(_import_a);
    RAISE EXCEPTION 'FAIL: manual delete_voucher_batch allowed for automatic batch';
  EXCEPTION WHEN others THEN
    IF position('Automatic batches require coordinated Omada cleanup' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 3. Valid exact group deletion (Batch A)
  SELECT cleanup_token INTO _token FROM public.prepare_voucher_batch_cleanup(_import_a);
  IF _token IS NULL THEN RAISE EXCEPTION 'FAIL: prepare_voucher_batch_cleanup returned no token'; END IF;
  
  -- Verify state in omada_voucher_batches
  IF NOT EXISTS (SELECT 1 FROM public.omada_voucher_batches WHERE id = _batch_a AND remote_cleanup_status = 'running' AND remote_cleanup_claim_token = _token) THEN
    RAISE EXCEPTION 'FAIL: omada_voucher_batch A not in running state';
  END IF;

  -- Finish cleanup
  SELECT deleted_count, remote_cleanup_status INTO _n, _status FROM public.finish_voucher_batch_cleanup(_import_a, _token, 'deleted');
  IF _n <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 codes deleted, got %', _n; END IF;
  IF _status <> 'deleted' THEN RAISE EXCEPTION 'FAIL: expected status deleted, got %', _status; END IF;
  
  -- Verify codes gone for A but B remains
  IF EXISTS (SELECT 1 FROM public.voucher_codes WHERE import_id = _import_a) THEN RAISE EXCEPTION 'FAIL: Batch A codes remain'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voucher_codes WHERE import_id = _import_b) THEN RAISE EXCEPTION 'FAIL: Batch B codes accidentally deleted'; END IF;

  -- 4. Already-absent group deletion (Batch B)
  SELECT cleanup_token INTO _token FROM public.prepare_voucher_batch_cleanup(_import_b);
  SELECT deleted_count, remote_cleanup_status INTO _n, _status FROM public.finish_voucher_batch_cleanup(_import_b, _token, 'already_absent');
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 code deleted for Batch B, got %', _n; END IF;
  IF _status <> 'already_absent' THEN RAISE EXCEPTION 'FAIL: expected status already_absent, got %', _status; END IF;

  -- Verify audit log
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action = 'Deleted voucher batch' AND metadata->>'batch' = _import_b::text AND metadata->>'remote_cleanup_status' = 'already_absent'
  ) THEN RAISE EXCEPTION 'FAIL: audit log for Batch B missing or incorrect'; END IF;

  -- 5. Manual batch remains local-only and never receives an Omada cleanup claim.
  INSERT INTO public.voucher_imports (ecosystem_id, product_id, actor_id, actor_name, source)
  VALUES (_eco, _product, _admin, 'Tester', 'omada') RETURNING id INTO _import_manual;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, import_id, code, status)
  VALUES (_eco, _product, _import_manual, 'MANUAL-1', 'unused');
  SELECT cleanup_token, generation_origin, should_delete_remote
    INTO _token, _status, _ok
    FROM public.prepare_voucher_batch_cleanup(_import_manual);
  IF _status <> 'manual' OR _ok THEN RAISE EXCEPTION 'FAIL: manual batch requested remote cleanup'; END IF;
  SELECT deleted_count, remote_cleanup_status
    INTO _n, _status
    FROM public.finish_voucher_batch_cleanup(_import_manual, _token, 'not_requested');
  IF _n <> 1 OR _status <> 'not_requested' THEN RAISE EXCEPTION 'FAIL: manual local-only deletion failed'; END IF;

  RAISE NOTICE 'voucher automatic deletion: all checks passed';
END $$;

ROLLBACK;
-- Retry hardening test
BEGIN;

DO $$
DECLARE
  _admin uuid := '6b045d74-c678-4f49-822a-ce81efb89cba';
  _eco uuid;
  _product uuid;
  _import_c uuid;
  _batch_c uuid;
  _token uuid;
BEGIN
  SELECT ecosystem_id INTO _eco FROM public.profiles WHERE id = _admin;
  SELECT id INTO _product FROM public.voucher_products WHERE ecosystem_id = _eco AND NOT archived LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  INSERT INTO public.voucher_imports (ecosystem_id, product_id, actor_id, actor_name, source)
  VALUES (_eco, _product, _admin, 'Tester', 'omada-auto') RETURNING id INTO _import_c;
  
  INSERT INTO public.omada_voucher_batches (ecosystem_id, product_id, import_id, group_id, group_name, generation_origin, remote_link_status)
  VALUES (_eco, _product, _import_c, 'GRP-C', 'Group C', 'automatic', 'exact') RETURNING id INTO _batch_c;

  INSERT INTO public.voucher_replenishment_runs (ecosystem_id, product_id, status, trigger_source, requested_count, batch_id)
  VALUES (_eco, _product, 'completed', 'sweep', 500, _batch_c);

  INSERT INTO public.voucher_codes (ecosystem_id, product_id, import_id, code, status)
  VALUES (_eco, _product, _import_c, 'AUTO-C1', 'unused');

  -- First prepare
  SELECT cleanup_token INTO _token FROM public.prepare_voucher_batch_cleanup(_import_c);
  IF _token IS NULL THEN RAISE EXCEPTION 'FAIL: first prepare failed'; END IF;

  -- Second prepare immediately should return NULL token (already running)
  SELECT cleanup_token INTO _token FROM public.prepare_voucher_batch_cleanup(_import_c);
  IF _token IS NOT NULL THEN RAISE EXCEPTION 'FAIL: second prepare should have returned NULL token but got %', _token; END IF;

  -- Mock aging the claim
  UPDATE public.omada_voucher_batches SET remote_cleanup_claimed_at = now() - interval '31 minutes' WHERE id = _batch_c;
  
  -- Third prepare should now succeed
  SELECT cleanup_token INTO _token FROM public.prepare_voucher_batch_cleanup(_import_c);
  IF _token IS NULL THEN RAISE EXCEPTION 'FAIL: prepare after timeout failed'; END IF;

  RAISE NOTICE 'voucher automatic deletion retry hardening: passed';
END $$;

ROLLBACK;
