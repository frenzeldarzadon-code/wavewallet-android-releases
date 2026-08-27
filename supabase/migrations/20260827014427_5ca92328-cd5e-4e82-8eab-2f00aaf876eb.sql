CREATE TABLE public.voucher_usage_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  voucher_code text NOT NULL,
  device_mac text NOT NULL,
  session_key text NOT NULL DEFAULT 'unknown',
  device_name text,
  ip_address text,
  ap_identifier text,
  network_name text,
  site_id text,
  connected_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  traffic_bytes bigint,
  voucher_state text
);

CREATE UNIQUE INDEX voucher_usage_sessions_unique
  ON public.voucher_usage_sessions (ecosystem_id, upper(voucher_code), upper(device_mac), session_key);
CREATE INDEX voucher_usage_sessions_lookup
  ON public.voucher_usage_sessions (ecosystem_id, voucher_code, last_seen_at DESC);

GRANT SELECT ON public.voucher_usage_sessions TO authenticated;
GRANT ALL ON public.voucher_usage_sessions TO service_role;

ALTER TABLE public.voucher_usage_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop admins read voucher usage history"
  ON public.voucher_usage_sessions FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );