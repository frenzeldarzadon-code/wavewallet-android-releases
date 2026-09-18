-- Spending Tracker: surface the shop admin's REAL derived coin costs as
-- automatic expense entries. Reporting only: nothing here moves money and no
-- row is written. Two sources, both already authoritative elsewhere:
--   pf:<sale id>  platform fee the admin actually paid on his own purchases
--                 (the matching margin income is deliberately excluded, so
--                  this is not double counted)
--   pc:<ledger id> points-cost debits charged to the admin for this shop
-- The voucher face value ("admin_purchases") is intentionally NOT re-added:
-- an admin self-purchase is settled at a net charge, so the face value would
-- double count against the excluded self-purchase margin.

CREATE OR REPLACE FUNCTION public.spending_sync_categories(_ecosystem uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    (_ecosystem, 'expense', 'Admin Purchases', 'admin_purchases'),
    (_ecosystem, 'expense', 'Platform Fees', 'admin_platform_fee'),
    (_ecosystem, 'expense', 'Reward Points Cost', 'admin_points_cost')
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
$function$;

CREATE OR REPLACE FUNCTION public.spending_auto_entries(_ecosystem uuid, _from timestamp with time zone, _to timestamp with time zone)
 RETURNS TABLE(id text, kind text, occurred_at timestamp with time zone, description text, amount numeric, auto_key text, member_id uuid, member_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT DISTINCT x.admin_id AS admin_id FROM (
      SELECT m.user_id AS admin_id
      FROM public.ecosystem_memberships m
      WHERE m.ecosystem_id = _ecosystem AND m.role = 'admin'
      UNION
      SELECT pr.id AS admin_id
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
    AND NOT (
      (r.node IS NULL OR r.role NOT IN ('reseller', 'subreseller'))
      AND e.counterparty_id IN (SELECT a.admin_id FROM admins a)
    )

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
    AND (vs.buyer_role = 'admin' OR vs.buyer_id IN (SELECT a.admin_id FROM admins a))

  UNION ALL

  -- Platform fee the admin actually paid on his own purchases.
  SELECT
    'pf:' || vs.id::text,
    'expense',
    vs.created_at,
    'Platform fee - ' || COALESCE(vs.product_name, 'purchase') ||
      CASE WHEN COALESCE(vs.quantity, 1) > 1 THEN ' x' || vs.quantity::text ELSE '' END,
    ROUND(COALESCE(vs.platform_fee_amount, 0), 2),
    'admin_platform_fee',
    NULL::uuid,
    NULL::text
  FROM public.voucher_sales vs
  WHERE vs.ecosystem_id = _ecosystem
    AND vs.created_at >= _from AND vs.created_at <= _to
    AND vs.refunded_at IS NULL
    AND vs.payment_method <> 'points'
    AND COALESCE(vs.platform_fee_amount, 0) > 0
    AND (vs.buyer_role = 'admin' OR vs.buyer_id IN (SELECT a.admin_id FROM admins a))

  UNION ALL

  -- Reward point cost charged to the shop admin (1 point = 1 coin).
  SELECT
    'pc:' || cl.id::text,
    'expense',
    cl.created_at,
    COALESCE(NULLIF(cl.description, ''), 'Reward points cost'),
    ROUND(cl.amount, 2),
    'admin_points_cost',
    NULL::uuid,
    NULL::text
  FROM public.credit_ledger cl
  WHERE cl.ecosystem_id = _ecosystem
    AND cl.direction = 'debit'
    AND cl.entry_kind = 'points_cost_reconciliation'
    AND cl.created_at >= _from AND cl.created_at <= _to
    AND cl.amount > 0
    AND cl.user_id IN (SELECT a.admin_id FROM admins a);
END;
$function$;