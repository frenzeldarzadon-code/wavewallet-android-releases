
-- Role rows became unique per (user, shop, role) when shops were made
-- independent, but four functions still declared the old global
-- (user_id, role) conflict target, which now matches no constraint and
-- aborts shop switching with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". Rewrite the conflict target in place so each function keeps
-- its behaviour and simply upserts against the real key.
DO $$
DECLARE _def text; _new text; _oid oid;
BEGIN
  FOR _oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~* 'on conflict \(\s*user_id\s*,\s*role\s*\)'
  LOOP
    _def := pg_get_functiondef(_oid);
    _new := regexp_replace(_def, 'on conflict \(\s*user_id\s*,\s*role\s*\)',
                           'on conflict (user_id, ecosystem_id, role)', 'gi');
    IF _new <> _def THEN EXECUTE _new; END IF;
  END LOOP;
END $$;

-- Guard against the same class of bug returning: every wallet/membership
-- upsert target below must exist as a real unique key.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'ecosystem_memberships_user_id_ecosystem_id_key'
  ) THEN
    RAISE EXCEPTION 'ecosystem_memberships is missing its (user_id, ecosystem_id) unique key';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_ecosystem_role_key'
  ) THEN
    RAISE EXCEPTION 'user_roles is missing its (user_id, ecosystem_id, role) unique key';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'credit_accounts_user_eco_key'
  ) THEN
    RAISE EXCEPTION 'credit_accounts is missing its per-shop unique key';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'points_accounts_user_eco_key'
  ) THEN
    RAISE EXCEPTION 'points_accounts is missing its per-shop unique key';
  END IF;
END $$;
