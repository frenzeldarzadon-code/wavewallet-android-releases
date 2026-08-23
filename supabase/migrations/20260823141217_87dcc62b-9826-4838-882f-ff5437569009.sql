DO $$
DECLARE _sig text; _name text;
BEGIN
  FOR _sig, _name IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname LIKE 'spending\_%'          -- shop-admin only
        OR p.proname LIKE 'tg\_%'             -- trigger functions: never called directly
        OR p.proname IN (
          'validate_membership_parent','notify_financial','notify_financial_safe',
          'payment_reference_hash','payment_reference_used_elsewhere','remember_payment_reference',
          'reconcile_listener_events','listener_receiving_number_matches','listener_serves_destination',
          'listener_source_allowed','payment_provider_for','cash_in_conflict_snapshot',
          'cash_in_receiving_number','auto_process_membership_application','subscription_is_free'
        )
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', _sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', _sig);
    -- Triggers fire regardless of grants; direct callers stay signed-in only.
    IF _name NOT LIKE 'tg\_%' AND _name <> 'validate_membership_parent' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _sig);
  END LOOP;
END $$;