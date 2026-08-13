CREATE TABLE public.member_social_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','x','youtube','website','custom')),
  url text NOT NULL CHECK (url ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/.*)?$' AND length(url) <= 300),
  label text NOT NULL DEFAULT '' CHECK (length(label) <= 40),
  is_public boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX member_social_links_owner_idx ON public.member_social_links (ecosystem_id, user_id, sort_order);
CREATE UNIQUE INDEX member_social_links_unique_url ON public.member_social_links (user_id, lower(url));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_social_links TO authenticated;
GRANT ALL ON public.member_social_links TO service_role;

ALTER TABLE public.member_social_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage their own links"
ON public.member_social_links FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND ecosystem_id = public.current_ecosystem(auth.uid()));

CREATE POLICY "Shop members see public links"
ON public.member_social_links FOR SELECT TO authenticated
USING (is_public AND ecosystem_id = public.current_ecosystem(auth.uid()));

CREATE POLICY "Shop admins see links in their shop"
ON public.member_social_links FOR SELECT TO authenticated
USING (public.is_ecosystem_admin(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Shop admins remove abusive links"
ON public.member_social_links FOR DELETE TO authenticated
USING (public.is_ecosystem_admin(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()));

CREATE TRIGGER member_social_links_updated_at
BEFORE UPDATE ON public.member_social_links
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.public_social_links(_user_id uuid)
RETURNS TABLE (id uuid, platform text, url text, label text, sort_order integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.platform, l.url, l.label, l.sort_order
  FROM public.member_social_links l
  WHERE l.user_id = _user_id
    AND l.ecosystem_id = public.current_ecosystem(auth.uid())
    AND (l.is_public OR l.user_id = auth.uid())
  ORDER BY l.sort_order, l.created_at
$$;

REVOKE ALL ON FUNCTION public.public_social_links(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.public_social_links(uuid) TO authenticated;