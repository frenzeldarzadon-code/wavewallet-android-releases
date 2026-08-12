-- 1. Tag newly generated credits so reporting can separate them from transfers.
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_user_id uuid, _amount numeric, _reason text, _reference text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eco uuid; _acct uuid; _tx text; _actor text; _target text; _dir text;
begin
  perform public.require_operational();
  select p.ecosystem_id, p.full_name || ' — ' || p.email into _eco, _target
  from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _amount is null or _amount = 0 then raise exception 'Enter an amount'; end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;

  select id into _acct from public.credit_accounts where user_id = _user_id;
  if _acct is null then raise exception 'This member has no credit wallet yet'; end if;

  _tx := public.new_tx_id();
  _dir := case when _amount > 0 then 'credit' else 'debit' end;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, _dir, abs(_amount), 0, trim(_reason),
          nullif(trim(_reference),''), auth.uid(), _tx,
          case when _amount > 0 then 'credit_issue' else 'credit_revocation' end,
          abs(_amount), 0, 0);

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'),
          case when _amount > 0 then 'Added credits' else 'Deducted credits' end,
          coalesce(_target,''),
          jsonb_build_object('amount', abs(_amount), 'reason', trim(_reason), 'reference', _reference,
                             'commission_percent', 0, 'commission_amount', 0,
                             'total_received', abs(_amount), 'tx_id', _tx));
  return _tx;
end; $function$;

-- 2. Earnings history: add credit generation + platform subscription revenue.
CREATE OR REPLACE FUNCTION public.earnings_history(_recipient uuid DEFAULT NULL::uuid, _ecosystem uuid DEFAULT NULL::uuid, _from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id text, occurred_at timestamp with time zone, ecosystem_id uuid, earning_type text, recipient_id uuid, recipient_name text, counterparty_id uuid, counterparty_name text, product_name text, quantity integer, gross_amount numeric, basis_amount numeric, rate_percent numeric, earning_amount numeric, status text, tx_id text, sale_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Newly generated (issued) credits count as shop-owner earnings.
  -- A generated entry has no matching debit on the other side of the same
  -- transaction; wallet-to-wallet transfers always do and are excluded.
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
  WHERE cl.created_at >= _start AND cl.created_at <= _end
    AND cl.actor_id IS NOT NULL
    AND cl.entry_kind IN ('general', 'credit_issue', 'credit_revocation')
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_ledger o
      WHERE o.tx_id = cl.tx_id AND o.id <> cl.id
        AND o.direction <> cl.direction
    )
    AND (
      public.has_role(cl.actor_id, 'admin') OR public.has_role(cl.actor_id, 'super_admin')
    )
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
$function$;