CREATE OR REPLACE FUNCTION public.guard_voucher_code_during_remote_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.import_id IS NOT NULL
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.sold_to IS DISTINCT FROM OLD.sold_to OR NEW.sale_id IS DISTINCT FROM OLD.sale_id)
     AND EXISTS (
       SELECT 1 FROM public.omada_voucher_batches b
       WHERE b.import_id = OLD.import_id
         AND b.generation_origin = 'automatic'
         AND b.remote_cleanup_status = 'running'
     ) THEN
    RAISE EXCEPTION 'This voucher batch is being safely removed; choose another available voucher';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER guard_voucher_code_remote_cleanup
BEFORE UPDATE OF status, sold_to, sale_id ON public.voucher_codes
FOR EACH ROW EXECUTE FUNCTION public.guard_voucher_code_during_remote_cleanup();