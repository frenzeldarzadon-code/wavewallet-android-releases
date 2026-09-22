CREATE TABLE public.voucher_replenishment_states (
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.voucher_products(id) ON DELETE CASCADE,
  event_number integer NOT NULL DEFAULT 0,
  low_stock_active boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ready',
  run_id uuid REFERENCES public.voucher_replenishment_runs(id) ON DELETE SET NULL,
  group_name text,
  group_id text,
  attempts integer NOT NULL DEFAULT 0,
  observed_available integer NOT NULL DEFAULT 0,
  generated_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  error text,
  retry_after timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ecosystem_id, product_id),
  CONSTRAINT voucher_replenishment_states_status_check CHECK (status IN ('ready','running','paused','completed')),
  CONSTRAINT voucher_replenishment_states_attempts_check CHECK (attempts >= 0),
  CONSTRAINT voucher_replenishment_states_counts_check CHECK (generated_count >= 0 AND imported_count >= 0)
);

GRANT SELECT ON public.voucher_replenishment_states TO authenticated;
GRANT ALL ON public.voucher_replenishment_states TO service_role;

ALTER TABLE public.voucher_replenishment_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop admins read replenishment state"
ON public.voucher_replenishment_states
FOR SELECT
TO authenticated
USING (public.is_ecosystem_admin(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()));

CREATE INDEX voucher_replenishment_states_status_idx
ON public.voucher_replenishment_states (status, retry_after);

