CREATE TABLE public.omada_voucher_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  group_id text,
  group_name text NOT NULL,
  amount integer NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.omada_voucher_batches TO authenticated;
GRANT ALL ON public.omada_voucher_batches TO service_role;

ALTER TABLE public.omada_voucher_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop admins read their own Omada batches"
ON public.omada_voucher_batches
FOR SELECT
TO authenticated
USING (public.is_ecosystem_admin(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()));

CREATE INDEX omada_voucher_batches_eco_idx
  ON public.omada_voucher_batches (ecosystem_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_omada_voucher_batches()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER update_omada_voucher_batches_updated_at
BEFORE UPDATE ON public.omada_voucher_batches
FOR EACH ROW EXECUTE FUNCTION public.touch_omada_voucher_batches();