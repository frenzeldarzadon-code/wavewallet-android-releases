CREATE OR REPLACE FUNCTION public.earnings_history(
  _recipient uuid DEFAULT NULL,
  _ecosystem uuid DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL
)
RETURNS TABLE(
  id text,
  occurred_at timestamptz,
  ecosystem_id uuid,
  earning_type text,
  recipient_id uuid,
  recipient_name text,
  counterparty_id uuid,
  counterparty_name text,
  product_name text,
  quantity integer,
  gross_amount numeric,
  basis_amount numeric,
  rate_percent numeric,
  earning_amount numeric,
  status text,
  tx_id text,
  sale_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
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
    -- Reading someone else's earnings requires admin rights on their shop.
    IF NOT _super THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = _scope_recipient
          AND is_ecosystem_admin(_uid, p.ecosystem_id)
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
  -- Sale cashback + upline commission, snapshotted at sale time.
  SELECT
    'sc:' || sc.id::text,
    sc.created_at,
    sc.ecosystem_id,
    CASE WHEN sc.kind = 'upline' THEN 'upline_commission' ELSE 'sale_cashback' END,
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

  -- Wholesale discount margin on the seller's own voucher purchases.
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
  ORDER BY 2 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.earnings_history(uuid, uuid, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.earnings_history(uuid, uuid, timestamptz, timestamptz) TO authenticated;