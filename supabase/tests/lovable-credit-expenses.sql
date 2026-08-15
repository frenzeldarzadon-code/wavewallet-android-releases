-- Lovable AI credit purchases recorded as platform business expenses.
--
-- Replace the ids below with real rows, then run:
--   BEGIN; \i supabase/tests/lovable-credit-expenses.sql ROLLBACK;
--
-- Proves:
--   * the platform owner can record a PHP Lovable credit purchase
--   * provider, reference and PHP currency are stored on the row
--   * the same provider reference cannot be recorded twice
--   * a shop admin (non super admin) cannot record a platform expense
--   * a shop admin cannot delete a platform expense
--   * the entry is included in the platform expense total
--   * an operator audit entry is written

BEGIN;

DO $$
DECLARE
  _super uuid := '00000000-0000-0000-0000-000000000001'; -- platform owner
  _admin uuid := '00000000-0000-0000-0000-000000000003'; -- any shop admin
  _row public.business_expenses;
  _ref text := 'LOVABLE-' || gen_random_uuid()::text;
  _total_before numeric; _total_after numeric;
  _audit int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);

  SELECT coalesce(sum(amount), 0) INTO _total_before
  FROM public.business_expenses WHERE scope = 'platform';

  _row := public.record_expense(
    _amount := 2500.50,
    _description := 'Lovable credit purchase · ref ' || _ref,
    _scope := 'platform',
    _category := 'Lovable AI Credits',
    _spent_at := now(),
    _provider := 'Lovable',
    _provider_reference := _ref
  );

  IF _row.amount <> 2500.50 THEN
    RAISE EXCEPTION 'PHP amount not stored exactly: %', _row.amount;
  END IF;
  IF _row.currency <> 'PHP' THEN
    RAISE EXCEPTION 'Expense currency must be PHP, got %', _row.currency;
  END IF;
  IF _row.provider <> 'Lovable' OR _row.provider_reference <> _ref THEN
    RAISE EXCEPTION 'Provider details not stored';
  END IF;
  IF _row.category <> 'Lovable AI Credits' THEN
    RAISE EXCEPTION 'Category not stored';
  END IF;
  IF _row.scope <> 'platform' OR _row.ecosystem_id IS NOT NULL THEN
    RAISE EXCEPTION 'Lovable expense must be platform scoped';
  END IF;

  -- Duplicate prevention on the provider reference.
  BEGIN
    PERFORM public.record_expense(
      _amount := 2500.50,
      _description := 'Duplicate attempt',
      _scope := 'platform',
      _category := 'Lovable AI Credits',
      _provider := 'lovable',
      _provider_reference := lower(_ref)
    );
    RAISE EXCEPTION 'Duplicate provider reference was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm = 'Duplicate provider reference was accepted' THEN RAISE; END IF;
  END;

  -- Included in the platform expense total.
  SELECT coalesce(sum(amount), 0) INTO _total_after
  FROM public.business_expenses WHERE scope = 'platform';
  IF round(_total_after - _total_before, 2) <> 2500.50 THEN
    RAISE EXCEPTION 'Lovable expense missing from platform totals (delta %)',
      _total_after - _total_before;
  END IF;

  -- Audit trail.
  SELECT count(*) INTO _audit FROM public.audit_logs
  WHERE target_id = _row.id AND action = 'expense.recorded';
  IF _audit < 1 THEN
    RAISE EXCEPTION 'No operator audit entry for the Lovable expense';
  END IF;

  -- Super Admin only: a shop admin may neither create nor delete platform expenses.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  BEGIN
    PERFORM public.record_expense(
      _amount := 100,
      _description := 'Not allowed',
      _scope := 'platform',
      _category := 'Lovable AI Credits',
      _provider := 'Lovable',
      _provider_reference := 'X-' || gen_random_uuid()::text
    );
    RAISE EXCEPTION 'Non super admin recorded a platform expense';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm = 'Non super admin recorded a platform expense' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.delete_expense(_row.id);
    RAISE EXCEPTION 'Non super admin deleted a platform expense';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm = 'Non super admin deleted a platform expense' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'Lovable credit expense tests passed';
END $$;

ROLLBACK;
