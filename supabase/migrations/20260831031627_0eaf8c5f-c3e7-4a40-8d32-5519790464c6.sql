-- 1) Sales must survive product deletion: keep the snapshot, drop the hard link.
ALTER TABLE public.voucher_sales ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.voucher_sales DROP CONSTRAINT voucher_sales_product_id_fkey;
ALTER TABLE public.voucher_sales
  ADD CONSTRAINT voucher_sales_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.voucher_products(id) ON DELETE SET NULL;

-- 2) Explicit, product-scoped deletion.
CREATE OR REPLACE FUNCTION public.delete_voucher_product(
  _product_id uuid,
  _confirm_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.voucher_products%ROWTYPE;
  v_codes integer := 0;
  v_runs integer := 0;
BEGIN
  SELECT * INTO v_product FROM public.voucher_products WHERE id = _product_id;

  -- Idempotent: a retry after a successful delete is a no-op, not an error.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'already_deleted', true, 'codes_removed', 0);
  END IF;

  IF NOT (public.is_super_admin(auth.uid())
          OR public.is_ecosystem_admin(auth.uid(), v_product.ecosystem_id)) THEN
    RAISE EXCEPTION 'Only this shop''s admin can delete a voucher product.';
  END IF;

  IF btrim(coalesce(_confirm_name, '')) <> btrim(v_product.name) THEN
    RAISE EXCEPTION 'The typed product name does not match.';
  END IF;

  -- Stop any in-flight automatic replenishment for THIS product only.
  UPDATE public.voucher_replenishment_runs
     SET status = 'failed',
         error = 'Voucher product deleted.',
         finished_at = now()
   WHERE product_id = _product_id
     AND status IN ('queued', 'running');
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  SELECT count(*) INTO v_codes FROM public.voucher_codes WHERE product_id = _product_id;

  -- WaveWallet-side records only. Omada is never contacted.
  -- voucher_codes, voucher_imports, calibrations, runs and ratings cascade on
  -- this exact product id; voucher_sales and omada_voucher_batches keep their
  -- rows with a null product reference plus their stored snapshots.
  DELETE FROM public.voucher_products WHERE id = _product_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'already_deleted', false,
    'product_id', _product_id,
    'name', v_product.name,
    'codes_removed', v_codes,
    'runs_cancelled', v_runs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_voucher_product(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_voucher_product(uuid, text) TO authenticated;
