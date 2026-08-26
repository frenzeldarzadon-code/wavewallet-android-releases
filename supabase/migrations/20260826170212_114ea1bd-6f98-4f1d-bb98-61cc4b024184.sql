CREATE TABLE public.omada_voucher_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.voucher_products(id) ON DELETE CASCADE,
  version integer NOT NULL,
  payload jsonb NOT NULL,
  controller_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_current boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ecosystem_id, product_id, version)
);

CREATE INDEX omada_voucher_calibrations_current_idx
  ON public.omada_voucher_calibrations (ecosystem_id, product_id, is_current);

GRANT SELECT ON public.omada_voucher_calibrations TO authenticated;
GRANT ALL ON public.omada_voucher_calibrations TO service_role;

ALTER TABLE public.omada_voucher_calibrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop admins read their own calibrations"
  ON public.omada_voucher_calibrations FOR SELECT TO authenticated
  USING (
    public.is_ecosystem_admin(auth.uid(), ecosystem_id)
    OR public.is_super_admin(auth.uid())
  );

CREATE TRIGGER omada_voucher_calibrations_updated_at
  BEFORE UPDATE ON public.omada_voucher_calibrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.omada_voucher_batches
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.voucher_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calibration_id uuid REFERENCES public.omada_voucher_calibrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calibration_version integer,
  ADD COLUMN IF NOT EXISTS controller_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES public.voucher_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS imported_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extracted_count integer NOT NULL DEFAULT 0;