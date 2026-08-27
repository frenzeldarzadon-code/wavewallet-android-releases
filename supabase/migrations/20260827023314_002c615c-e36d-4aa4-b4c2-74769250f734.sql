CREATE TABLE public.omada_device_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  device_mac text NOT NULL,
  device_id text,
  device_name text,
  device_type text,
  assigned_user_id uuid NOT NULL,
  assigned_by uuid,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omada_device_assignments TO authenticated;
GRANT ALL ON public.omada_device_assignments TO service_role;

ALTER TABLE public.omada_device_assignments ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX omada_device_assignment_active_unique
  ON public.omada_device_assignments (ecosystem_id, upper(device_mac))
  WHERE active;

CREATE INDEX omada_device_assignment_user_idx
  ON public.omada_device_assignments (assigned_user_id, active);

CREATE POLICY "Members read their own antenna assignment"
  ON public.omada_device_assignments
  FOR SELECT TO authenticated
  USING (assigned_user_id = auth.uid());

CREATE POLICY "Shop admins read their shop assignments"
  ON public.omada_device_assignments
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );

CREATE POLICY "Shop admins manage their shop assignments"
  ON public.omada_device_assignments
  FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );

CREATE TRIGGER omada_device_assignments_updated_at
  BEFORE UPDATE ON public.omada_device_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();