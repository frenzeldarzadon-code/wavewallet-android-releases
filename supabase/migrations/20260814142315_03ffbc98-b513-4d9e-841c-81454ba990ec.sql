DO $$
DECLARE
  r record;
  anon_allowed text[] := ARRAY[
    'get_signup_ecosystem','list_signup_ecosystems','list_public_shops',
    'public_shop_overview','public_shop_products','public_shop_reviews',
    'public_support_contact','ecosystem_has_admin','real_super_admin_exists'
  ];
  internal_only text[] := ARRAY[
    'apply_credit_entry','apply_points_entry','apply_social_credit_entry',
    'countable_members','ensure_credit_account','ensure_global_wallet',
    'ensure_membership_wallets','expire_stale_member_invitations',
    'log_operator_action','notify_member','notify_universe','notify_handle_mentions',
    'assign_profile_handle','run_retention_purge','reset_ecosystem_test_data',
    'claim_super_admin_bootstrap','release_super_admin_bootstrap'
  ];
  sig text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           p.prorettype = 'pg_catalog.trigger'::regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    sig := format('public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));

    -- Default deny: nobody outside the platform roles may call it.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);

    IF r.is_trigger OR r.proname = ANY (internal_only) THEN
      CONTINUE; -- runs only inside the database / service role
    END IF;

    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);

    IF r.proname = ANY (anon_allowed) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', sig);
    END IF;
  END LOOP;
END $$;