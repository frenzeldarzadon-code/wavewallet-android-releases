-- Spending Tracker (Admin reporting/analytics layer).
--
-- Pure reporting. Nothing here touches wallets, the credit ledger, cashback
-- computation, discounts or purchases. Automatic figures are DERIVED from the
-- existing source of truth (`earnings_history` for admin-earned cashback and
-- `voucher_sales` for admin purchases/discounts). Manual expenses reuse the
-- existing `business_expenses` store so shop expenses are never duplicated;
-- only manual INCOME gets a new table, because none existed.

CREATE TABLE IF NOT EXISTS public.spending_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  name text NOT NULL,
  auto_key text,
  member_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS spending_categories_auto_key
  ON public.spending_categories (ecosystem_id, kind, auto_key)
  WHERE auto_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS spending_categories_manual_name
  ON public.spending_categories (ecosystem_id, kind, lower(name))
  WHERE auto_key IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spending_categories TO authenticated;
GRANT ALL ON public.spending_categories TO service_role;
ALTER TABLE public.spending_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Shop admins manage their spending categories" ON public.spending_categories;
CREATE POLICY "Shop admins manage their spending categories"
ON public.spending_categories FOR ALL TO authenticated
USING (
  public.is_super_admin(public.effective_uid())
  OR public.is_ecosystem_admin(public.effective_uid(), ecosystem_id)
)
WITH CHECK (
  public.is_super_admin(public.effective_uid())
  OR public.is_ecosystem_admin(public.effective_uid(), ecosystem_id)
);

