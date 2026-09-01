ALTER TABLE public.omada_connections
  ADD COLUMN IF NOT EXISTS hotspot_operator_user text,
  ADD COLUMN IF NOT EXISTS hotspot_operator_secret_ciphertext text;

COMMENT ON COLUMN public.omada_connections.hotspot_operator_user IS 'Hotspot Operator username used by the Omada External Portal API (per shop).';
COMMENT ON COLUMN public.omada_connections.hotspot_operator_secret_ciphertext IS 'Encrypted Hotspot Operator password; server-only, never returned to the browser.';