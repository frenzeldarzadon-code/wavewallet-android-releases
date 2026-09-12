
-- 1. Recurrence metadata on the two manual entry stores -------------------
ALTER TABLE public.spending_income_entries
  ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_day smallint,
  ADD COLUMN IF NOT EXISTS recurrence_source_id uuid REFERENCES public.spending_income_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence_month text;

ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_day smallint,
  ADD COLUMN IF NOT EXISTS recurrence_source_id uuid REFERENCES public.business_expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence_month text;

-- One occurrence per (source, month) — makes generation idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS spending_income_recurrence_once
  ON public.spending_income_entries (recurrence_source_id, recurrence_month)
  WHERE recurrence_source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS business_expenses_recurrence_once
  ON public.business_expenses (recurrence_source_id, recurrence_month)
  WHERE recurrence_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS spending_income_recurring_idx
  ON public.spending_income_entries (recurring) WHERE recurring;
CREATE INDEX IF NOT EXISTS business_expenses_recurring_idx
  ON public.business_expenses (recurring) WHERE recurring;

-- 2. Turn recurrence on / off for an existing manual entry ----------------
CREATE OR REPLACE FUNCTION public.spending_set_recurring(_kind text, _id uuid, _on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := public.effective_uid();
  _eco uuid;
  _src uuid;
  _at timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  IF _kind = 'income' THEN
    SELECT ecosystem_id, recurrence_source_id, occurred_at
      INTO _eco, _src, _at
      FROM public.spending_income_entries WHERE id = _id;
  ELSIF _kind = 'expense' THEN
    SELECT ecosystem_id, recurrence_source_id, spent_at
      INTO _eco, _src, _at
      FROM public.business_expenses WHERE id = _id AND scope = 'ecosystem';
  ELSE
    RAISE EXCEPTION 'Unknown entry kind %', _kind;
  END IF;

  IF _eco IS NULL THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF NOT (public.is_super_admin(_uid) OR public.is_ecosystem_admin(_uid, _eco)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  -- A generated occurrence is never itself a recurrence source.
  IF _src IS NOT NULL THEN
    RAISE EXCEPTION 'This entry was created by a recurring record; change the original instead';
  END IF;

  IF _kind = 'income' THEN
    UPDATE public.spending_income_entries
       SET recurring = coalesce(_on, false),
           recurrence_day = CASE WHEN coalesce(_on, false)
                                 THEN extract(day FROM _at)::smallint ELSE NULL END,
           updated_at = now()
     WHERE id = _id;
  ELSE
    UPDATE public.business_expenses
       SET recurring = coalesce(_on, false),
           recurrence_day = CASE WHEN coalesce(_on, false)
                                 THEN extract(day FROM _at)::smallint ELSE NULL END,
           updated_at = now()
     WHERE id = _id;
  END IF;

  PERFORM public.log_operator_action(
    _uid, _eco,
    CASE WHEN coalesce(_on, false) THEN 'spending.recurring.enabled' ELSE 'spending.recurring.disabled' END,
    CASE WHEN _kind = 'income' THEN 'spending_income_entry' ELSE 'business_expense' END,
    _id, jsonb_build_object('kind', _kind)
  );
  RETURN coalesce(_on, false);
END;
$$;

REVOKE ALL ON FUNCTION public.spending_set_recurring(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spending_set_recurring(text, uuid, boolean) TO authenticated, service_role;

-- 3. Monthly occurrence generator ----------------------------------------
-- Reporting rows only: copies amount, description, category and shop context
-- from the source entry. Never touches wallets, ledgers or transactions.
CREATE OR REPLACE FUNCTION public.spending_generate_recurring(_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _src record;
  _month date;
  _limit date := date_trunc('month', _now)::date;
  _day int;
  _at timestamptz;
  _made int := 0;
BEGIN
  FOR _src IN
    SELECT id, ecosystem_id, amount, description, category_id, notes, occurred_at AS at,
           created_by, created_by_name, recurrence_day, 'income'::text AS kind, NULL::text AS category
      FROM public.spending_income_entries
     WHERE recurring AND recurrence_source_id IS NULL
    UNION ALL
    SELECT id, ecosystem_id, amount, description, category_id, notes, spent_at AS at,
           created_by, created_by_name, recurrence_day, 'expense'::text, category
      FROM public.business_expenses
     WHERE recurring AND recurrence_source_id IS NULL AND scope = 'ecosystem'
  LOOP
    _day := coalesce(_src.recurrence_day, extract(day FROM _src.at)::int);
    _month := (date_trunc('month', _src.at) + interval '1 month')::date;

    WHILE _month <= _limit LOOP
      -- Months that are too short fall back to their last calendar day.
      _at := (_month + (least(
                _day,
                extract(day FROM (_month + interval '1 month' - interval '1 day'))::int
              ) - 1) * interval '1 day')
             + (_src.at - date_trunc('day', _src.at));

      IF _src.kind = 'income' THEN
        INSERT INTO public.spending_income_entries
          (ecosystem_id, amount, description, category_id, notes, occurred_at,
           created_by, created_by_name, recurrence_source_id, recurrence_month)
        VALUES
          (_src.ecosystem_id, _src.amount, _src.description, _src.category_id, _src.notes, _at,
           _src.created_by, _src.created_by_name, _src.id, to_char(_month, 'YYYY-MM'))
        ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO public.business_expenses
          (scope, ecosystem_id, amount, description, category, category_id, notes, spent_at,
           created_by, created_by_name, recurrence_source_id, recurrence_month)
        VALUES
          ('ecosystem', _src.ecosystem_id, _src.amount, _src.description, _src.category,
           _src.category_id, _src.notes, _at,
           _src.created_by, _src.created_by_name, _src.id, to_char(_month, 'YYYY-MM'))
        ON CONFLICT DO NOTHING;
      END IF;

      IF FOUND THEN _made := _made + 1; END IF;
      _month := (_month + interval '1 month')::date;
    END LOOP;
  END LOOP;

  RETURN _made;
END;
$$;

REVOKE ALL ON FUNCTION public.spending_generate_recurring(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spending_generate_recurring(timestamptz) TO authenticated, service_role;
