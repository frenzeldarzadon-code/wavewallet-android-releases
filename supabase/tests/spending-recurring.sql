-- Monthly recurrence for manual Spending Tracker entries.
-- Reporting rows only: no wallet, coin ledger or transaction is involved.
-- Run inside a transaction and ROLL BACK — no real data is changed.
BEGIN;

DO $$
DECLARE
  _eco uuid;
  _admin uuid;
  _src uuid;
  _exp uuid;
  _made int;
  _again int;
  _days int[];
BEGIN
  SELECT id INTO _eco FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _admin FROM auth.users LIMIT 1;
  IF _eco IS NULL OR _admin IS NULL THEN RAISE NOTICE 'no fixture data'; RETURN; END IF;

  -- Source income entry on the 31st, six months ago.
  INSERT INTO public.spending_income_entries
    (ecosystem_id, amount, description, occurred_at, created_by, recurring, recurrence_day)
  VALUES
    (_eco, 100, 'TEST recurring income',
     date_trunc('month', now()) - interval '6 months' + interval '30 days',
     _admin, true, 31)
  RETURNING id INTO _src;

  INSERT INTO public.business_expenses
    (scope, ecosystem_id, amount, description, spent_at, created_by, recurring, recurrence_day)
  VALUES
    ('ecosystem', _eco, 50, 'TEST recurring expense',
     date_trunc('month', now()) - interval '2 months' + interval '14 days',
     _admin, true, 15)
  RETURNING id INTO _exp;

  _made := public.spending_generate_recurring();
  ASSERT _made > 0, 'generator produced nothing';

  -- Running again must not create a single extra occurrence.
  _again := public.spending_generate_recurring();
  ASSERT _again = 0, format('second run created %s duplicates', _again);

  -- One occurrence per later month, never the source month itself.
  ASSERT (SELECT count(*) FROM public.spending_income_entries WHERE recurrence_source_id = _src) = 6,
    'income occurrences should be one per later month';
  ASSERT (SELECT count(DISTINCT recurrence_month) FROM public.spending_income_entries
           WHERE recurrence_source_id = _src) = 6, 'duplicate month found';
  ASSERT (SELECT count(*) FROM public.business_expenses WHERE recurrence_source_id = _exp) = 2,
    'expense occurrences wrong';

  -- Short months fall back to their last day rather than skipping.
  SELECT array_agg(extract(day FROM occurred_at)::int ORDER BY occurred_at)
    INTO _days FROM public.spending_income_entries WHERE recurrence_source_id = _src;
  ASSERT NOT (0 = ANY(_days)), 'bad day';
  ASSERT (SELECT bool_and(occurred_at = date_trunc('month', occurred_at) + interval '1 month' - interval '1 day'
                          OR extract(day FROM occurred_at) = 31)
            FROM public.spending_income_entries WHERE recurrence_source_id = _src),
    'short months must use their last calendar day';

  -- Amount, description, category and shop context are carried over.
  ASSERT (SELECT bool_and(amount = 100 AND description = 'TEST recurring income' AND ecosystem_id = _eco)
            FROM public.spending_income_entries WHERE recurrence_source_id = _src), 'copy mismatch';

  -- Occurrences are not themselves recurrence sources.
  ASSERT (SELECT bool_and(NOT recurring) FROM public.spending_income_entries
            WHERE recurrence_source_id = _src), 'occurrence must not recur';

  -- Switching recurrence off stops future months, keeps what exists.
  UPDATE public.spending_income_entries SET recurring = false WHERE id = _src;
  DELETE FROM public.spending_income_entries
   WHERE recurrence_source_id = _src
     AND recurrence_month = to_char(date_trunc('month', now()), 'YYYY-MM');
  ASSERT public.spending_generate_recurring() = 0, 'disabled entry still generated';
  ASSERT (SELECT count(*) FROM public.spending_income_entries WHERE recurrence_source_id = _src) = 5,
    'past occurrences must be kept';

  RAISE NOTICE 'spending recurrence checks passed';
END $$;

ROLLBACK;
