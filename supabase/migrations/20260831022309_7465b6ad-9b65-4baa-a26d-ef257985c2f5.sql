CREATE TABLE public.voucher_replenishment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.voucher_products(id) ON DELETE CASCADE,
  calibration_id uuid REFERENCES public.omada_voucher_calibrations(id) ON DELETE SET NULL,
  calibration_version integer,
  status text NOT NULL DEFAULT 'running',
  trigger_source text NOT NULL DEFAULT 'sweep',
  available_before integer NOT NULL DEFAULT 0,
  requested_count integer NOT NULL DEFAULT 0,
  generated_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  batch_id uuid REFERENCES public.omada_voucher_batches(id) ON DELETE SET NULL,
  error text,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.voucher_replenishment_runs TO authenticated;
GRANT ALL ON public.voucher_replenishment_runs TO service_role;

ALTER TABLE public.voucher_replenishment_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop admins read their replenishment runs"
ON public.voucher_replenishment_runs
FOR SELECT
TO authenticated
USING (public.is_ecosystem_admin(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()));

CREATE UNIQUE INDEX voucher_replenishment_active_uniq
ON public.voucher_replenishment_runs (ecosystem_id, product_id)
WHERE status IN ('queued', 'running');

CREATE INDEX voucher_replenishment_recent_idx
ON public.voucher_replenishment_runs (ecosystem_id, product_id, created_at DESC);

CREATE TRIGGER update_voucher_replenishment_runs_updated_at
BEFORE UPDATE ON public.voucher_replenishment_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.system_import_voucher_codes(
  _ecosystem_id uuid,
  _product_id uuid,
  _codes text[],
  _source text DEFAULT 'omada-auto'
)
RETURNS TABLE(batch_id uuid, imported_count integer, duplicate_count integer, invalid_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _batch uuid; _total int := coalesce(array_length(_codes,1),0);
        _imported int := 0; _dupes int := 0; _invalid int := 0; _c text; _clean text;
        _seen text[] := '{}'; _pname text;
begin
  select ecosystem_id, name into _eco, _pname from public.voucher_products where id = _product_id;
  if _eco is null then raise exception 'Product not found'; end if;
  if _eco <> _ecosystem_id then raise exception 'Product does not belong to this shop'; end if;

  insert into public.voucher_imports (ecosystem_id, product_id, actor_id, actor_name, source, total_rows)
  values (_eco, _product_id, null, 'Automatic replenishment', coalesce(_source,'omada-auto'), _total)
  returning id into _batch;

  foreach _c in array coalesce(_codes, '{}'::text[]) loop
    _clean := trim(coalesce(_c,''));
    if _clean = '' or length(_clean) < 3 or length(_clean) > 64 then
      _invalid := _invalid + 1;
    elsif upper(_clean) = any(_seen) then
      _dupes := _dupes + 1;
    else
      _seen := array_append(_seen, upper(_clean));
      begin
        insert into public.voucher_codes (ecosystem_id, product_id, code, import_id)
        values (_eco, _product_id, _clean, _batch);
        _imported := _imported + 1;
      exception when unique_violation then
        _dupes := _dupes + 1;
      end;
    end if;
  end loop;

  update public.voucher_imports
     set imported_count = _imported, duplicate_count = _dupes, invalid_count = _invalid
   where id = _batch;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, null, 'Automatic replenishment', 'Imported voucher codes', coalesce(_pname,''),
          jsonb_build_object('imported', _imported, 'duplicates', _dupes, 'invalid', _invalid, 'batch', _batch, 'auto', true));

  return query select _batch, _imported, _dupes, _invalid;
end; $function$;

REVOKE ALL ON FUNCTION public.system_import_voucher_codes(uuid, uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_import_voucher_codes(uuid, uuid, text[], text) TO service_role;