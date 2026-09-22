ALTER TABLE public.omada_voucher_batches
  ADD COLUMN IF NOT EXISTS generation_origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS remote_link_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS remote_cleanup_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS remote_cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remote_cleanup_error text,
  ADD COLUMN IF NOT EXISTS remote_cleanup_claim_token uuid,
  ADD COLUMN IF NOT EXISTS remote_cleanup_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS remote_cleanup_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS remote_cleanup_updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.omada_voucher_batches
  ADD CONSTRAINT omada_voucher_batches_generation_origin_check CHECK (generation_origin IN ('manual','automatic')),
  ADD CONSTRAINT omada_voucher_batches_remote_link_status_check CHECK (remote_link_status IN ('not_applicable','exact','unresolved')),
  ADD CONSTRAINT omada_voucher_batches_remote_cleanup_status_check CHECK (remote_cleanup_status IN ('not_requested','running','deleted','already_absent','failed','unresolved')),
  ADD CONSTRAINT omada_voucher_batches_remote_cleanup_attempts_check CHECK (remote_cleanup_attempts >= 0);

UPDATE public.omada_voucher_batches b SET generation_origin = 'automatic', remote_link_status = CASE WHEN b.group_id IS NOT NULL AND b.group_id <> '' THEN 'exact' ELSE 'unresolved' END, remote_cleanup_status = 'not_requested', remote_cleanup_updated_at = now()
WHERE EXISTS (SELECT 1 FROM public.voucher_replenishment_runs r JOIN public.voucher_imports i ON i.id = b.import_id WHERE r.batch_id = b.id AND r.trigger_source = 'sweep' AND i.source = 'omada-auto' AND i.ecosystem_id = b.ecosystem_id AND i.product_id = b.product_id);

CREATE INDEX IF NOT EXISTS omada_voucher_batches_import_origin_idx ON public.omada_voucher_batches (import_id, generation_origin);

CREATE OR REPLACE FUNCTION public.list_voucher_batches_with_cleanup(_ecosystem_id uuid)
RETURNS TABLE(batch_id uuid, product_id uuid, product_name text, actor_name text, source text, created_at timestamptz, total_codes integer, unused_count integer, sold_count integer, deletable boolean, generation_origin text, remote_link_status text, remote_cleanup_status text, remote_cleanup_error text, omada_group_id text, omada_group_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) OR public.is_super_admin(auth.uid())) THEN RAISE EXCEPTION 'Not authorized to read this ecosystem'; END IF;
  RETURN QUERY SELECT i.id, i.product_id, coalesce(p.name, '')::text, i.actor_name, i.source, i.created_at,
    count(c.id)::int,
    count(c.id) FILTER (WHERE c.status = 'unused' AND c.sold_to IS NULL AND c.sale_id IS NULL)::int,
    count(c.id) FILTER (WHERE c.status <> 'unused' OR c.sold_to IS NOT NULL OR c.sale_id IS NOT NULL)::int,
    (count(c.id) > 0 AND count(c.id) FILTER (WHERE c.status <> 'unused' OR c.sold_to IS NOT NULL OR c.sale_id IS NOT NULL) = 0),
    coalesce(ob.generation_origin, 'manual')::text, coalesce(ob.remote_link_status, 'not_applicable')::text,
    coalesce(ob.remote_cleanup_status, 'not_requested')::text, ob.remote_cleanup_error,
    CASE WHEN ob.generation_origin = 'automatic' AND ob.remote_link_status = 'exact' THEN ob.group_id ELSE NULL END,
    CASE WHEN ob.generation_origin = 'automatic' THEN ob.group_name ELSE NULL END
  FROM public.voucher_imports i LEFT JOIN public.voucher_products p ON p.id = i.product_id LEFT JOIN public.voucher_codes c ON c.import_id = i.id
  LEFT JOIN LATERAL (SELECT b.generation_origin, b.remote_link_status, b.remote_cleanup_status, b.remote_cleanup_error, b.group_id, b.group_name FROM public.omada_voucher_batches b WHERE b.import_id = i.id ORDER BY b.created_at DESC LIMIT 1) ob ON true
  WHERE i.ecosystem_id = _ecosystem_id
  GROUP BY i.id, i.product_id, p.name, i.actor_name, i.source, i.created_at, ob.generation_origin, ob.remote_link_status, ob.remote_cleanup_status, ob.remote_cleanup_error, ob.group_id, ob.group_name
  ORDER BY i.created_at DESC LIMIT 25;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_voucher_batch_cleanup(_import_id uuid)
