alter table public.spending_income_entries add column if not exists client_ref uuid;
alter table public.business_expenses add column if not exists client_ref uuid;

create unique index if not exists spending_income_entries_client_ref_key
  on public.spending_income_entries (client_ref) where client_ref is not null;
create unique index if not exists business_expenses_client_ref_key
  on public.business_expenses (client_ref) where client_ref is not null;

drop function if exists public.spending_record_income(uuid, numeric, text, uuid, timestamptz, text);
create or replace function public.spending_record_income(
  _ecosystem uuid,
  _amount numeric,
  _description text,
  _category_id uuid default null,
  _occurred_at timestamptz default null,
  _notes text default null,
  _client_ref uuid default null
) returns public.spending_income_entries
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  _uid uuid := public.effective_uid();
  _row public.spending_income_entries;
  _name text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT (public.is_super_admin(_uid) OR public.is_ecosystem_admin(_uid, _ecosystem)) THEN
    RAISE EXCEPTION 'You can only record income for your own shop';
  END IF;

  -- Offline replay: the same client-generated id never creates a second entry.
  IF _client_ref IS NOT NULL THEN
    SELECT * INTO _row FROM public.spending_income_entries WHERE client_ref = _client_ref;
    IF FOUND THEN RETURN _row; END IF;
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF btrim(coalesce(_description, '')) = '' THEN RAISE EXCEPTION 'Description is required'; END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.spending_categories c
    WHERE c.id = _category_id AND c.ecosystem_id = _ecosystem AND c.kind = 'income'
  ) THEN
    RAISE EXCEPTION 'Unknown income category for this shop';
  END IF;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.spending_income_entries
    (ecosystem_id, amount, description, category_id, notes, occurred_at, created_by, created_by_name, client_ref)
  VALUES
    (_ecosystem, round(_amount, 2), btrim(_description), _category_id,
     nullif(btrim(coalesce(_notes, '')), ''), coalesce(_occurred_at, now()), _uid, _name, _client_ref)
  ON CONFLICT (client_ref) WHERE client_ref IS NOT NULL DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL AND _client_ref IS NOT NULL THEN
    SELECT * INTO _row FROM public.spending_income_entries WHERE client_ref = _client_ref;
    RETURN _row;
  END IF;

  PERFORM public.log_operator_action(
    _uid, _ecosystem, 'spending.income.recorded', 'spending_income_entry', _row.id,
    jsonb_build_object('amount', _row.amount, 'description', _row.description)
  );
  RETURN _row;
END;
$$;

drop function if exists public.spending_record_expense(uuid, numeric, text, uuid, timestamptz, text);
create or replace function public.spending_record_expense(
  _ecosystem uuid,
  _amount numeric,
  _description text,
  _category_id uuid default null,
  _spent_at timestamptz default null,
  _notes text default null,
  _client_ref uuid default null
) returns public.business_expenses
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  _row public.business_expenses;
  _cat text;
BEGIN
  IF _client_ref IS NOT NULL THEN
    SELECT * INTO _row FROM public.business_expenses WHERE client_ref = _client_ref;
    IF FOUND THEN RETURN _row; END IF;
  END IF;

  IF _category_id IS NOT NULL THEN
    SELECT c.name INTO _cat FROM public.spending_categories c
    WHERE c.id = _category_id AND c.ecosystem_id = _ecosystem AND c.kind = 'expense';
    IF _cat IS NULL THEN RAISE EXCEPTION 'Unknown expense category for this shop'; END IF;
  END IF;

  _row := public.record_expense(_amount, _description, 'ecosystem', _ecosystem, _cat, _spent_at);

  UPDATE public.business_expenses SET
    category_id = _category_id,
    notes = nullif(btrim(coalesce(_notes, '')), ''),
    client_ref = _client_ref
  WHERE id = _row.id
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

grant execute on function public.spending_record_income(uuid, numeric, text, uuid, timestamptz, text, uuid) to authenticated;
grant execute on function public.spending_record_expense(uuid, numeric, text, uuid, timestamptz, text, uuid) to authenticated;