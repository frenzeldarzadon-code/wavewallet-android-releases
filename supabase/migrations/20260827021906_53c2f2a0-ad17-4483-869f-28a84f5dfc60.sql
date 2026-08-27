ALTER TABLE public.voucher_usage_sessions
  ADD COLUMN IF NOT EXISTS authorization_id text,
  ADD COLUMN IF NOT EXISTS authorized_until timestamptz,
  ADD COLUMN IF NOT EXISTS still_valid boolean,
  ADD COLUMN IF NOT EXISTS duration_seconds bigint;