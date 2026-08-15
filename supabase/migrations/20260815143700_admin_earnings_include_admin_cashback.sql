-- Admin earnings accuracy fix.
--
-- The purchase engine already writes the admin's retained remainder as a real
-- `sale_commissions` row with kind = 'admin' and credits the admin wallet.
-- earnings_history reported those rows as 'sale_cashback' AND subtracted them
-- from the derived shop-margin row, so the admin dashboard showed ~0 earnings
-- on every modern sale. Admin cashback is now reported once, as
-- 'admin_shop_margin'; the derived margin row remains only for legacy sales
-- that never got an admin commission row. No historical data is modified.

CREATE OR REPLACE FUNCTION public.earnings_history(_recipient uuid DEFAULT NULL::uuid, _ecosystem uuid DEFAULT NULL::uuid, _from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id text, occurred_at timestamp with time zone, ecosystem_id uuid, earning_type text, recipient_id uuid, recipient_name text, counterparty_id uuid, counterparty_name text, product_name text, quantity integer, gross_amount numeric, basis_amount numeric, rate_percent numeric, earning_amount numeric, status text, tx_id text, sale_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.effective_uid();
  _super boolean;
  _scope_recipient uuid := _recipient;
  _scope_ecosystem uuid := _ecosystem;
  _start timestamptz := COALESCE(_from, now() - interval '5 years');
  _end timestamptz := COALESCE(_to, now());
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  _super := is_super_admin(_uid);

  IF _scope_recipient IS NOT NULL AND _scope_recipient <> _uid THEN
    IF NOT _super THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = _scope_recipient
          AND is_ecosystem_admin(_uid, p.ecosystem_id)
      ) AND NOT EXISTS (
        SELECT 1 FROM public.ecosystem_memberships m
        WHERE m.user_id = _scope_recipient
          AND is_ecosystem_admin(_uid, m.ecosystem_id)
      ) THEN
        RAISE EXCEPTION 'Not allowed to read these earnings';
      END IF;
    END IF;
  ELSIF _scope_recipient IS NULL THEN
    IF _scope_ecosystem IS NULL THEN
      IF NOT _super THEN
        _scope_recipient := _uid;
      END IF;
    ELSE
      IF NOT (_super OR is_ecosystem_admin(_uid, _scope_ecosystem)) THEN
        RAISE EXCEPTION 'Not allowed to read these earnings';
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    'sc:' || sc.id::text,
    sc.created_at,
    sc.ecosystem_id,
    CASE sc.kind
      WHEN 'upline' THEN 'upline_commission'
      WHEN 'admin' THEN 'admin_shop_margin'
      ELSE 'sale_cashback' END,
    sc.recipient_id,
    rp.full_name,
    vs.buyer_id,
    bp.full_name,
    vs.product_name,
    vs.quantity,
    vs.sale_price,
    sc.credits_consumed,
    sc.commission_percent::numeric,
    sc.commission_amount,
    CASE WHEN sc.reversed_at IS NOT NULL OR vs.refunded_at IS NOT NULL THEN 'reversed' ELSE 'settled' END,
    vs.tx_id,
    sc.sale_id
  FROM public.sale_commissions sc
  JOIN public.voucher_sales vs ON vs.id = sc.sale_id
  LEFT JOIN public.profiles rp ON rp.id = sc.recipient_id
  LEFT JOIN public.profiles bp ON bp.id = vs.buyer_id
  WHERE sc.created_at >= _start AND sc.created_at <= _end
    AND (_scope_recipient IS NULL OR sc.recipient_id = _scope_recipient)
    AND (_scope_ecosystem IS NULL OR sc.ecosystem_id = _scope_ecosystem)

  UNION ALL

  -- Legacy commission credits written before per-sale commission tracking.
  SELECT
    'cl:' || cl.id::text,
    cl.created_at,
    cl.ecosystem_id,
    'sale_cashback',
    cl.user_id,
    lp.full_name,
    NULL::uuid,
    NULL::text,
    NULL::text,
    NULL::integer,
    COALESCE(cl.base_amount, cl.amount),
    COALESCE(cl.base_amount, cl.amount),
    COALESCE(cl.commission_percent, 0)::numeric,
    cl.amount,
    'settled',
    cl.tx_id,
    cl.sale_id
  FROM public.credit_ledger cl
  LEFT JOIN public.profiles lp ON lp.id = cl.user_id
  WHERE cl.entry_kind = 'sale_commission'
    AND cl.direction = 'credit'
    AND cl.created_at >= _start AND cl.created_at <= _end
    AND NOT EXISTS (SELECT 1 FROM public.sale_commissions s2 WHERE s2.ledger_id = cl.id)
    AND (_scope_recipient IS NULL OR cl.user_id = _scope_recipient)
    AND (_scope_ecosystem IS NULL OR cl.ecosystem_id = _scope_ecosystem)

  UNION ALL

  SELECT
    'wd:' || vs.id::text,
    vs.created_at,
    vs.ecosystem_id,
    'wholesale_discount',
    vs.buyer_id,
    bp2.full_name,
    NULL::uuid,
    NULL::text,
    vs.product_name,
    vs.quantity,
    vs.list_price * GREATEST(COALESCE(vs.quantity, 1), 1),
    vs.list_price * GREATEST(COALESCE(vs.quantity, 1), 1),
    vs.discount_percent::numeric,
    COALESCE(vs.discount_amount, 0),
    CASE WHEN vs.refunded_at IS NOT NULL THEN 'reversed' ELSE 'settled' END,
    vs.tx_id,
    vs.id
  FROM public.voucher_sales vs
  LEFT JOIN public.profiles bp2 ON bp2.id = vs.buyer_id
  WHERE vs.created_at >= _start AND vs.created_at <= _end
    AND vs.payment_method <> 'points'
    AND COALESCE(vs.discount_amount, 0) > 0
    AND vs.buyer_role IN ('reseller', 'subreseller')
    AND (_scope_recipient IS NULL OR vs.buyer_id = _scope_recipient)
    AND (_scope_ecosystem IS NULL OR vs.ecosystem_id = _scope_ecosystem)

  UNION ALL

  -- Shop (admin) retained share of a completed voucher sale: the credits
  -- collected on the sale, less the reseller/subreseller cashback actually
  -- allocated to that same sale (rates snapshotted at sale time). The shop's
  -- admin is resolved from their shop membership first, because roles are
  -- per shop; the legacy profile/user_roles lookup is only a fallback.
  SELECT
    'am:' || vs.id::text,
    vs.created_at,
    vs.ecosystem_id,
    'admin_shop_margin',
    adm.id,
    adm.full_name,
    vs.buyer_id,
    bp3.full_name,
    vs.product_name,
    vs.quantity,
    vs.sale_price,
    vs.sale_price,
    CASE WHEN vs.sale_price > 0
      THEN round(((vs.sale_price - COALESCE(c.paid, 0)) / vs.sale_price) * 100, 2)
      ELSE 0 END,
    vs.sale_price - COALESCE(c.paid, 0),
    CASE WHEN vs.refunded_at IS NOT NULL THEN 'reversed' ELSE 'settled' END,
    vs.tx_id,
    vs.id
  FROM public.voucher_sales vs
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(sc2.commission_amount), 0) AS paid
    FROM public.sale_commissions sc2
    WHERE sc2.sale_id = vs.id AND sc2.reversed_at IS NULL AND sc2.kind <> 'admin'
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT x.id, x.full_name
    FROM (
      SELECT p.id, p.full_name, 0 AS pri, m.created_at AS at
      FROM public.ecosystem_memberships m
      JOIN public.profiles p ON p.id = m.user_id
      WHERE m.ecosystem_id = vs.ecosystem_id
        AND m.role = 'admin'
        AND m.membership_state = 'active'
        AND m.status = 'active'
      UNION ALL
      SELECT p.id, p.full_name, 1, p.created_at
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'admin'
      WHERE COALESCE(ur.ecosystem_id, p.ecosystem_id) = vs.ecosystem_id
    ) x
    ORDER BY x.pri, x.at
    LIMIT 1
  ) adm ON true
  LEFT JOIN public.profiles bp3 ON bp3.id = vs.buyer_id
  WHERE vs.created_at >= _start AND vs.created_at <= _end
    AND vs.payment_method <> 'points'
    AND adm.id IS NOT NULL
    -- Only legacy sales without an explicit admin remainder row; modern sales
    -- carry a real `admin` sale_commissions row already reported above, so
    -- deriving a second margin row here would double count.
    AND NOT EXISTS (
      SELECT 1 FROM public.sale_commissions sa
      WHERE sa.sale_id = vs.id AND sa.kind = 'admin' AND sa.reversed_at IS NULL
    )
    AND (_scope_recipient IS NULL OR adm.id = _scope_recipient)
    AND (_scope_ecosystem IS NULL OR vs.ecosystem_id = _scope_ecosystem)

  UNION ALL

  -- Retail product orders paid with credits: the shop keeps the full order
  -- value once the order is approved. Pending, rejected and cancelled orders
  -- and cash orders never count.
  SELECT
    'ro:' || ro.id::text,
    COALESCE(ro.decided_at, ro.created_at),
    ro.ecosystem_id,
    'admin_shop_margin',
    adm2.id,
    adm2.full_name,
    ro.customer_id,
    ro.customer_name,
    'Retail order ' || ro.order_no,
    NULL::integer,
    ro.total,
    ro.total,
    100::numeric,
    ro.total,
    'settled',
    ro.credit_hold_tx,
    ro.id
  FROM public.retail_orders ro
  LEFT JOIN LATERAL (
    SELECT x.id, x.full_name
    FROM (
      SELECT p.id, p.full_name, 0 AS pri, m.created_at AS at
      FROM public.ecosystem_memberships m
      JOIN public.profiles p ON p.id = m.user_id
      WHERE m.ecosystem_id = ro.ecosystem_id
        AND m.role = 'admin'
        AND m.membership_state = 'active'
        AND m.status = 'active'
      UNION ALL
      SELECT p.id, p.full_name, 1, p.created_at
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'admin'
      WHERE COALESCE(ur.ecosystem_id, p.ecosystem_id) = ro.ecosystem_id
    ) x
    ORDER BY x.pri, x.at
    LIMIT 1
  ) adm2 ON true
  WHERE COALESCE(ro.decided_at, ro.created_at) >= _start
    AND COALESCE(ro.decided_at, ro.created_at) <= _end
    AND ro.status = 'approved'
    AND ro.payment_method = 'credit'
    AND ro.total > 0
    AND adm2.id IS NOT NULL
    AND (_scope_recipient IS NULL OR adm2.id = _scope_recipient)
    AND (_scope_ecosystem IS NULL OR ro.ecosystem_id = _scope_ecosystem)

  UNION ALL

  -- Platform-minted credit supply. Visible to the platform owner only and
  -- never counted as shop earnings: manual issuance and approved cash-in are
  -- platform authority actions, not shop sales.
  SELECT
    'cg:' || cl.id::text,
    cl.created_at,
    cl.ecosystem_id,
    'credit_generation',
    cl.actor_id,
    ap.full_name,
    cl.user_id,
    tp.full_name,
    cl.reason,
    NULL::integer,
    cl.amount,
    cl.amount,
    0::numeric,
    CASE WHEN cl.direction = 'credit' THEN cl.amount ELSE -cl.amount END,
    'settled',
    cl.tx_id,
    NULL::uuid
  FROM public.credit_ledger cl
  LEFT JOIN public.profiles ap ON ap.id = cl.actor_id
  LEFT JOIN public.profiles tp ON tp.id = cl.user_id
  WHERE _super
    AND cl.created_at >= _start AND cl.created_at <= _end
    AND cl.actor_id IS NOT NULL
    AND cl.entry_kind IN ('general', 'credit_issue', 'credit_revocation')
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_ledger o
      WHERE regexp_replace(o.tx_id, '-R$', '') = regexp_replace(cl.tx_id, '-R$', '')
        AND o.id <> cl.id
        AND o.direction <> cl.direction
    )
    AND public.has_role(cl.actor_id, 'super_admin')
    AND (_scope_recipient IS NULL OR cl.actor_id = _scope_recipient)
    AND (_scope_ecosystem IS NULL OR cl.ecosystem_id = _scope_ecosystem)

  UNION ALL

  -- Platform subscription revenue: platform owner only.
  SELECT
    'ps:' || sr.id::text,
    COALESCE(sr.reviewed_at, sr.updated_at),
    sr.ecosystem_id,
    'platform_subscription',
    sr.reviewed_by,
    sr.reviewed_by_name,
    NULL::uuid,
    e.name,
    sr.plan_name,
    NULL::integer,
    COALESCE(sr.amount_paid, sr.amount_due),
    COALESCE(sr.amount_paid, sr.amount_due),
    0::numeric,
    COALESCE(sr.amount_paid, sr.amount_due),
    'settled',
    sr.payment_reference,
    NULL::uuid
  FROM public.subscription_requests sr
  LEFT JOIN public.ecosystems e ON e.id = sr.ecosystem_id
  WHERE _super
    AND _scope_recipient IS NULL
    AND sr.status = 'approved'
    AND COALESCE(sr.reviewed_at, sr.updated_at) >= _start
    AND COALESCE(sr.reviewed_at, sr.updated_at) <= _end
    AND (_scope_ecosystem IS NULL OR sr.ecosystem_id = _scope_ecosystem)

  ORDER BY 2 DESC;
END;
$function$

;
