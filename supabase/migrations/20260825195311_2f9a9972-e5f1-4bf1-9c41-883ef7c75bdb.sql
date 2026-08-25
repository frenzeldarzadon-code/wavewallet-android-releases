ALTER TABLE public.omada_connections
  ADD COLUMN IF NOT EXISTS monitoring_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS health_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_check_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_reason text,
  ADD COLUMN IF NOT EXISTS offline_since timestamptz,
  ADD COLUMN IF NOT EXISTS last_recovered_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_token_ciphertext text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

ALTER TABLE public.omada_connections
  DROP CONSTRAINT IF EXISTS omada_connections_health_state_check;
ALTER TABLE public.omada_connections
  ADD CONSTRAINT omada_connections_health_state_check
  CHECK (health_state IN ('unknown','healthy','unreachable','auth_failed','degraded'));

CREATE INDEX IF NOT EXISTS omada_connections_due_idx
  ON public.omada_connections (next_check_at)
  WHERE monitoring_enabled;