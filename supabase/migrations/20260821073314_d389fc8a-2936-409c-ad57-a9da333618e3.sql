-- Fractional points: numeric(14,2) precision and points earned from actual coins spent.
DO $mig$
DECLARE r record; d text;
BEGIN
  CREATE TEMP TABLE _pt_defs ON COMMIT DROP AS
  SELECT p.proname::text AS name, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'ecosystem_dashboard','platform_unassigned_users','platform_user_deletion_check',
    'search_members','super_list_members','super_member_accounts','customer_deletion_check',
    'role_restructure_check','purchase_voucher','refund_voucher_sale','apply_points_entry');

  FOR r IN
    SELECT * FROM (VALUES
      ('ecosystem_dashboard','points_outstanding bigint','points_outstanding numeric'),
      ('ecosystem_dashboard','coalesce(sum(a.balance),0)::bigint','coalesce(sum(a.balance),0)::numeric'),
      ('platform_unassigned_users','points_total integer','points_total numeric'),
      ('platform_unassigned_users','from public.points_accounts pt where pt.user_id = p.id), 0)::integer','from public.points_accounts pt where pt.user_id = p.id), 0)::numeric'),
      ('platform_user_deletion_check','points_total integer','points_total numeric'),
      ('platform_user_deletion_check','_points integer := 0','_points numeric := 0'),
      ('platform_user_deletion_check','false, 0::numeric, 0::integer, 0::integer','false, 0::numeric, 0::numeric, 0::integer'),
      ('platform_user_deletion_check','COALESCE(sum(p.balance + p.held), 0)::integer','COALESCE(sum(p.balance + p.held), 0)::numeric'),
      ('search_members','points_balance integer','points_balance numeric'),
      ('search_members','coalesce(pa.balance, 0)::integer','coalesce(pa.balance, 0)::numeric'),
      ('super_list_members','points_balance integer','points_balance numeric'),
      ('super_list_members','from public.points_accounts pa where pa.user_id = p.id), 0)::integer','from public.points_accounts pa where pa.user_id = p.id), 0)::numeric'),
      ('super_member_accounts','points_balance integer','points_balance numeric'),
      ('super_member_accounts','where pa.user_id = _user and pa.ecosystem_id = m.ecosystem_id), 0)::integer','where pa.user_id = _user and pa.ecosystem_id = m.ecosystem_id), 0)::numeric'),
      ('customer_deletion_check','_points integer;','_points numeric;'),
      ('customer_deletion_check','_held integer;','_held numeric;'),
      ('role_restructure_check','_points integer := 0','_points numeric := 0'),
      ('role_restructure_check','_held integer := 0','_held numeric := 0'),
      ('purchase_voucher','points_earned integer','points_earned numeric'),
      ('purchase_voucher','_earn integer := 0','_earn numeric(14,2) := 0'),
      ('purchase_voucher','floor(_total / _ratio)::int','round(_total / _ratio, 2)'),
      ('refund_voucher_sale','points_refunded integer, points_reversed integer','points_refunded numeric, points_reversed numeric'),
      ('refund_voucher_sale','_points_back integer := 0','_points_back numeric := 0'),
      ('refund_voucher_sale','_points_rev integer := 0','_points_rev numeric := 0'),
      ('apply_points_entry','declare _bal integer; _held integer;','declare _bal numeric; _held numeric;')
    ) AS t(name, needle, repl)
  LOOP
    SELECT def INTO d FROM _pt_defs WHERE name = r.name;
    IF d IS NULL OR position(r.needle in d) = 0 THEN
      RAISE EXCEPTION 'pattern not found in %: %', r.name, r.needle;
    END IF;
    UPDATE _pt_defs SET def = replace(def, r.needle, r.repl) WHERE name = r.name;
  END LOOP;

  ALTER TABLE public.points_accounts
    ALTER COLUMN balance TYPE numeric(14,2),
    ALTER COLUMN held TYPE numeric(14,2);
  ALTER TABLE public.points_ledger
    ALTER COLUMN amount TYPE numeric(14,2),
    ALTER COLUMN balance_after TYPE numeric(14,2);
  ALTER TABLE public.voucher_sales
    ALTER COLUMN points_earned TYPE numeric(14,2);

  DROP FUNCTION IF EXISTS public.ecosystem_dashboard(uuid);
  DROP FUNCTION IF EXISTS public.platform_unassigned_users(text);
  DROP FUNCTION IF EXISTS public.platform_user_deletion_check(uuid, boolean);
  DROP FUNCTION IF EXISTS public.search_members(text, uuid);
  DROP FUNCTION IF EXISTS public.super_list_members(text, uuid, text, integer, integer);
  DROP FUNCTION IF EXISTS public.super_member_accounts(uuid);
  DROP FUNCTION IF EXISTS public.purchase_voucher(uuid, integer);
  DROP FUNCTION IF EXISTS public.refund_voucher_sale(uuid, text);

  FOR r IN SELECT def FROM _pt_defs LOOP EXECUTE r.def; END LOOP;
END $mig$;