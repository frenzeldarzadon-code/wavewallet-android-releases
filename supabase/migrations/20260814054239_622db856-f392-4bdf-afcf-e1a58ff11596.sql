
CREATE TABLE public.business_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('ecosystem','platform')),
  ecosystem_id uuid REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  category text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_name text,
  spent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_expenses_scope_eco CHECK (
    (scope = 'ecosystem' AND ecosystem_id IS NOT NULL)
    OR (scope = 'platform' AND ecosystem_id IS NULL)
  )
);

CREATE INDEX business_expenses_eco_idx ON public.business_expenses (ecosystem_id, spent_at DESC);
CREATE INDEX business_expenses_scope_idx ON public.business_expenses (scope, spent_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_expenses TO authenticated;
GRANT ALL ON public.business_expenses TO service_role;

ALTER TABLE public.business_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_select" ON public.business_expenses
FOR SELECT TO authenticated
USING (
  public.is_super_admin(public.effective_uid())
  OR (scope = 'ecosystem' AND public.is_ecosystem_admin(public.effective_uid(), ecosystem_id))
);

CREATE POLICY "expenses_insert" ON public.business_expenses
FOR INSERT TO authenticated
WITH CHECK (
  created_by = public.effective_uid()
  AND (
    (scope = 'platform' AND public.is_super_admin(public.effective_uid()))
    OR (scope = 'ecosystem' AND public.is_ecosystem_admin(public.effective_uid(), ecosystem_id))
  )
);

CREATE POLICY "expenses_update" ON public.business_expenses
FOR UPDATE TO authenticated
USING (
  (scope = 'platform' AND public.is_super_admin(public.effective_uid()))
  OR (scope = 'ecosystem' AND public.is_ecosystem_admin(public.effective_uid(), ecosystem_id))
)
WITH CHECK (
  (scope = 'platform' AND public.is_super_admin(public.effective_uid()))
  OR (scope = 'ecosystem' AND public.is_ecosystem_admin(public.effective_uid(), ecosystem_id))
);

CREATE POLICY "expenses_delete" ON public.business_expenses
FOR DELETE TO authenticated
USING (
  (scope = 'platform' AND public.is_super_admin(public.effective_uid()))
  OR (scope = 'ecosystem' AND public.is_ecosystem_admin(public.effective_uid(), ecosystem_id))
);

CREATE TRIGGER business_expenses_updated_at
BEFORE UPDATE ON public.business_expenses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.record_expense(
  _amount numeric,
  _description text,
  _scope text DEFAULT 'ecosystem',
  _ecosystem_id uuid DEFAULT NULL,
  _category text DEFAULT NULL,
  _spent_at timestamptz DEFAULT NULL
)
RETURNS public.business_expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := public.effective_uid();
  _eco uuid := _ecosystem_id;
  _name text;
  _row public.business_expenses;
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

  INSERT INTO public.business_expenses
    (scope, ecosystem_id, amount, description, category, created_by, created_by_name, spent_at)
  VALUES
    (_scope, _eco, round(_amount, 2), btrim(_description), nullif(btrim(coalesce(_category, '')), ''),
     _uid, _name, coalesce(_spent_at, now()))
  RETURNING * INTO _row;

  PERFORM public.log_operator_action(
    _uid, _eco, 'expense.recorded', 'business_expense', _row.id,
    jsonb_build_object('amount', _row.amount, 'description', _row.description, 'scope', _scope,
                       'category', _row.category)
  );

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_expense(numeric, text, text, uuid, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.record_expense(numeric, text, text, uuid, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_expense(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := public.effective_uid();
  _row public.business_expenses;
BEGIN
  SELECT * INTO _row FROM public.business_expenses WHERE id = _id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF _row.scope = 'platform' THEN
    IF NOT public.is_super_admin(_uid) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
  ELSIF NOT public.is_ecosystem_admin(_uid, _row.ecosystem_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  DELETE FROM public.business_expenses WHERE id = _id;

  PERFORM public.log_operator_action(
    _uid, _row.ecosystem_id, 'expense.deleted', 'business_expense', _row.id,
    jsonb_build_object('amount', _row.amount, 'description', _row.description, 'scope', _row.scope)
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;
