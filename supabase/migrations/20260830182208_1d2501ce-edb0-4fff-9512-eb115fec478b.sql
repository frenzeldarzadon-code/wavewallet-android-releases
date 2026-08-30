CREATE TABLE public.omada_portal_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mapping_id uuid NOT NULL UNIQUE REFERENCES public.omada_portal_mappings(id) ON DELETE CASCADE,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  file_name text,
  template_html text,
  template_bytes integer,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_html text,
  generated_at timestamp with time zone,
  import_status text NOT NULL DEFAULT 'manual_required',
  import_detail text,
  import_verified_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX omada_portal_templates_ecosystem_idx
  ON public.omada_portal_templates (ecosystem_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omada_portal_templates TO authenticated;
GRANT ALL ON public.omada_portal_templates TO service_role;

ALTER TABLE public.omada_portal_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop admins manage their own portal templates"
ON public.omada_portal_templates FOR ALL TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
);

CREATE TRIGGER update_omada_portal_templates_updated_at
BEFORE UPDATE ON public.omada_portal_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();