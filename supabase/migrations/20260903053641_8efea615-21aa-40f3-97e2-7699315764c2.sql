-- ============================================================
-- Retail R4 — order lifecycle & settlement hardening (Retail only)
-- Lifecycle stays: pending -> approved | rejected | cancelled (all final).
-- ============================================================

-- 1. Order items are the immutable pricing snapshot.
CREATE OR REPLACE FUNCTION public.retail_order_items_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if TG_OP = 'UPDATE' then
    raise exception 'Retail order items are an immutable snapshot';
  end if;
  -- Plain deletes are forbidden; FK cascades (shop purge) run at trigger depth > 0.
  if TG_OP = 'DELETE' and pg_trigger_depth() = 0 then
    raise exception 'Retail order items cannot be deleted';
  end if;
  return coalesce(NEW, OLD);
end $$;
DROP TRIGGER IF EXISTS retail_order_items_guard ON public.retail_order_items;
CREATE TRIGGER retail_order_items_guard
  BEFORE UPDATE OR DELETE ON public.retail_order_items
  FOR EACH ROW EXECUTE FUNCTION public.retail_order_items_guard();

-- 2. Orders: legal transitions only, write-once ledger pointers, frozen snapshots,
--    and nothing but notified_at/updated_at may change once the order is final.
CREATE OR REPLACE FUNCTION public.retail_orders_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
declare _creating boolean := (OLD.created_at = now());
begin
  -- status machine
  if NEW.status is distinct from OLD.status then
    if OLD.status <> 'pending' or NEW.status not in ('approved','rejected','cancelled') then
      raise exception 'Retail order % is already % and cannot change', OLD.order_no, OLD.status;
    end if;
  end if;
  -- final orders: only bookkeeping columns may change
  if OLD.status <> 'pending'
     and (to_jsonb(NEW) - 'updated_at' - 'notified_at') <> (to_jsonb(OLD) - 'updated_at' - 'notified_at') then
    raise exception 'Retail order % is final and cannot be modified', OLD.order_no;
  end if;
  -- write-once money pointers
  if (OLD.hold_ledger_id       is not null and NEW.hold_ledger_id       is distinct from OLD.hold_ledger_id)
  or (OLD.settlement_ledger_id is not null and NEW.settlement_ledger_id is distinct from OLD.settlement_ledger_id)
  or (OLD.refund_ledger_id     is not null and NEW.refund_ledger_id     is distinct from OLD.refund_ledger_id)
  or (OLD.cashback_ledger_id   is not null and NEW.cashback_ledger_id   is distinct from OLD.cashback_ledger_id)
  or (OLD.credit_hold_tx       is not null and NEW.credit_hold_tx       is distinct from OLD.credit_hold_tx)
  or (OLD.wallet_account_id    is not null and NEW.wallet_account_id    is distinct from OLD.wallet_account_id)
  or (OLD.settled_to           is not null and NEW.settled_to           is distinct from OLD.settled_to)
  or (OLD.credit_released and not NEW.credit_released) then
    raise exception 'Retail order % ledger references are write-once', OLD.order_no;
  end if;
  -- settlement and refund are mutually exclusive
  if NEW.settlement_ledger_id is not null and NEW.refund_ledger_id is not null then
    raise exception 'Retail order % cannot be both settled and refunded', OLD.order_no;
  end if;
  if NEW.cashback_ledger_id is not null and NEW.refund_ledger_id is not null then
    raise exception 'Retail order % cannot pay cashback on a refunded order', OLD.order_no;
  end if;
  -- pricing / attribution snapshot: only the creating transaction may set it
  if not _creating and (
        NEW.total is distinct from OLD.total
     or NEW.seller_total is distinct from OLD.seller_total
     or NEW.platform_fee_percent is distinct from OLD.platform_fee_percent
     or NEW.platform_fee_amount is distinct from OLD.platform_fee_amount
     or NEW.cashback_total is distinct from OLD.cashback_total
     or NEW.cashback_recipient_id is distinct from OLD.cashback_recipient_id
     or NEW.seller_id is distinct from OLD.seller_id
     or NEW.ecosystem_id is distinct from OLD.ecosystem_id
     or NEW.customer_id is distinct from OLD.customer_id
     or NEW.payment_method is distinct from OLD.payment_method) then
    raise exception 'Retail order % pricing snapshot is immutable', OLD.order_no;
  end if;
  -- coin orders: approval needs the hold; rejection/cancellation must never settle
  if NEW.payment_method = 'credit' then
    if NEW.status = 'approved' and (NEW.hold_ledger_id is null or NEW.credit_hold_tx is null or NEW.refund_ledger_id is not null) then
      raise exception 'Retail order % cannot be approved without its payment hold', OLD.order_no;
    end if;
    if NEW.status in ('rejected','cancelled') and (NEW.settlement_ledger_id is not null or NEW.cashback_ledger_id is not null) then
      raise exception 'Retail order % cannot be % after settlement', OLD.order_no, NEW.status;
    end if;
  end if;
  return NEW;
end $$;
DROP TRIGGER IF EXISTS retail_orders_guard ON public.retail_orders;
CREATE TRIGGER retail_orders_guard
  BEFORE UPDATE ON public.retail_orders
  FOR EACH ROW EXECUTE FUNCTION public.retail_orders_guard();

-- 3. Refund exactly what was held, once.
CREATE OR REPLACE FUNCTION public.retail_refund_hold(_order public.retail_orders, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _acct uuid; _refund uuid; _held numeric(14,2);
begin
  if _order.payment_method <> 'credit' or (_order.hold_ledger_id is null and _order.credit_hold_tx is null) then
    return null;
  end if;
  if _order.credit_released or _order.refund_ledger_id is not null
     or _order.settlement_ledger_id is not null or _order.cashback_ledger_id is not null then
    return null;
  end if;
  select amount into _held from public.credit_ledger where id = _order.hold_ledger_id and direction = 'debit';
  if _held is null or _held <> _order.total then
    raise exception 'Retail order % hold does not match its total', _order.order_no;
  end if;
  _acct := coalesce(_order.wallet_account_id,
                    public.retail_wallet_for(_order.customer_id, _order.ecosystem_id));
  -- tx_id = hold tx + '-R' is globally unique: a second refund is impossible.
  insert into public.credit_ledger
    (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference,
     actor_id, tx_id, entry_kind, reverses_ledger_id)
  values (_acct, _order.customer_id, _order.ecosystem_id, 'credit', _held, 0,
          'Retail order refund — ' || _order.order_no, _order.order_no, _actor,
          coalesce(_order.credit_hold_tx, public.new_tx_id()) || '-R', 'retail_refund', _order.hold_ledger_id)
  returning id into _refund;
  return _refund;
end $$;

-- 4. Approval of a coin order requires its hold (never approve "for free").
DO $$
DECLARE _def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'retail_review_order';
  IF position('has no payment hold' in _def) = 0 THEN
    _def := replace(_def,
      '    if _o.payment_method = ''credit'' and _o.hold_ledger_id is not null then',
      '    if _o.payment_method = ''credit'' and (_o.hold_ledger_id is null or _o.credit_hold_tx is null) then'
      || E'\n      raise exception ''Retail order % has no payment hold and cannot be approved'', _o.order_no;'
      || E'\n    end if;'
      || E'\n    if _o.payment_method = ''credit'' and _o.hold_ledger_id is not null then');
    IF position('has no payment hold' in _def) = 0 THEN
      RAISE EXCEPTION 'retail_review_order anchor not found';
    END IF;
    EXECUTE _def;
  END IF;
END $$;