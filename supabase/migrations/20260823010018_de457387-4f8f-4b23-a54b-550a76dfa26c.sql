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

  -- Automatic entries are INCOME ONLY:
  --   1. admin cashback attributed to the top-level reseller of the buyer chain
  --   2. admin cashback with no reseller ancestor -> 'direct' (admin self-purchases excluded)
  --   3. admin discount actually received
  -- No automatic expense is ever produced; expenses are manual only.
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
    AND (vs.buyer_role = 'admin' OR vs.buyer_id IN (SELECT a.admin_id FROM admins a));
END;
$function$;