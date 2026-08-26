
CREATE TABLE public.voucher_device_tracers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  voucher_code text NOT NULL,
  device_mac text NOT NULL,
  tracer text NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  in_conflict boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX voucher_device_tracers_lookup
  ON public.voucher_device_tracers (ecosystem_id, voucher_code, device_mac, recorded_at DESC);
CREATE INDEX voucher_device_tracers_mac
  ON public.voucher_device_tracers (ecosystem_id, device_mac, recorded_at DESC);

GRANT SELECT ON public.voucher_device_tracers TO authenticated;
GRANT ALL ON public.voucher_device_tracers TO service_role;

ALTER TABLE public.voucher_device_tracers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop admins read tracer history"
  ON public.voucher_device_tracers FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );

-- Anyone may record a tracer for a device; history is append-only and
-- conflicting labels never overwrite an existing association.
CREATE OR REPLACE FUNCTION public.set_voucher_tracer(
  _ecosystem_id uuid,
  _voucher_code text,
  _device_mac text,
  _tracer text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(btrim(_voucher_code));
  v_mac text := upper(btrim(_device_mac));
  v_tracer text := btrim(_tracer);
  v_current public.voucher_device_tracers;
  v_id uuid;
  v_admin uuid;
BEGIN
  IF v_code = '' OR v_mac = '' THEN
    RAISE EXCEPTION 'A voucher code and device are required.';
  END IF;
  IF v_tracer = '' OR length(v_tracer) > 80 THEN
    RAISE EXCEPTION 'Enter a tracer label of up to 80 characters.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ecosystems WHERE id = _ecosystem_id) THEN
    RAISE EXCEPTION 'Unknown shop.';
  END IF;

  SELECT * INTO v_current
  FROM public.voucher_device_tracers
  WHERE ecosystem_id = _ecosystem_id AND device_mac = v_mac AND is_primary
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_current.id IS NOT NULL AND lower(v_current.tracer) = lower(v_tracer) THEN
    RETURN jsonb_build_object('outcome', 'unchanged', 'id', v_current.id);
  END IF;

  IF v_current.id IS NULL THEN
    INSERT INTO public.voucher_device_tracers
      (ecosystem_id, voucher_code, device_mac, tracer, is_primary, in_conflict, created_by)
    VALUES (_ecosystem_id, v_code, v_mac, v_tracer, true, false, auth.uid())
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('outcome', 'recorded', 'id', v_id);
  END IF;

  -- Different label for a device that already has one: keep both.
  INSERT INTO public.voucher_device_tracers
    (ecosystem_id, voucher_code, device_mac, tracer, is_primary, in_conflict, created_by)
  VALUES (_ecosystem_id, v_code, v_mac, v_tracer, false, true, auth.uid())
  RETURNING id INTO v_id;

  UPDATE public.voucher_device_tracers
     SET in_conflict = true
   WHERE ecosystem_id = _ecosystem_id AND device_mac = v_mac;

  FOR v_admin IN
    SELECT user_id FROM public.user_roles
    WHERE ecosystem_id = _ecosystem_id AND role = 'admin'
  LOOP
    INSERT INTO public.member_notifications
      (user_id, ecosystem_id, kind, category, title, body, link, event_key)
    VALUES (
      v_admin, _ecosystem_id, 'voucher_tracer_conflict', 'operations',
      'Conflicting tracer for a device',
      'Device ' || v_mac || ' on voucher ' || v_code || ' was labelled "' || v_tracer ||
      '" but is already recorded as "' || v_current.tracer || '". Choose the current label.',
      '/admin/omada', 'voucher_tracer_conflict:' || v_id::text
    );
  END LOOP;

  RETURN jsonb_build_object('outcome', 'conflict', 'id', v_id, 'existing', v_current.tracer);
END;
$$;

REVOKE ALL ON FUNCTION public.set_voucher_tracer(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_voucher_tracer(uuid, text, text, text) TO anon, authenticated, service_role;

-- Tracer labels + history for one searched voucher code.
CREATE OR REPLACE FUNCTION public.voucher_tracer_history(
  _ecosystem_id uuid,
  _voucher_code text
) RETURNS TABLE (
  id uuid,
  voucher_code text,
  device_mac text,
  tracer text,
  is_primary boolean,
  in_conflict boolean,
  recorded_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.voucher_code, t.device_mac, t.tracer, t.is_primary, t.in_conflict, t.recorded_at
  FROM public.voucher_device_tracers t
  WHERE t.ecosystem_id = _ecosystem_id
    AND t.voucher_code = upper(btrim(_voucher_code))
  ORDER BY t.recorded_at DESC
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.voucher_tracer_history(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.voucher_tracer_history(uuid, text) TO anon, authenticated, service_role;

-- Admin-only: outstanding conflicts for a shop.
CREATE OR REPLACE FUNCTION public.voucher_tracer_conflicts(_ecosystem_id uuid)
RETURNS TABLE (
  id uuid,
  voucher_code text,
  device_mac text,
  tracer text,
  is_primary boolean,
  recorded_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_super_admin(auth.uid()) OR public.is_ecosystem_admin(auth.uid(), _ecosystem_id)) THEN
    RAISE EXCEPTION 'Only this shop''s admin can review tracer conflicts.';
  END IF;
  RETURN QUERY
    SELECT t.id, t.voucher_code, t.device_mac, t.tracer, t.is_primary, t.recorded_at
    FROM public.voucher_device_tracers t
    WHERE t.ecosystem_id = _ecosystem_id AND t.in_conflict
    ORDER BY t.device_mac, t.recorded_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.voucher_tracer_conflicts(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.voucher_tracer_conflicts(uuid) TO authenticated, service_role;

-- Admin-only: choose the current/primary label; history is never deleted.
CREATE OR REPLACE FUNCTION public.resolve_voucher_tracer(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.voucher_device_tracers;
BEGIN
  SELECT * INTO v_row FROM public.voucher_device_tracers WHERE id = _id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'That tracer record no longer exists.';
  END IF;
  IF NOT (public.is_super_admin(auth.uid()) OR public.is_ecosystem_admin(auth.uid(), v_row.ecosystem_id)) THEN
    RAISE EXCEPTION 'Only this shop''s admin can resolve tracer conflicts.';
  END IF;

  UPDATE public.voucher_device_tracers
     SET is_primary = (id = _id),
         in_conflict = false,
         resolved_at = now(),
         resolved_by = auth.uid()
   WHERE ecosystem_id = v_row.ecosystem_id AND device_mac = v_row.device_mac;

  RETURN jsonb_build_object('outcome', 'resolved', 'id', _id);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_voucher_tracer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_voucher_tracer(uuid) TO authenticated, service_role;
