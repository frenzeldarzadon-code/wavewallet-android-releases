-- Spending Tracker reporting model only: an admin self-purchase is reported as
-- the admin cashback actually earned, with no face-value sales line, no
-- platform-fee expense and no reward-point expense. Nothing outside this
-- reporting function changes.
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

  -- Admin shop margin on sales to other members (unchanged behaviour).
  SELECT
    'cb:' || e.id,
    'income',
    e.occurred_at,
    COALESCE(e.product_name, 'Sale') ||
      CASE WHEN e.counterparty_name IS NOT NULL THEN ' - ' || e.counterparty_name ELSE '' END,
    ROUND(e.earning_amount, 2),
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

  -- Admin self-purchase: report the admin cashback actually recorded on that
  -- sale as the admin's income. The face value is never reported as a sale, so
  -- one voucher transaction yields exactly one entry here.
  SELECT
    'sc:' || sc.id::text,
    'income',
    sc.created_at,
    'Admin cashback - ' || COALESCE(s.product_name, 'voucher') ||
      CASE WHEN COALESCE(s.quantity, 1) > 1 THEN ' x' || s.quantity::text ELSE '' END,
    ROUND(sc.commission_amount, 2),
    'admin_self_cashback',
    NULL::uuid,
    NULL::text
  FROM public.sale_commissions sc
  JOIN self_sale s ON s.id = sc.sale_id
  WHERE sc.reversed_at IS NULL
    AND sc.kind = 'admin'
    AND sc.commission_amount > 0

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
  WHERE COALESCE(s.discount_amount, 0) > 0;
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
    (_ecosystem, 'income', 'Admin Cashback', 'admin_self_cashback')
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