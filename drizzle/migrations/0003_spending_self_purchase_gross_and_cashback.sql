-- Admin self-purchases report GROSS sales, with the cashback actually paid on
-- that sale shown as a separate expense (alongside the platform fee and the
-- reward point cost). Reporting only; no money moves and no new transactions.
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
  ),
  self_sale AS (
    SELECT vs.*
    FROM public.voucher_sales vs
    WHERE vs.ecosystem_id = _ecosystem
      AND vs.created_at >= _from AND vs.created_at <= _to
      AND vs.refunded_at IS NULL
      AND vs.payment_method <> 'points'
      AND (vs.buyer_role = 'admin' OR vs.buyer_id IN (SELECT a.admin_id FROM admins a))
  )

  -- Admin shop margin on sales to other members. Rows sourced from a
  -- sale_commissions snapshot are recorded NET of the platform fee, so the fee
  -- is added back here and shown separately as an expense below.
  SELECT
    'cb:' || e.id,
    'income',
    e.occurred_at,
    COALESCE(e.product_name, 'Sale') ||
      CASE WHEN e.counterparty_name IS NOT NULL THEN ' - ' || e.counterparty_name ELSE '' END,
    ROUND(e.earning_amount + CASE WHEN e.id LIKE 'sc:%' THEN COALESCE(vs.platform_fee_amount, 0) ELSE 0 END, 2),
    CASE
      WHEN r.node IS NOT NULL AND r.role IN ('reseller', 'subreseller')
        THEN 'reseller:' || r.node::text
      ELSE 'direct'
    END,
    CASE WHEN r.role IN ('reseller', 'subreseller') THEN r.node ELSE NULL END,
    CASE WHEN r.role IN ('reseller', 'subreseller') THEN r.full_name ELSE NULL END
  FROM public.earnings_history(NULL, _ecosystem, _from, _to) e
  LEFT JOIN root r ON r.leaf = e.counterparty_id
  LEFT JOIN public.voucher_sales vs ON vs.id = e.sale_id
  WHERE e.earning_type = 'admin_shop_margin'
    AND e.status = 'settled'
    AND e.earning_amount <> 0
    AND NOT (
      (r.node IS NULL OR r.role NOT IN ('reseller', 'subreseller'))
      AND e.counterparty_id IN (SELECT a.admin_id FROM admins a)
    )

  UNION ALL

  -- Admin self-purchase: a real sale of the shop's own stock, reported at the
  -- GROSS amount collected. Cashback, platform fee and reward point cost on the
  -- same sale are expensed separately below, so the net figure stays right.
  SELECT
    'sp:' || s.id::text,
    'income',
    s.created_at,
    'Self-purchase - ' || COALESCE(s.product_name, 'voucher') ||
      CASE WHEN COALESCE(s.quantity, 1) > 1 THEN ' x' || s.quantity::text ELSE '' END,
    ROUND(s.sale_price, 2),
    'admin_self_purchase',
    NULL::uuid,
    NULL::text
  FROM self_sale s
  WHERE ROUND(s.sale_price, 2) <> 0

  UNION ALL

  -- Admin Discount benefit (New Generation shops only; Universe shops record 0).
  SELECT
    'ad:' || s.id::text,
    'income',
    s.created_at,
    'Discount on ' || COALESCE(s.product_name, 'purchase'),
    COALESCE(s.discount_amount, 0),
    'admin_discount',
    NULL::uuid,
    NULL::text
  FROM self_sale s
  WHERE COALESCE(s.discount_amount, 0) > 0

  UNION ALL

  -- Cashback paid out of an admin self-purchase: the admin's own benefit and
  -- any downline cashback on that same sale. Sales to other members are already
  -- reported net of cashback (only the admin's share is income), so only
  -- self-purchase sales produce these rows and nothing is counted twice.
  SELECT
    'sc:' || sc.id::text,
    'expense',
    sc.created_at,
    CASE WHEN sc.kind = 'admin' THEN 'Admin cashback - ' ELSE 'Cashback - ' END
      || COALESCE(s.product_name, 'voucher'),
    ROUND(sc.commission_amount, 2),
    CASE WHEN sc.kind = 'admin' THEN 'admin_self_cashback' ELSE 'sale_cashback' END,
    NULL::uuid,
    NULL::text
  FROM public.sale_commissions sc
  JOIN self_sale s ON s.id = sc.sale_id
  WHERE sc.reversed_at IS NULL
    AND sc.commission_amount > 0

  UNION ALL

  -- Platform fee on every completed voucher sale, at the rate snapshotted on
  -- the sale itself.
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

  UNION ALL

  -- Reward points actually awarded in this shop, at 1 point = 1 Universe coin.
  SELECT
    'pt:' || pl.id::text,
    'expense',
    pl.created_at,
    'Reward points - ' || COALESCE(NULLIF(pl.reason, ''), 'earned on sale'),
    ROUND(pl.amount, 2),
    'admin_points_cost',
    NULL::uuid,
    NULL::text
  FROM public.points_ledger pl
  WHERE pl.ecosystem_id = _ecosystem
    AND pl.entry_type = 'earn'
    AND pl.direction = 'credit'
    AND pl.amount > 0
    AND pl.created_at >= _from AND pl.created_at <= _to
    AND NOT EXISTS (
      SELECT 1 FROM public.points_ledger rv
      WHERE rv.ecosystem_id = pl.ecosystem_id
        AND rv.entry_type = 'adjust'
        AND rv.direction = 'debit'
        AND ((pl.sale_id IS NOT NULL AND rv.sale_id = pl.sale_id)
          OR (pl.retail_order_id IS NOT NULL AND rv.retail_order_id = pl.retail_order_id))
    );
END;
$function$;

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
    (_ecosystem, 'income', 'Admin Self-Purchase Sales', 'admin_self_purchase'),
    (_ecosystem, 'expense', 'Admin Purchases', 'admin_purchases'),
    (_ecosystem, 'expense', 'Admin Cashback', 'admin_self_cashback'),
    (_ecosystem, 'expense', 'Reseller Cashback', 'sale_cashback'),
    (_ecosystem, 'expense', 'Platform Fees', 'admin_platform_fee'),
    (_ecosystem, 'expense', 'Reward Points / Coin Conversion', 'admin_points_cost')
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