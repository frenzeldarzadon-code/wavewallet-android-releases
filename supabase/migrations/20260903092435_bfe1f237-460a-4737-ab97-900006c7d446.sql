-- R6 fix: non-COD delivery orders may record self-delivery / delivery person (needed for the order chat)
create or replace function public.retail_orders_guard()
returns trigger language plpgsql set search_path = public as $$
declare _creating boolean := (OLD.created_at = now());
        _fcols text[] := array['updated_at','notified_at','fulfillment_status','fulfillment_updated_at','delivered_at','completed_at','chat_thread_id'];
        _cod_cols text[] := array['self_delivery','delivery_person_id','collector_id','collector_status','collector_responded_at',
                                  'cod_hold_tx','cod_hold_ledger_id','cod_expected_cash','cod_actual_cash','cod_cash_received_at',
                                  'cod_discrepancy','cod_settled_at','cod_settlement_kind','delivery_share_ledger_id',
                                  'collector_share_ledger_id','settlement_ledger_id','settled_to','cashback_ledger_id',
                                  'refund_ledger_id','credit_released','decision_note','decided_at','decided_by','status'];
        _cod boolean := (OLD.payment_method = 'cod');
begin
  if _cod then _fcols := _fcols || _cod_cols;
  elsif OLD.fulfillment = 'delivery' then
    -- cash / credit delivery orders may still record who delivers (no money moves; collector stays 'none')
    _fcols := _fcols || array['self_delivery','delivery_person_id'];
  end if;

  if NEW.status is distinct from OLD.status then
    if OLD.status = 'pending' and NEW.status in ('approved','rejected','cancelled') then
      NEW.fulfillment_status := case when NEW.status = 'approved' then 'accepted' else 'closed' end;
      NEW.fulfillment_updated_at := now();
    elsif _cod and OLD.status = 'approved' and NEW.status = 'cancelled'
          and OLD.cod_settled_at is null and OLD.settlement_ledger_id is null and OLD.cashback_ledger_id is null then
      if OLD.cod_hold_ledger_id is not null and NEW.refund_ledger_id is null then
        raise exception 'Retail order % cannot be cancelled without releasing the collector hold', OLD.order_no;
      end if;
      NEW.fulfillment_status := 'closed';
      NEW.fulfillment_updated_at := now();
      NEW.credit_released := true;
    else
      raise exception 'Retail order % is already % and cannot change', OLD.order_no, OLD.status;
    end if;
  elsif NEW.fulfillment_status is distinct from OLD.fulfillment_status then
    if OLD.status <> 'approved' or OLD.fulfillment_status in ('completed','closed','awaiting')
       or not public.retail_fulfillment_step_ok(OLD.fulfillment_status, NEW.fulfillment_status, OLD.fulfillment) then
      raise exception 'Retail order % cannot move from % to %', OLD.order_no, OLD.fulfillment_status, NEW.fulfillment_status;
    end if;
    if _cod and NEW.fulfillment_status = 'out_for_delivery'
       and (NEW.collector_status <> 'approved' or NEW.cod_hold_ledger_id is null) then
      raise exception 'Retail order % cannot go out for delivery until a collector has approved and the coins are held', OLD.order_no;
    end if;
    NEW.fulfillment_updated_at := now();
    if NEW.fulfillment_status = 'delivered' then NEW.delivered_at := now(); end if;
    if NEW.fulfillment_status = 'completed' then NEW.completed_at := now(); end if;
  else
    if NEW.delivered_at is distinct from OLD.delivered_at or NEW.completed_at is distinct from OLD.completed_at
       or NEW.fulfillment_updated_at is distinct from OLD.fulfillment_updated_at then
      raise exception 'Retail order % fulfillment timestamps are write-once', OLD.order_no;
    end if;
  end if;

  if OLD.status <> 'pending' and (to_jsonb(NEW) - _fcols) <> (to_jsonb(OLD) - _fcols) then
    raise exception 'Retail order % is final and cannot be modified', OLD.order_no;
  end if;

  if (OLD.hold_ledger_id       is not null and NEW.hold_ledger_id       is distinct from OLD.hold_ledger_id)
  or (OLD.settlement_ledger_id is not null and NEW.settlement_ledger_id is distinct from OLD.settlement_ledger_id)
  or (OLD.refund_ledger_id     is not null and NEW.refund_ledger_id     is distinct from OLD.refund_ledger_id)
  or (OLD.cashback_ledger_id   is not null and NEW.cashback_ledger_id   is distinct from OLD.cashback_ledger_id)
  or (OLD.credit_hold_tx       is not null and NEW.credit_hold_tx       is distinct from OLD.credit_hold_tx)
  or (OLD.wallet_account_id    is not null and NEW.wallet_account_id    is distinct from OLD.wallet_account_id)
  or (OLD.settled_to           is not null and NEW.settled_to           is distinct from OLD.settled_to)
  or (OLD.cod_hold_tx          is not null and NEW.cod_hold_tx          is distinct from OLD.cod_hold_tx)
  or (OLD.cod_hold_ledger_id   is not null and NEW.cod_hold_ledger_id   is distinct from OLD.cod_hold_ledger_id)
  or (OLD.cod_settled_at       is not null and NEW.cod_settled_at       is distinct from OLD.cod_settled_at)
  or (OLD.cod_cash_received_at is not null and NEW.cod_cash_received_at is distinct from OLD.cod_cash_received_at)
  or (OLD.delivery_share_ledger_id  is not null and NEW.delivery_share_ledger_id  is distinct from OLD.delivery_share_ledger_id)
  or (OLD.collector_share_ledger_id is not null and NEW.collector_share_ledger_id is distinct from OLD.collector_share_ledger_id)
  or (OLD.credit_released and not NEW.credit_released) then
    raise exception 'Retail order % ledger references are write-once', OLD.order_no;
  end if;
  if NEW.settlement_ledger_id is not null and NEW.refund_ledger_id is not null then
    raise exception 'Retail order % cannot be both settled and refunded', OLD.order_no;
  end if;
  if NEW.cashback_ledger_id is not null and NEW.refund_ledger_id is not null then
    raise exception 'Retail order % cannot pay cashback on a refunded order', OLD.order_no;
  end if;

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
     or NEW.payment_method is distinct from OLD.payment_method
     or NEW.delivery_fee is distinct from OLD.delivery_fee
     or NEW.delivery_split_delivery_pct is distinct from OLD.delivery_split_delivery_pct
     or NEW.delivery_split_collector_pct is distinct from OLD.delivery_split_collector_pct) then
    raise exception 'Retail order % pricing snapshot is immutable', OLD.order_no;
  end if;

  if NEW.payment_method = 'credit' then
    if NEW.status = 'approved' and (NEW.hold_ledger_id is null or NEW.credit_hold_tx is null or NEW.refund_ledger_id is not null) then
      raise exception 'Retail order % cannot be approved without its payment hold', OLD.order_no;
    end if;
    if NEW.status in ('rejected','cancelled') and (NEW.settlement_ledger_id is not null or NEW.cashback_ledger_id is not null) then
      raise exception 'Retail order % cannot be % after settlement', OLD.order_no, NEW.status;
    end if;
  elsif NEW.payment_method = 'cod' then
    if NEW.fulfillment <> 'delivery' then raise exception 'Retail order % cash on delivery requires delivery', OLD.order_no; end if;
    if (NEW.settlement_ledger_id is not null or NEW.cashback_ledger_id is not null or NEW.cod_settled_at is not null
        or NEW.delivery_share_ledger_id is not null or NEW.collector_share_ledger_id is not null)
       and (NEW.cod_hold_ledger_id is null or NEW.cod_settled_at is null or NEW.status <> 'approved') then
      raise exception 'Retail order % can only settle from an approved order with a collector hold', OLD.order_no;
    end if;
    if NEW.collector_status = 'approved' and NEW.cod_hold_ledger_id is null then
      raise exception 'Retail order % collector approval requires the coin hold', OLD.order_no;
    end if;
    if NEW.cod_hold_ledger_id is not null and (NEW.collector_id is null or NEW.collector_status <> 'approved') then
      raise exception 'Retail order % collector cannot change while coins are held', OLD.order_no;
    end if;
    if NEW.cod_settled_at is not null and NEW.refund_ledger_id is not null then
      raise exception 'Retail order % cannot be both settled and released', OLD.order_no;
    end if;
  else
    if NEW.collector_id is not null or NEW.cod_hold_ledger_id is not null or NEW.cod_settled_at is not null then
      raise exception 'Retail order % is a cash order and has no collector float', OLD.order_no;
    end if;
  end if;
  return NEW;
end $$;