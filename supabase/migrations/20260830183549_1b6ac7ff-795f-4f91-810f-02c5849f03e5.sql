CREATE TABLE public.omada_portal_base_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version integer NOT NULL,
  file_name text NOT NULL,
  template_html text NOT NULL,
  template_bytes integer NOT NULL,
  checksum text NOT NULL,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_valid boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT false,
  notes text,
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX omada_portal_base_templates_version_idx
  ON public.omada_portal_base_templates (version);

CREATE UNIQUE INDEX omada_portal_base_templates_one_active_idx
  ON public.omada_portal_base_templates (is_active)
  WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omada_portal_base_templates TO authenticated;
GRANT ALL ON public.omada_portal_base_templates TO service_role;

ALTER TABLE public.omada_portal_base_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform owner manages portal base templates"
ON public.omada_portal_base_templates FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER update_omada_portal_base_templates_updated_at
BEFORE UPDATE ON public.omada_portal_base_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.omada_portal_templates
  ADD COLUMN base_template_id uuid REFERENCES public.omada_portal_base_templates(id) ON DELETE SET NULL,
  ADD COLUMN base_version integer,
  ADD COLUMN generated_checksum text,
  ADD COLUMN downloaded_at timestamp with time zone;