ALTER TABLE public.omada_portal_mappings
  ADD COLUMN IF NOT EXISTS auto_config_status text,
  ADD COLUMN IF NOT EXISTS auto_config_url text,
  ADD COLUMN IF NOT EXISTS auto_config_detail text,
  ADD COLUMN IF NOT EXISTS auto_config_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_config_snapshot jsonb;