CREATE OR REPLACE FUNCTION public.spending_category_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.auto_key IS NOT NULL THEN
      NEW.auto_key := OLD.auto_key;
      NEW.member_id := OLD.member_id;
      NEW.kind := OLD.kind;
      NEW.ecosystem_id := OLD.ecosystem_id;
    END IF;
    NEW.updated_at := now();
  END IF;
  IF btrim(coalesce(NEW.name, '')) = '' THEN
    RAISE EXCEPTION 'Category name is required';
  END IF;
  NEW.name := btrim(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spending_category_guard ON public.spending_categories;
CREATE TRIGGER spending_category_guard
BEFORE INSERT OR UPDATE ON public.spending_categories
FOR EACH ROW EXECUTE FUNCTION public.spending_category_guard();

CREATE OR REPLACE FUNCTION public.spending_category_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.auto_key IS NOT NULL THEN
    RAISE EXCEPTION 'Automatic categories cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS spending_category_delete_guard ON public.spending_categories;
CREATE TRIGGER spending_category_delete_guard
BEFORE DELETE ON public.spending_categories
FOR EACH ROW EXECUTE FUNCTION public.spending_category_delete_guard();

ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.spending_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS public.spending_income_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  category_id uuid REFERENCES public.spending_categories(id) ON DELETE SET NULL,
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spending_income_entries_eco_at
  ON public.spending_income_entries (ecosystem_id, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spending_income_entries TO authenticated;
GRANT ALL ON public.spending_income_entries TO service_role;
ALTER TABLE public.spending_income_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Shop admins manage their manual income" ON public.spending_income_entries;
CREATE POLICY "Shop admins manage their manual income"
ON public.spending_income_entries FOR ALL TO authenticated
USING (
  public.is_super_admin(public.effective_uid())
  OR public.is_ecosystem_admin(public.effective_uid(), ecosystem_id)
)
WITH CHECK (
  public.is_super_admin(public.effective_uid())
  OR public.is_ecosystem_admin(public.effective_uid(), ecosystem_id)
);

CREATE OR REPLACE FUNCTION public.spending_sync_categories(_ecosystem uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := public.effective_uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT (public.is_super_admin(_uid) OR public.is_ecosystem_admin(_uid, _ecosystem)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  INSERT INTO public.spending_categories (ecosystem_id, kind, name, auto_key)
  VALUES
    (_ecosystem, 'income', 'Admin Discount', 'admin_discount'),
    (_ecosystem, 'income', 'Direct sales', 'direct'),
    (_ecosystem, 'expense', 'Admin Purchases', 'admin_purchases')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.spending_categories (ecosystem_id, kind, name, auto_key, member_id)
  SELECT _ecosystem, k.kind, coalesce(p.full_name, 'Reseller'), 'reseller:' || p.id::text, p.id
  FROM (
    SELECT DISTINCT m.user_id AS id
    FROM public.ecosystem_memberships m
    WHERE m.ecosystem_id = _ecosystem
      AND m.role IN ('reseller', 'subreseller')
      AND m.reseller_id IS NULL
    UNION
    SELECT pr.id
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.id
    WHERE pr.ecosystem_id = _ecosystem
      AND ur.role IN ('reseller', 'subreseller')
      AND pr.reseller_id IS NULL
  ) AS r
  JOIN public.profiles p ON p.id = r.id
  CROSS JOIN (VALUES ('income'), ('expense')) AS k(kind)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.spending_auto_entries(
  _ecosystem uuid,
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE(
  id text,
  kind text,
  occurred_at timestamptz,
  description text,
  amount numeric,
  auto_key text,
  member_id uuid,
  member_name text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := public.effective_uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT (public.is_super_admin(_uid) OR public.is_ecosystem_admin(_uid, _ecosystem)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  RETURN QUERY
  WITH RECURSIVE mem AS (
    SELECT
      p.id AS user_id,
      COALESCE(m.reseller_id, p.reseller_id) AS reseller_id,
      COALESCE(m.role::text, (
        SELECT ur.role::text FROM public.user_roles ur
        WHERE ur.user_id = p.id
          AND COALESCE(ur.ecosystem_id, p.ecosystem_id) = _ecosystem
        LIMIT 1
      ), 'customer') AS role,
      p.full_name
    FROM public.profiles p
    LEFT JOIN public.ecosystem_memberships m
      ON m.user_id = p.id AND m.ecosystem_id = _ecosystem
    WHERE m.id IS NOT NULL OR p.ecosystem_id = _ecosystem
  ),
  climb AS (
    SELECT mm.user_id AS leaf, mm.user_id AS node, mm.reseller_id AS parent,
           mm.role, mm.full_name, 0 AS depth
    FROM mem mm
    UNION ALL
    SELECT c.leaf, pm.user_id, pm.reseller_id, pm.role, pm.full_name, c.depth + 1
    FROM climb c
    JOIN mem pm ON pm.user_id = c.parent
    WHERE c.depth < 12
  ),
  root AS (
    SELECT DISTINCT ON (c.leaf) c.leaf, c.node, c.role, c.full_name
    FROM climb c
    WHERE c.parent IS NULL
    ORDER BY c.leaf, c.depth DESC
  ),
  admins AS (
    SELECT DISTINCT x.id FROM (
      SELECT m.user_id AS id
      FROM public.ecosystem_memberships m
      WHERE m.ecosystem_id = _ecosystem AND m.role = 'admin'
      UNION
      SELECT pr.id
      FROM public.profiles pr
      JOIN public.user_roles ur ON ur.user_id = pr.id AND ur.role = 'admin'
      WHERE COALESCE(ur.ecosystem_id, pr.ecosystem_id) = _ecosystem
    ) x
  )
  SELECT
    'cb:' || e.id,
    'income',
    e.occurred_at,
    COALESCE(e.product_name, 'Sale') ||
      CASE WHEN e.counterparty_name IS NOT NULL THEN ' - ' || e.counterparty_name ELSE '' END,
    e.earning_amount,
    CASE
      WHEN r.node IS NOT NULL AND r.role IN ('reseller', 'subreseller')
        THEN 'reseller:' || r.node::text
      ELSE 'direct'
    END,
    CASE WHEN r.role IN ('reseller', 'subreseller') THEN r.node ELSE NULL END,
    CASE WHEN r.role IN ('reseller', 'subreseller') THEN r.full_name ELSE NULL END
  FROM public.earnings_history(NULL, _ecosystem, _from, _to) e
  LEFT JOIN root r ON r.leaf = e.counterparty_id
  WHERE e.earning_type = 'admin_shop_margin'
    AND e.status = 'settled'
    AND e.earning_amount <> 0

  UNION ALL

  SELECT
    'ad:' || vs.id::text,
    'income',
    vs.created_at,
    'Discount on ' || COALESCE(vs.product_name, 'purchase'),
    COALESCE(vs.discount_amount, 0),
    'admin_discount',
    NULL::uuid,
    NULL::text
  FROM public.voucher_sales vs
  WHERE vs.ecosystem_id = _ecosystem
    AND vs.created_at >= _from AND vs.created_at <= _to
    AND vs.refunded_at IS NULL
    AND vs.payment_method <> 'points'
    AND COALESCE(vs.discount_amount, 0) > 0
    AND (vs.buyer_role = 'admin' OR vs.buyer_id IN (SELECT id FROM admins))

  UNION ALL

  SELECT
    'ap:' || vs.id::text,
    'expense',
    vs.created_at,
    COALESCE(vs.product_name, 'Purchase') ||
      CASE WHEN COALESCE(vs.quantity, 1) > 1 THEN ' x' || vs.quantity::text ELSE '' END,
    COALESCE(vs.sale_price, 0),
    'admin_purchases',
    NULL::uuid,
    NULL::text
  FROM public.voucher_sales vs
  WHERE vs.ecosystem_id = _ecosystem
    AND vs.created_at >= _from AND vs.created_at <= _to
    AND vs.refunded_at IS NULL
    AND vs.payment_method <> 'points'
    AND COALESCE(vs.sale_price, 0) > 0
    AND (vs.buyer_role = 'admin' OR vs.buyer_id IN (SELECT id FROM admins));
END;
$$;

CREATE OR REPLACE FUNCTION public.spending_record_income(
  _ecosystem uuid,
  _amount numeric,
  _description text,
  _category_id uuid DEFAULT NULL,
  _occurred_at timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.spending_income_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := public.effective_uid();
  _row public.spending_income_entries;
  _name text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT (public.is_super_admin(_uid) OR public.is_ecosystem_admin(_uid, _ecosystem)) THEN
    RAISE EXCEPTION 'You can only record income for your own shop';
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
    (ecosystem_id, amount, description, category_id, notes, occurred_at, created_by, created_by_name)
  VALUES
    (_ecosystem, round(_amount, 2), btrim(_description), _category_id,
     nullif(btrim(coalesce(_notes, '')), ''), coalesce(_occurred_at, now()), _uid, _name)
  RETURNING * INTO _row;

  PERFORM public.log_operator_action(
    _uid, _ecosystem, 'spending.income.recorded', 'spending_income_entry', _row.id,
    jsonb_build_object('amount', _row.amount, 'description', _row.description)
  );
  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public.spending_update_income(
  _id uuid,
  _amount numeric,
  _description text,
  _category_id uuid DEFAULT NULL,
  _occurred_at timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.spending_income_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := public.effective_uid();
  _row public.spending_income_entries;
BEGIN
  SELECT * INTO _row FROM public.spending_income_entries WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF NOT (public.is_super_admin(_uid) OR public.is_ecosystem_admin(_uid, _row.ecosystem_id)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF btrim(coalesce(_description, '')) = '' THEN RAISE EXCEPTION 'Description is required'; END IF;

  UPDATE public.spending_income_entries SET
    amount = round(_amount, 2),
    description = btrim(_description),
    category_id = _category_id,
    notes = nullif(btrim(coalesce(_notes, '')), ''),
    occurred_at = coalesce(_occurred_at, occurred_at),
    updated_at = now()
  WHERE id = _id
  RETURNING * INTO _row;

  PERFORM public.log_operator_action(
    _uid, _row.ecosystem_id, 'spending.income.updated', 'spending_income_entry', _row.id,
    jsonb_build_object('amount', _row.amount, 'description', _row.description)
  );
  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public.spending_delete_income(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := public.effective_uid();
  _row public.spending_income_entries;
BEGIN
  SELECT * INTO _row FROM public.spending_income_entries WHERE id = _id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT (public.is_super_admin(_uid) OR public.is_ecosystem_admin(_uid, _row.ecosystem_id)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  DELETE FROM public.spending_income_entries WHERE id = _id;
  PERFORM public.log_operator_action(
    _uid, _row.ecosystem_id, 'spending.income.deleted', 'spending_income_entry', _row.id,
    jsonb_build_object('amount', _row.amount, 'description', _row.description)
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.spending_record_expense(
  _ecosystem uuid,
  _amount numeric,
  _description text,
  _category_id uuid DEFAULT NULL,
  _spent_at timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.business_expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.business_expenses;
  _cat text;
BEGIN
  IF _category_id IS NOT NULL THEN
    SELECT c.name INTO _cat FROM public.spending_categories c
    WHERE c.id = _category_id AND c.ecosystem_id = _ecosystem AND c.kind = 'expense';
    IF _cat IS NULL THEN RAISE EXCEPTION 'Unknown expense category for this shop'; END IF;
  END IF;

  _row := public.record_expense(_amount, _description, 'ecosystem', _ecosystem, _cat, _spent_at);

  UPDATE public.business_expenses SET
    category_id = _category_id,
    notes = nullif(btrim(coalesce(_notes, '')), '')
  WHERE id = _row.id
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public.spending_update_expense(
  _id uuid,
  _amount numeric,
  _description text,
  _category_id uuid DEFAULT NULL,
  _spent_at timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.business_expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := public.effective_uid();
  _row public.business_expenses;
  _cat text;
BEGIN
  SELECT * INTO _row FROM public.business_expenses WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF _row.scope <> 'ecosystem' OR _row.ecosystem_id IS NULL THEN
    RAISE EXCEPTION 'Not a shop expense';
  END IF;
  IF NOT (public.is_super_admin(_uid) OR public.is_ecosystem_admin(_uid, _row.ecosystem_id)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF btrim(coalesce(_description, '')) = '' THEN RAISE EXCEPTION 'Description is required'; END IF;

  IF _category_id IS NOT NULL THEN
    SELECT c.name INTO _cat FROM public.spending_categories c
    WHERE c.id = _category_id AND c.ecosystem_id = _row.ecosystem_id AND c.kind = 'expense';
    IF _cat IS NULL THEN RAISE EXCEPTION 'Unknown expense category for this shop'; END IF;
  END IF;

  UPDATE public.business_expenses SET
    amount = round(_amount, 2),
    description = btrim(_description),
    category = _cat,
    category_id = _category_id,
    notes = nullif(btrim(coalesce(_notes, '')), ''),
    spent_at = coalesce(_spent_at, spent_at),
    updated_at = now()
  WHERE id = _id
  RETURNING * INTO _row;

  PERFORM public.log_operator_action(
    _uid, _row.ecosystem_id, 'expense.updated', 'business_expense', _row.id,
    jsonb_build_object('amount', _row.amount, 'description', _row.description)
  );
  RETURN _row;
END;
$$;