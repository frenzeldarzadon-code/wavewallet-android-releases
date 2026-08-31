CREATE TABLE public.voucher_monitors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  code text NOT NULL,
  product_id uuid REFERENCES public.voucher_products(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','purchase')),
  monitoring boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ecosystem_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voucher_monitors TO authenticated;
GRANT ALL ON public.voucher_monitors TO service_role;

ALTER TABLE public.voucher_monitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage their own monitoring list"
ON public.voucher_monitors FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX voucher_monitors_user_shop_idx ON public.voucher_monitors (user_id, ecosystem_id);

CREATE TRIGGER update_voucher_monitors_updated_at
BEFORE UPDATE ON public.voucher_monitors
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();