RETURNS TABLE(cleanup_token uuid, ecosystem_id uuid, generation_origin text, remote_link_status text, remote_cleanup_status text, omada_batch_id uuid, group_id text, group_name text, should_delete_remote boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _eco uuid; _total integer; _committed integer; _batch public.omada_voucher_batches; _token uuid;
BEGIN
  SELECT i.ecosystem_id INTO _eco FROM public.voucher_imports i WHERE i.id = _import_id;
  IF _eco IS NULL THEN RAISE EXCEPTION 'Upload batch not found'; END IF;
  IF NOT (public.is_ecosystem_admin(auth.uid(), _eco) OR public.is_super_admin(auth.uid())) THEN RAISE EXCEPTION 'Not authorized to manage this ecosystem'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('voucher-cleanup:' || _import_id::text, 0));
  SELECT count(*)::int, count(*) FILTER (WHERE status <> 'unused' OR sold_to IS NOT NULL OR sale_id IS NOT NULL)::int INTO _total, _committed FROM public.voucher_codes WHERE import_id = _import_id;
  IF _total = 0 THEN RAISE EXCEPTION 'This batch has no codes left to delete'; END IF;
  IF _committed > 0 THEN RAISE EXCEPTION 'Batch cannot be deleted: % of % codes have been sold or assigned', _committed, _total; END IF;
  SELECT b.* INTO _batch FROM public.omada_voucher_batches b WHERE b.import_id = _import_id ORDER BY b.created_at DESC LIMIT 1 FOR UPDATE;
  _token := gen_random_uuid();
  IF _batch.id IS NULL OR _batch.generation_origin <> 'automatic' THEN
    RETURN QUERY SELECT _token, _eco, 'manual'::text, 'not_applicable'::text, 'not_requested'::text, NULL::uuid, NULL::text, NULL::text, false; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voucher_replenishment_runs r JOIN public.voucher_imports i ON i.id = _import_id WHERE r.batch_id = _batch.id AND r.trigger_source = 'sweep' AND i.source = 'omada-auto' AND i.ecosystem_id = _batch.ecosystem_id AND i.product_id = _batch.product_id) OR _batch.remote_link_status <> 'exact' OR _batch.group_id IS NULL OR _batch.group_id = '' THEN
    UPDATE public.omada_voucher_batches SET remote_link_status = 'unresolved', remote_cleanup_status = 'unresolved', remote_cleanup_claim_token = _token, remote_cleanup_error = 'No exact stored automatic Omada group relationship is available; no remote group was deleted.', remote_cleanup_updated_at = now() WHERE id = _batch.id;
    RETURN QUERY SELECT _token, _eco, 'automatic'::text, 'unresolved'::text, 'unresolved'::text, _batch.id, NULL::text, _batch.group_name, false; RETURN;
  END IF;
  UPDATE public.omada_voucher_batches SET remote_cleanup_status = CASE WHEN remote_cleanup_status IN ('deleted','already_absent') THEN remote_cleanup_status ELSE 'running' END, remote_cleanup_attempts = CASE WHEN remote_cleanup_status IN ('deleted','already_absent') THEN remote_cleanup_attempts ELSE remote_cleanup_attempts + 1 END, remote_cleanup_claim_token = _token, remote_cleanup_claimed_at = now(), remote_cleanup_error = NULL, remote_cleanup_updated_at = now() WHERE id = _batch.id;
  RETURN QUERY SELECT _token, _eco, 'automatic'::text, 'exact'::text, CASE WHEN _batch.remote_cleanup_status IN ('deleted','already_absent') THEN _batch.remote_cleanup_status ELSE 'running' END, _batch.id, _batch.group_id, _batch.group_name, _batch.remote_cleanup_status NOT IN ('deleted','already_absent');
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_voucher_batch_cleanup(_import_id uuid, _cleanup_token uuid, _remote_status text, _remote_error text DEFAULT NULL)
RETURNS TABLE(deleted_count integer, remote_cleanup_status text, remote_cleanup_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _eco uuid; _pname text; _actor text; _total integer; _committed integer; _deleted integer; _batch public.omada_voucher_batches; _final_status text;
BEGIN
  IF _remote_status NOT IN ('not_requested','deleted','already_absent','failed','unresolved') THEN RAISE EXCEPTION 'Invalid remote cleanup status'; END IF;
  SELECT i.ecosystem_id, coalesce(p.name,'') INTO _eco, _pname FROM public.voucher_imports i LEFT JOIN public.voucher_products p ON p.id = i.product_id WHERE i.id = _import_id;
  IF _eco IS NULL THEN RAISE EXCEPTION 'Upload batch not found'; END IF;
  IF NOT (public.is_ecosystem_admin(auth.uid(), _eco) OR public.is_super_admin(auth.uid())) THEN RAISE EXCEPTION 'Not authorized to manage this ecosystem'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('voucher-cleanup:' || _import_id::text, 0));
  SELECT b.* INTO _batch FROM public.omada_voucher_batches b WHERE b.import_id = _import_id ORDER BY b.created_at DESC LIMIT 1 FOR UPDATE;
  IF _batch.id IS NOT NULL AND _batch.generation_origin = 'automatic' THEN
    IF _batch.remote_cleanup_claim_token IS DISTINCT FROM _cleanup_token THEN RAISE EXCEPTION 'Voucher cleanup request is stale or invalid'; END IF;
    _final_status := _remote_status;
    UPDATE public.omada_voucher_batches SET remote_cleanup_status = _final_status, remote_cleanup_error = _remote_error, remote_cleanup_completed_at = CASE WHEN _final_status IN ('deleted','already_absent') THEN now() ELSE remote_cleanup_completed_at END, remote_cleanup_updated_at = now() WHERE id = _batch.id;
  ELSE _final_status := 'not_requested'; END IF;
  SELECT count(*)::int, count(*) FILTER (WHERE status <> 'unused' OR sold_to IS NOT NULL OR sale_id IS NOT NULL)::int INTO _total, _committed FROM public.voucher_codes WHERE import_id = _import_id;
  IF _total = 0 THEN RETURN QUERY SELECT 0, _final_status, _remote_error; RETURN; END IF;
  IF _committed > 0 THEN RAISE EXCEPTION 'Batch cannot be deleted: % of % codes have been sold or assigned', _committed, _total; END IF;
  DELETE FROM public.voucher_codes WHERE import_id = _import_id; GET DIAGNOSTICS _deleted = ROW_COUNT;
  SELECT full_name INTO _actor FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata) VALUES (_eco, auth.uid(), coalesce(_actor,'Admin'), 'Deleted voucher batch', _pname, jsonb_build_object('scope','batch','batch',_import_id,'codes',_deleted,'generation_origin',coalesce(_batch.generation_origin,'manual'),'omada_batch_id',_batch.id,'omada_group_id',_batch.group_id,'remote_cleanup_status',_final_status,'remote_cleanup_error',_remote_error));
  RETURN QUERY SELECT _deleted, _final_status, _remote_error;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_voucher_batch(_import_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _automatic boolean; _eco uuid; _pname text; _actor text; _total int; _committed int; _deleted int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.omada_voucher_batches b WHERE b.import_id = _import_id AND b.generation_origin = 'automatic') INTO _automatic;
  IF _automatic THEN RAISE EXCEPTION 'Automatic batches require coordinated Omada cleanup'; END IF;
  SELECT i.ecosystem_id, coalesce(p.name,'') INTO _eco, _pname FROM public.voucher_imports i LEFT JOIN public.voucher_products p ON p.id=i.product_id WHERE i.id=_import_id;
  IF _eco IS NULL THEN RAISE EXCEPTION 'Upload batch not found'; END IF;
  IF NOT (public.is_ecosystem_admin(auth.uid(),_eco) OR public.is_super_admin(auth.uid())) THEN RAISE EXCEPTION 'Not authorized to manage this ecosystem'; END IF;
  SELECT count(*)::int, count(*) FILTER (WHERE status <> 'unused' OR sold_to IS NOT NULL OR sale_id IS NOT NULL)::int INTO _total,_committed FROM public.voucher_codes WHERE import_id=_import_id;
  IF _total=0 THEN RAISE EXCEPTION 'This batch has no codes left to delete'; END IF;
  IF _committed>0 THEN RAISE EXCEPTION 'Batch cannot be deleted: % of % codes have been sold or assigned',_committed,_total; END IF;
  DELETE FROM public.voucher_codes WHERE import_id=_import_id; GET DIAGNOSTICS _deleted=ROW_COUNT;
  SELECT full_name INTO _actor FROM public.profiles WHERE id=auth.uid();
  INSERT INTO public.audit_logs(ecosystem_id,actor_id,actor_name,action,target,metadata) VALUES(_eco,auth.uid(),coalesce(_actor,'Admin'),'Deleted voucher batch',_pname,jsonb_build_object('scope','batch','batch',_import_id,'codes',_deleted,'generation_origin','manual','remote_cleanup_status','not_requested'));
  RETURN _deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_voucher_batches_with_cleanup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_voucher_batches_with_cleanup(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_voucher_batch_cleanup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_voucher_batch_cleanup(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.finish_voucher_batch_cleanup(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_voucher_batch_cleanup(uuid, uuid, text, text) TO authenticated, service_role;