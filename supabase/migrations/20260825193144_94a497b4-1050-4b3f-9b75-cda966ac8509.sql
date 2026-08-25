CREATE TABLE public.omada_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL UNIQUE REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  base_url text NOT NULL,
  omadac_id text NOT NULL,
  client_id text NOT NULL,
  client_secret_ciphertext text NOT NULL,
  site_name text,
  site_id text,
  last_status text NOT NULL DEFAULT 'untested',
  last_checked_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.omada_connections TO service_role;
ALTER TABLE public.omada_connections ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated grants: every read and write goes through
-- tenant-authorized server functions using the service-role client.

CREATE OR REPLACE FUNCTION public.tg_omada_connections_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER omada_connections_touch
BEFORE UPDATE ON public.omada_connections
FOR EACH ROW EXECUTE FUNCTION public.tg_omada_connections_touch();