ALTER TABLE public.omada_portal_base_templates
  ADD COLUMN IF NOT EXISTS original_file_name text,
  ADD COLUMN IF NOT EXISTS original_content text,
  ADD COLUMN IF NOT EXISTS original_bytes integer,
  ADD COLUMN IF NOT EXISTS original_checksum text,
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'html',
  ADD COLUMN IF NOT EXISTS archive_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP POLICY IF EXISTS "Platform owner manages portal base templates" ON public.omada_portal_base_templates;

CREATE POLICY "Platform owner manages portal base templates"
ON public.omada_portal_base_templates FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Signed-in admins can read the canonical portal templates"
ON public.omada_portal_base_templates FOR SELECT TO authenticated
USING (true);