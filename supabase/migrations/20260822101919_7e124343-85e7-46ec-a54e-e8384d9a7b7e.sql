-- Developer Mode: role-level UI layout configuration (visual only).
CREATE TABLE public.ui_layout_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  ecosystem_id uuid REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ui_layout_configs_scope_key
  ON public.ui_layout_configs (role, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT ON public.ui_layout_configs TO authenticated;
GRANT SELECT ON public.ui_layout_configs TO anon;
GRANT ALL ON public.ui_layout_configs TO service_role;
ALTER TABLE public.ui_layout_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ui layout readable by everyone"
  ON public.ui_layout_configs FOR SELECT USING (true);
CREATE POLICY "ui layout managed by super admins"
  ON public.ui_layout_configs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.ui_layout_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  ecosystem_id uuid,
  action text NOT NULL,
  target_kind text NOT NULL DEFAULT 'layout',
  target_id text,
  target_label text,
  previous_payload jsonb,
  next_payload jsonb,
  actor_id uuid,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ui_layout_audit TO authenticated;
GRANT ALL ON public.ui_layout_audit TO service_role;
ALTER TABLE public.ui_layout_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ui layout audit visible to super admins"
  ON public.ui_layout_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Saves a role layout. Super Admin only; every save is recorded in the audit trail.
CREATE OR REPLACE FUNCTION public.set_ui_layout(
  _role public.app_role,
  _payload jsonb,
  _action text DEFAULT 'update',
  _target_kind text DEFAULT 'layout',
  _target_id text DEFAULT NULL,
  _target_label text DEFAULT NULL,
  _ecosystem_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _prev jsonb;
  _actor uuid := auth.uid();
  _name text;
BEGIN
  IF NOT public.has_role(_actor, 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin may change the interface layout';
  END IF;

  SELECT payload INTO _prev FROM public.ui_layout_configs
   WHERE role = _role AND coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(_ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid);

  INSERT INTO public.ui_layout_configs (role, ecosystem_id, payload, updated_by, updated_at)
  VALUES (_role, _ecosystem_id, coalesce(_payload, '{}'::jsonb), _actor, now())
  ON CONFLICT (role, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET payload = excluded.payload, updated_by = excluded.updated_by, updated_at = now();

  SELECT full_name INTO _name FROM public.profiles WHERE id = _actor;

  INSERT INTO public.ui_layout_audit (
    role, ecosystem_id, action, target_kind, target_id, target_label,
    previous_payload, next_payload, actor_id, actor_name)
  VALUES (_role, _ecosystem_id, coalesce(_action, 'update'), coalesce(_target_kind, 'layout'),
          _target_id, _target_label, _prev, coalesce(_payload, '{}'::jsonb), _actor, _name);

  RETURN coalesce(_payload, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.set_ui_layout(public.app_role, jsonb, text, text, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.set_ui_layout(public.app_role, jsonb, text, text, text, text, uuid) TO authenticated;

-- Restores the layout captured before a given audit entry.
CREATE OR REPLACE FUNCTION public.restore_ui_layout(_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.ui_layout_audit;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin may restore an interface layout';
  END IF;
  SELECT * INTO _row FROM public.ui_layout_audit WHERE id = _audit_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Layout history entry not found'; END IF;
  RETURN public.set_ui_layout(_row.role, coalesce(_row.previous_payload, '{}'::jsonb),
    'restore', 'layout', _audit_id::text, _row.target_label, _row.ecosystem_id);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_ui_layout(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.restore_ui_layout(uuid) TO authenticated;