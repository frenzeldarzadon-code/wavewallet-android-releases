ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'PHP';

CREATE UNIQUE INDEX IF NOT EXISTS business_expenses_provider_reference_key
  ON public.business_expenses (lower(provider), lower(provider_reference))
  WHERE provider IS NOT NULL AND provider_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_expense(
  _amount numeric,
  _description text,
  _scope text DEFAULT 'ecosystem'::text,
  _ecosystem_id uuid DEFAULT NULL::uuid,
  _category text DEFAULT NULL::text,
  _spent_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _provider text DEFAULT NULL::text,
  _provider_reference text DEFAULT NULL::text
)
 RETURNS business_expenses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.effective_uid();
  _eco uuid := _ecosystem_id;
  _name text;
  _row public.business_expenses;
  _prov text := nullif(btrim(coalesce(_provider, '')), '');
  _ref text := nullif(btrim(coalesce(_provider_reference, '')), '');
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF _description IS NULL OR length(btrim(_description)) = 0 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  IF _scope = 'platform' THEN
    IF NOT public.is_super_admin(_uid) THEN
      RAISE EXCEPTION 'Only the platform owner can record platform expenses';
    END IF;
    _eco := NULL;
  ELSIF _scope = 'ecosystem' THEN
    IF _eco IS NULL THEN
      SELECT ecosystem_id INTO _eco FROM public.profiles WHERE id = _uid;
    END IF;
    IF _eco IS NULL THEN
      RAISE EXCEPTION 'No shop selected for this expense';
    END IF;
    IF NOT public.is_ecosystem_admin(_uid, _eco) THEN
      RAISE EXCEPTION 'You can only record expenses for your own shop';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown expense scope %', _scope;
  END IF;

  IF _prov IS NOT NULL AND _ref IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.business_expenses
      WHERE lower(provider) = lower(_prov) AND lower(provider_reference) = lower(_ref)
    ) THEN
      RAISE EXCEPTION 'This % purchase reference is already recorded', _prov;
    END IF;
  END IF;

  INSERT INTO public.business_expenses
    (scope, ecosystem_id, amount, description, category, created_by, created_by_name, spent_at,
     provider, provider_reference, currency)
  VALUES
    (_scope, _eco, round(_amount, 2), btrim(_description), nullif(btrim(coalesce(_category, '')), ''),
     _uid, _name, coalesce(_spent_at, now()), _prov, _ref, 'PHP')
  RETURNING * INTO _row;

  PERFORM public.log_operator_action(
    _uid, _eco, 'expense.recorded', 'business_expense', _row.id,
    jsonb_build_object('amount', _row.amount, 'description', _row.description, 'scope', _scope,
                       'category', _row.category, 'provider', _row.provider,
                       'provider_reference', _row.provider_reference, 'currency', _row.currency)
  );

  RETURN _row;
END;
$function$;