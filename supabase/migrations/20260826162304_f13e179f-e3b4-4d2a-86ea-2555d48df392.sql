
CREATE OR REPLACE FUNCTION public.assert_voucher_tracer_member(_ecosystem_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to this shop to use its voucher status checker.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ecosystems WHERE id = _ecosystem_id) THEN
    RAISE EXCEPTION 'Unknown shop.';
  END IF;
  IF public.is_super_admin(auth.uid()) OR public.is_ecosystem_admin(auth.uid(), _ecosystem_id) THEN
    RETURN;
  END IF;
  IF NOT public.has_membership(auth.uid(), _ecosystem_id) THEN
    RAISE EXCEPTION 'You are not a member of this shop.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_voucher_tracer_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_voucher_tracer_member(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_voucher_tracer(_ecosystem_id uuid, _voucher_code text, _device_mac text, _tracer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  PERFORM public.assert_voucher_tracer_member(_ecosystem_id);

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
$function$;

CREATE OR REPLACE FUNCTION public.voucher_tracer_history(_ecosystem_id uuid, _voucher_code text)
 RETURNS TABLE(id uuid, voucher_code text, device_mac text, tracer text, is_primary boolean, in_conflict boolean, recorded_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_voucher_tracer_member(_ecosystem_id);
  RETURN QUERY
    SELECT t.id, t.voucher_code, t.device_mac, t.tracer, t.is_primary, t.in_conflict, t.recorded_at
    FROM public.voucher_device_tracers t
    WHERE t.ecosystem_id = _ecosystem_id AND t.voucher_code = upper(btrim(_voucher_code))
    ORDER BY t.device_mac, t.recorded_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_voucher_tracer(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_voucher_tracer(uuid, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.voucher_tracer_history(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voucher_tracer_history(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.voucher_tracer_conflicts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voucher_tracer_conflicts(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_voucher_tracer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_voucher_tracer(uuid) TO authenticated, service_role;
