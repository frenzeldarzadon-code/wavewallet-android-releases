CREATE TABLE public.portal_handoffs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ecosystem_id UUID NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  mapping_id UUID NOT NULL REFERENCES public.omada_portal_mappings(id) ON DELETE CASCADE,
  portal_id TEXT,
  site_id TEXT,
  session_id UUID REFERENCES public.portal_sessions(id) ON DELETE SET NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX portal_handoffs_mapping_idx ON public.portal_handoffs (mapping_id, created_at DESC);

GRANT ALL ON public.portal_handoffs TO service_role;

ALTER TABLE public.portal_handoffs ENABLE ROW LEVEL SECURITY;