CREATE TRIGGER update_voucher_replenishment_states_updated_at
BEFORE UPDATE ON public.voucher_replenishment_states
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.claim_voucher_replenishment_event(
  _ecosystem_id uuid,
  _product_id uuid,
  _calibration_id uuid,
  _calibration_version integer,
  _available integer,
  _trigger_source text,
  _group_name text,
  _now timestamptz DEFAULT now()
)
RETURNS TABLE(claimed boolean, reason text, run_id uuid, event_number integer, group_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _state public.voucher_replenishment_states;
  _run uuid;
  _event integer;
  _name text;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_ecosystem_id::text || ':' || _product_id::text, 0));

  INSERT INTO public.voucher_replenishment_states (ecosystem_id, product_id, observed_available)
  VALUES (_ecosystem_id, _product_id, greatest(coalesce(_available, 0), 0))
  ON CONFLICT (ecosystem_id, product_id) DO NOTHING;

  SELECT * INTO _state
  FROM public.voucher_replenishment_states
  WHERE ecosystem_id = _ecosystem_id AND product_id = _product_id
  FOR UPDATE;

  IF coalesce(_available, 0) >= 100 THEN
    UPDATE public.voucher_replenishment_states
    SET low_stock_active = false,
        status = 'ready',
        run_id = NULL,
        group_name = NULL,
        group_id = NULL,
        attempts = 0,
        observed_available = _available,
        generated_count = 0,
        imported_count = 0,
        error = NULL,
        retry_after = NULL,
        opened_at = NULL,
        completed_at = NULL
    WHERE ecosystem_id = _ecosystem_id AND product_id = _product_id;
    RETURN QUERY SELECT false, 'stocked'::text, NULL::uuid, _state.event_number, NULL::text;
    RETURN;
  END IF;

  IF _state.low_stock_active THEN
    IF _state.status = 'completed' THEN
      RETURN QUERY SELECT false, 'event_completed'::text, _state.run_id, _state.event_number, _state.group_name;
      RETURN;
    END IF;
    IF _state.status = 'running' THEN
      IF _state.updated_at >= _now - interval '30 minutes' THEN
        RETURN QUERY SELECT false, 'in_progress'::text, _state.run_id, _state.event_number, _state.group_name;
        RETURN;
      END IF;
      UPDATE public.voucher_replenishment_runs
      SET status = 'failed', error = 'Abandoned run paused for safe recovery.', finished_at = _now
      WHERE id = _state.run_id AND status IN ('queued','running');
      UPDATE public.voucher_replenishment_states
      SET status = 'paused', error = 'Abandoned run paused for safe recovery.', retry_after = _now + interval '6 hours'
      WHERE ecosystem_id = _ecosystem_id AND product_id = _product_id;
      RETURN QUERY SELECT false, 'event_paused'::text, _state.run_id, _state.event_number, _state.group_name;
      RETURN;
    END IF;
    IF _state.status = 'paused' AND (_state.attempts >= 3 OR _state.retry_after IS NULL OR _state.retry_after > _now) THEN
      RETURN QUERY SELECT false, 'event_paused'::text, _state.run_id, _state.event_number, _state.group_name;
      RETURN;
    END IF;
    _event := _state.event_number;
    _name := coalesce(_state.group_name, _group_name);
  ELSE
    _event := _state.event_number + 1;
    _name := _group_name;
  END IF;

  INSERT INTO public.voucher_replenishment_runs (
    ecosystem_id, product_id, calibration_id, calibration_version, status,
    trigger_source, available_before, requested_count
  ) VALUES (
    _ecosystem_id, _product_id, _calibration_id, _calibration_version, 'running',
    coalesce(_trigger_source, 'sweep'), greatest(coalesce(_available,0),0), 500
  ) RETURNING id INTO _run;

  UPDATE public.voucher_replenishment_states
  SET event_number = _event,
      low_stock_active = true,
      status = 'running',
      run_id = _run,
      group_name = _name,
      group_id = CASE WHEN _state.low_stock_active THEN group_id ELSE NULL END,
      attempts = CASE WHEN _state.low_stock_active THEN attempts + 1 ELSE 1 END,
      observed_available = greatest(coalesce(_available,0),0),
      generated_count = CASE WHEN _state.low_stock_active THEN generated_count ELSE 0 END,
      imported_count = CASE WHEN _state.low_stock_active THEN imported_count ELSE 0 END,
      error = NULL,
      retry_after = NULL,
      opened_at = CASE WHEN _state.low_stock_active THEN opened_at ELSE _now END,
      completed_at = NULL
  WHERE ecosystem_id = _ecosystem_id AND product_id = _product_id;

  RETURN QUERY SELECT true, 'claimed'::text, _run, _event, _name;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_voucher_replenishment_event(uuid, uuid, uuid, integer, integer, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_voucher_replenishment_event(uuid, uuid, uuid, integer, integer, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_voucher_replenishment_event(
  _ecosystem_id uuid,
  _product_id uuid,
  _run_id uuid,
  _success boolean,
  _group_id text,
  _group_name text,
  _generated integer,
  _imported integer,
  _available_after integer,
  _batch_id uuid,
  _error text,
  _now timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_ecosystem_id::text || ':' || _product_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.voucher_replenishment_states
    WHERE ecosystem_id = _ecosystem_id AND product_id = _product_id AND run_id = _run_id
  ) THEN
    RETURN;
  END IF;

  UPDATE public.voucher_replenishment_runs
  SET status = CASE WHEN _success THEN 'completed' ELSE 'failed' END,
      generated_count = greatest(coalesce(_generated,0),0),
      imported_count = greatest(coalesce(_imported,0),0),
      batch_id = _batch_id,
      error = _error,
      finished_at = _now
  WHERE id = _run_id;

  UPDATE public.voucher_replenishment_states
  SET status = CASE WHEN _success THEN 'completed' ELSE 'paused' END,
      group_id = coalesce(_group_id, group_id),
      group_name = coalesce(_group_name, group_name),
      generated_count = greatest(generated_count, coalesce(_generated,0)),
      imported_count = greatest(imported_count, coalesce(_imported,0)),
      observed_available = greatest(coalesce(_available_after, observed_available),0),
      error = _error,
      retry_after = CASE WHEN _success THEN NULL WHEN attempts < 3 THEN _now + interval '6 hours' ELSE NULL END,
      completed_at = CASE WHEN _success THEN _now ELSE NULL END
  WHERE ecosystem_id = _ecosystem_id AND product_id = _product_id AND run_id = _run_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.finish_voucher_replenishment_event(uuid, uuid, uuid, boolean, text, text, integer, integer, integer, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_voucher_replenishment_event(uuid, uuid, uuid, boolean, text, text, integer, integer, integer, uuid, text, timestamptz) TO service_role;