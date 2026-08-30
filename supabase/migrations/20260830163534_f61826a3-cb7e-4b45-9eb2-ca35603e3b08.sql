CREATE TABLE public.omada_portal_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  site_id text NOT NULL,
  site_name text,
  portal_id text NOT NULL,
  portal_name text,
  ssid_info text,
  enabled boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_test_status text,
  last_test_at timestamp with time zone,
  last_test_detail text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (ecosystem_id, site_id, portal_id)
);

CREATE INDEX omada_portal_mappings_ecosystem_idx ON public.omada_portal_mappings (ecosystem_id);
CREATE INDEX omada_portal_mappings_lookup_idx ON public.omada_portal_mappings (site_id, portal_id) WHERE enabled;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omada_portal_mappings TO authenticated;
GRANT ALL ON public.omada_portal_mappings TO service_role;

ALTER TABLE public.omada_portal_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop admins manage their own portal mappings"
ON public.omada_portal_mappings FOR ALL TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
);

CREATE TRIGGER update_omada_portal_mappings_updated_at
BEFORE UPDATE ON public.omada_portal_mappings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.portal_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mapping_id uuid NOT NULL REFERENCES public.omada_portal_mappings(id) ON DELETE CASCADE,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  client_mac text,
  client_ip text,
  ap_mac text,
  ssid text,
  radio_id text,
  site_ref text,
  redirect_url text,
  member_id uuid,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '45 minutes'),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX portal_sessions_expiry_idx ON public.portal_sessions (expires_at);

GRANT ALL ON public.portal_sessions TO service_role;

ALTER TABLE public.portal_sessions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_portal_sessions_updated_at
BEFORE UPDATE ON public.portal_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.portal_authorizations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.portal_sessions(id) ON DELETE CASCADE,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  member_id uuid,
  sale_id uuid,
  voucher_code text,
  duration_minutes integer,
  status text NOT NULL DEFAULT 'pending',
  error text,
  authorized_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX portal_authorizations_session_idx ON public.portal_authorizations (session_id);
CREATE UNIQUE INDEX portal_authorizations_sale_success_idx
  ON public.portal_authorizations (sale_id) WHERE status = 'authorized' AND sale_id IS NOT NULL;

GRANT ALL ON public.portal_authorizations TO service_role;

ALTER TABLE public.portal_authorizations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_portal_authorizations_updated_at
BEFORE UPDATE ON public.portal_authorizations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();