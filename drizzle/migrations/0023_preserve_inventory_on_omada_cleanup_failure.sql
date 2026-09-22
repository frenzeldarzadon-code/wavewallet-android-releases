CREATE OR REPLACE FUNCTION public.finish_voucher_batch_cleanup(_import_id uuid, _cleanup_token uuid, _remote_status text, _remote_error text DEFAULT NULL)
RETURNS TABLE(deleted_count integer, remote_cleanup_status text, remote_cleanup_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _eco uuid; _pname text; _actor text; _total integer; _committed integer; _deleted integer; _batch public.omada_voucher_batches; _final_status text;
BEGIN
  IF _remote_status NOT IN ('not_requested','deleted','already_absent','failed','unresolved') THEN RAISE EXCEPTION 'Invalid remote cleanup status'; END IF;
  SELECT i.ecosystem_id, coalesce(p.name,'')
    INTO _eco, _pname
    FROM public.voucher_imports AS i
    LEFT JOIN public.voucher_products AS p ON p.id = i.product_id
   WHERE i.id = _import_id;
  IF _eco IS NULL THEN RAISE EXCEPTION 'Upload batch not found'; END IF;
  IF NOT (public.is_ecosystem_admin(auth.uid(), _eco) OR public.is_super_admin(auth.uid())) THEN RAISE EXCEPTION 'Not authorized to manage this ecosystem'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('voucher-cleanup:' || _import_id::text, 0));
  SELECT b.* INTO _batch FROM public.omada_voucher_batches AS b WHERE b.import_id = _import_id ORDER BY b.created_at DESC LIMIT 1 FOR UPDATE;
  IF _batch.id IS NOT NULL AND _batch.generation_origin = 'automatic' THEN
    IF _batch.remote_cleanup_claim_token IS DISTINCT FROM _cleanup_token THEN RAISE EXCEPTION 'Voucher cleanup request is stale or invalid'; END IF;
    _final_status := _remote_status;
    UPDATE public.omada_voucher_batches AS ovb
       SET remote_cleanup_status = _final_status,
           remote_cleanup_error = _remote_error,
           remote_cleanup_completed_at = CASE WHEN _final_status IN ('deleted','already_absent') THEN now() ELSE ovb.remote_cleanup_completed_at END,
           remote_cleanup_updated_at = now()
     WHERE ovb.id = _batch.id;
    IF _final_status NOT IN ('deleted','already_absent') THEN
      RETURN QUERY SELECT 0, _final_status, _remote_error;
      RETURN;
    END IF;
  ELSE
    _final_status := 'not_requested';
  END IF;
  SELECT count(*)::int,
         count(*) FILTER (WHERE vc.status <> 'unused' OR vc.sold_to IS NOT NULL OR vc.sale_id IS NOT NULL)::int
    INTO _total, _committed
    FROM public.voucher_codes AS vc
   WHERE vc.import_id = _import_id;
  IF _total = 0 THEN RETURN QUERY SELECT 0, _final_status, _remote_error; RETURN; END IF;
  IF _committed > 0 THEN RAISE EXCEPTION 'Batch cannot be deleted: % of % codes have been sold or assigned', _committed, _total; END IF;
  DELETE FROM public.voucher_codes AS vc WHERE vc.import_id = _import_id;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  SELECT p.full_name INTO _actor FROM public.profiles AS p WHERE p.id = auth.uid();
  INSERT INTO public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  VALUES (_eco, auth.uid(), coalesce(_actor,'Admin'), 'Deleted voucher batch', _pname,
    jsonb_build_object('scope','batch','batch',_import_id,'codes',_deleted,'generation_origin',coalesce(_batch.generation_origin,'manual'),'omada_batch_id',_batch.id,'omada_group_id',_batch.group_id,'remote_cleanup_status',_final_status,'remote_cleanup_error',_remote_error));
  RETURN QUERY SELECT _deleted, _final_status, _remote_error;
END;
$function$;

REVOKE ALL ON FUNCTION public.finish_voucher_batch_cleanup(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_voucher_batch_cleanup(uuid, uuid, text, text) TO authenticated, service_role;