-- 1. Audit fields on retail_orders
alter table public.retail_orders
  add column if not exists buyer_charge numeric(14,2),
  add column if not exists self_cashback numeric(14,2) not null default 0;
comment on column public.retail_orders.buyer_charge is 'Net amount actually held/charged from the buyer wallet (total minus self_cashback). Null for cash/COD orders.';
comment on column public.retail_orders.self_cashback is 'Cashback deducted at checkout because the buyer is the entitled cashback recipient (self purchase). Never paid out separately.';

-- 2. Immutable snapshot guard now also covers the new fields
CREATE OR REPLACE FUNCTION public.retail_orders_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
     or NEW.buyer_charge is distinct from OLD.buyer_charge
     or NEW.self_cashback is distinct from OLD.self_cashback
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
end $function$;

-- 3. Peso formatting helper for ledger descriptions
CREATE OR REPLACE FUNCTION public.retail_peso(_amount numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select '₱' || to_char(round(coalesce(_amount, 0), 2), 'FM999,999,999,990.00');
$function$;

-- 4. Self-purchase detection: the buyer IS the entitled cashback recipient.
--    Reuses retail_cashback_recipient (buying reseller only) — no new hierarchy.
CREATE OR REPLACE FUNCTION public.retail_is_self_purchase(_buyer uuid, _seller uuid, _ecosystem_id uuid, _payment_method text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select _payment_method = 'credit'
     and _buyer is not null
     and public.retail_cashback_recipient(_buyer, _seller, _ecosystem_id) = _buyer
     and not public.is_super_admin(_buyer);
$function$;

-- 5. Checkout quote: server-computed retail total / self cashback / actual charge.
--    Read-only, never trusts client amounts. Mirrors retail_place_order exactly.
CREATE OR REPLACE FUNCTION public.retail_checkout_quote(_ecosystem_id uuid, _items jsonb, _seller_id uuid DEFAULT NULL::uuid, _payment_method text DEFAULT 'credit')
 RETURNS TABLE(total numeric, self_cashback numeric, buyer_charge numeric, self_purchase boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := public.effective_uid();
  _item jsonb; _p record; _qty int; _pct numeric(6,2); _unit numeric(12,2); _wholesale boolean;
  _seller_line numeric(14,2); _fee_line numeric(14,2);
  _total numeric(14,2) := 0; _cb numeric(14,2) := 0; _seller_total numeric(14,2) := 0;
  _self boolean := false; _seller uuid;
begin
  if _uid is null then return query select 0::numeric, 0::numeric, 0::numeric, false; return; end if;
  if _seller_id is not null and _seller_id <> _uid then _seller := _seller_id; end if;
  _self := public.retail_is_self_purchase(_uid, _seller, _ecosystem_id, _payment_method);
  _pct := round(public.retail_platform_fee_percent(), 2);
  if _items is null or jsonb_typeof(_items) <> 'array' then
    return query select 0::numeric, 0::numeric, 0::numeric, _self; return;
  end if;
  for _item in select * from jsonb_array_elements(_items) loop
    _qty := greatest(coalesce((_item->>'quantity')::int, 0), 0);
    if _qty = 0 then continue; end if;
    select * into _p from public.retail_products
     where id = (_item->>'product_id')::uuid and ecosystem_id = _ecosystem_id
       and active and published and not archived;
    if _p is null then continue; end if;
    _wholesale := coalesce(_p.wholesale_price, 0) > 0 and coalesce(_p.wholesale_min_qty, 0) > 0 and _qty >= _p.wholesale_min_qty;
    _unit := case when _wholesale then _p.wholesale_price else _p.price end;
    _seller_line := round(_unit * _qty, 2);
    _fee_line := round(_seller_line * _pct / 100, 2);
    _total := _total + _seller_line + _fee_line;
    _seller_total := _seller_total + _seller_line;
    if _self then
      _cb := _cb + public.retail_line_cashback(_p.cashback_mode, _p.cashback_value, _seller_line, _qty);
    end if;
  end loop;
  _cb := least(_cb, _seller_total, _total);
  return query select _total, _cb, round(_total - _cb, 2), _self;
end $function$;

GRANT EXECUTE ON FUNCTION public.retail_checkout_quote(uuid, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retail_checkout_quote(uuid, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retail_is_self_purchase(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retail_is_self_purchase(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retail_peso(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retail_peso(numeric) TO service_role;

-- 6. retail_place_order: membership no longer required; self purchase nets the cashback
--    into ONE hold entry. Everything else byte-for-byte as before.
CREATE OR REPLACE FUNCTION public.retail_place_order(_ecosystem_id uuid, _items jsonb, _fulfillment text, _payment_method text, _address text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _seller_id uuid DEFAULT NULL::uuid, _client_ref uuid DEFAULT NULL::uuid)
 RETURNS TABLE(order_id uuid, order_no text, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := public.effective_uid();
  _eco record; _item jsonb; _p record; _qty int;
  _total numeric(14,2) := 0; _seller_total numeric(14,2) := 0; _fee_total numeric(14,2) := 0;
  _cb_total numeric(14,2) := 0; _cb_line numeric(14,2);
  _pct numeric(6,2); _unit numeric(12,2); _wholesale boolean;
  _seller_line numeric(14,2); _fee_line numeric(14,2); _line numeric(14,2);
  _oid uuid; _ono text; _acct uuid; _name text; _tx text; _hold uuid;
  _universe boolean; _seller uuid; _cb_recipient uuid; _dfee numeric(12,2) := 0; _dpct int; _cpct int;
  _dup record;
  _self boolean := false; _self_cb numeric(14,2) := 0; _charge numeric(14,2);
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  -- Idempotent replay: the same checkout attempt (client_ref) never creates a second order.
  if _client_ref is not null then
    select o.id, o.order_no, o.total into _dup
      from public.retail_orders o where o.customer_id = _uid and o.client_ref = _client_ref;
    if _dup.id is not null then return query select _dup.id, _dup.order_no, _dup.total; return; end if;
  end if;
  perform public.assert_actor_active();
  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco is null or _eco.archived_at is not null then raise exception 'Shop not found'; end if;
  if not _eco.store_retail_enabled then raise exception 'This shop has no retail store'; end if;
  if coalesce(_eco.operations_frozen, false) or _eco.frozen_at is not null then
    raise exception 'This shop is temporarily frozen by the platform owner';
  end if;
  if not public.subscription_ok(_ecosystem_id) then raise exception 'This shop is temporarily unavailable'; end if;
  _universe := public.is_universe_shop(_ecosystem_id);
  -- Universe is the customer portal: any signed-in, active member may buy from a
  -- Universe shop. New Generation shops still pay from the shop wallet, which
  -- only exists for members (retail_wallet_for enforces that).
  if not _universe and not public.has_membership(_uid, _ecosystem_id) then
    raise exception 'This shop only sells to its own members';
  end if;

  if _seller_id is not null and _seller_id <> _uid then
    if not _universe then
      raise exception 'Seller storefronts are only available in Universe shops';
    end if;
    if not exists (select 1 from public.shop_seller_authorizations a
                    where a.ecosystem_id = _ecosystem_id and a.user_id = _seller_id and a.active) then
      raise exception 'That seller is not authorized to sell for this shop';
    end if;
    if not public.retail_seller_allowed(_seller_id, _ecosystem_id) then
      raise exception 'Retail storefronts are run by the shop admin or a reseller'; end if;
    _seller := _seller_id;
  end if;

  if _fulfillment not in ('pickup','delivery') then raise exception 'Choose pickup or delivery'; end if;
  if _fulfillment = 'pickup' and not _eco.retail_pickup_enabled then
    raise exception 'This shop does not offer pickup'; end if;
  if _fulfillment = 'delivery' then
    if not _eco.retail_delivery_enabled then raise exception 'This shop does not offer delivery'; end if;
    if btrim(coalesce(_address, '')) = '' then raise exception 'A delivery address is required'; end if;
  end if;
  if _payment_method not in ('cash','credit','cod') then raise exception 'Choose a payment method'; end if;
  if _payment_method = 'cash' and not _eco.retail_cash_enabled then
    raise exception 'This shop does not accept cash'; end if;
  if _payment_method = 'credit' and not _eco.retail_credit_enabled then
    raise exception 'This shop does not accept coin payment'; end if;
  if _payment_method = 'cod' then
    if not _universe then raise exception 'Cash on delivery is only available in Universe shops'; end if;
    if not _eco.retail_cod_enabled then raise exception 'This shop does not offer cash on delivery'; end if;
    if _fulfillment <> 'delivery' then raise exception 'Cash on delivery requires delivery'; end if;
    _dpct := _eco.retail_delivery_split_delivery_pct; _cpct := _eco.retail_delivery_split_collector_pct;
    if coalesce(_dpct, 0) + coalesce(_cpct, 0) <> 100 then
      raise exception 'Cash on delivery is not fully configured for this shop';
    end if;
    _dfee := round(coalesce(_eco.retail_delivery_fee, 0), 2);
  end if;
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'Your cart is empty';
  end if;

  _pct := round(public.retail_platform_fee_percent(), 2);
  _cb_recipient := case when _payment_method in ('credit','cod')
                        then public.retail_cashback_recipient(_uid, _seller, _ecosystem_id) end;
  -- Self purchase: the buyer is the entitled cashback recipient and pays with coins.
  _self := public.retail_is_self_purchase(_uid, _seller, _ecosystem_id, _payment_method);

  select coalesce(full_name, 'Member') into _name from public.profiles where id = _uid;
  _ono := 'RO-' || to_char(now(), 'YYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));

  insert into public.retail_orders
    (order_no, ecosystem_id, customer_id, customer_name, fulfillment, delivery_address,
     delivery_notes, payment_method, total, seller_total, platform_fee_percent, platform_fee_amount,
     seller_id, cashback_recipient_id, cashback_total,
     delivery_fee, delivery_split_delivery_pct, delivery_split_collector_pct, client_ref)
  values (_ono, _ecosystem_id, _uid, _name, _fulfillment,
          nullif(btrim(coalesce(_address,'')), ''), nullif(btrim(coalesce(_notes,'')), ''),
          _payment_method, 0, 0, _pct, 0, _seller, _cb_recipient, 0,
          _dfee, _dpct, _cpct, _client_ref)
  returning id into _oid;

  for _item in select * from jsonb_array_elements(_items) loop
    _qty := greatest(coalesce((_item->>'quantity')::int, 0), 0);
    if _qty = 0 then continue; end if;
    select * into _p from public.retail_products
     where id = (_item->>'product_id')::uuid and ecosystem_id = _ecosystem_id
       and active and published and not archived
     for update;
    if _p is null then raise exception 'A product in your cart is no longer available'; end if;
    if _p.stock < _qty then
      raise exception '% has only % left', _p.name, _p.stock;
    end if;

    _wholesale := coalesce(_p.wholesale_price, 0) > 0
              and coalesce(_p.wholesale_min_qty, 0) > 0
              and _qty >= _p.wholesale_min_qty;
    _unit := case when _wholesale then _p.wholesale_price else _p.price end;
    _seller_line := round(_unit * _qty, 2);
    _fee_line := round(_seller_line * _pct / 100, 2);
    _line := _seller_line + _fee_line;
    _cb_line := case when _cb_recipient is null then 0
                     else public.retail_line_cashback(_p.cashback_mode, _p.cashback_value, _seller_line, _qty) end;

    update public.retail_products set stock = stock - _qty where id = _p.id;
    insert into public.retail_order_items
      (order_id, product_id, product_name, unit_price, quantity, line_total,
       regular_unit_price, wholesale_applied, seller_line_total, fee_amount,
       cashback_mode, cashback_value, cashback_amount)
    values (_oid, _p.id, _p.name, _unit, _qty, _line,
            _p.price, _wholesale, _seller_line, _fee_line,
            _p.cashback_mode, _p.cashback_value, _cb_line);
    _seller_total := _seller_total + _seller_line;
    _fee_total := _fee_total + _fee_line;
    _cb_total := _cb_total + _cb_line;
    _total := _total + _line;
  end loop;

  if _seller_total <= 0 then raise exception 'Your cart is empty'; end if;
  if _cb_total > _seller_total then raise exception 'Cashback cannot exceed the seller amount'; end if;

  if _payment_method = 'cod' and not public.retail_cod_seller_funded(_ecosystem_id, _fee_total) then
    raise exception 'Cash on delivery is temporarily unavailable for this shop';
  end if;

  -- Net charge: a self purchase deducts the entitled cashback at checkout, once,
  -- inside the single hold entry. Cashback can never exceed the retail total.
  _self_cb := case when _self then least(_cb_total, _total) else 0 end;
  _charge := case when _payment_method = 'credit' then round(_total - _self_cb, 2) end;

  if _payment_method = 'credit' then
    _acct := public.retail_wallet_for(_uid, _ecosystem_id);
    _tx := public.new_tx_id();
    insert into public.credit_ledger
      (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference,
       actor_id, tx_id, entry_kind, base_amount, commission_amount)
    values (_acct, _uid, _ecosystem_id, 'debit', _charge, 0,
            case when _self_cb > 0
                 then 'Self purchase ' || _ono || ' — ' || public.retail_peso(_total) || ' − '
                      || public.retail_peso(_self_cb) || ' cashback = ' || public.retail_peso(_charge)
                 else 'Retail order hold — ' || _ono end,
            _ono, _uid, _tx, 'retail_hold',
            case when _self_cb > 0 then _total end,
            case when _self_cb > 0 then _self_cb end)
    returning id into _hold;
    update public.retail_orders
       set credit_hold_tx = _tx, hold_ledger_id = _hold, wallet_account_id = _acct
     where id = _oid;
  end if;

  update public.retail_orders
     set total = _total, seller_total = _seller_total, platform_fee_amount = _fee_total,
         cashback_total = _cb_total, buyer_charge = _charge, self_cashback = _self_cb
   where id = _oid;

  perform public.notify_member(u.user_id, _ecosystem_id, 'retail_order',
    'New retail order ' || _ono,
    _name || ' placed a ' || case _payment_method when 'cod' then 'cash-on-delivery' else _payment_method end
      || ' order worth ' || (_total + _dfee)::text || ' coins.',
    '/admin/orders')
    from public.user_roles u
   where u.ecosystem_id = _ecosystem_id and u.role = 'admin';

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, _uid, _name, 'Placed retail order', _ono,
          jsonb_build_object('order_id', _oid, 'total', _total, 'seller_total', _seller_total,
                             'platform_fee_percent', _pct, 'platform_fee_amount', _fee_total,
                             'cashback_total', _cb_total, 'cashback_recipient_id', _cb_recipient,
                             'self_purchase', _self, 'self_cashback', _self_cb, 'buyer_charge', _charge,
                             'seller_id', _seller, 'delivery_fee', _dfee,
                             'delivery_split', case when _payment_method = 'cod' then jsonb_build_object('delivery', _dpct, 'collector', _cpct) end,
                             'payment_method', _payment_method, 'fulfillment', _fulfillment));

  return query select _oid, _ono, _total;
end $function$;

-- 7. Refund returns exactly what was held (net amount on a self purchase)
CREATE OR REPLACE FUNCTION public.retail_refund_hold(_order retail_orders, _actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _acct uuid; _refund uuid; _held numeric(14,2); _expected numeric(14,2);
begin
  if _order.payment_method <> 'credit' or (_order.hold_ledger_id is null and _order.credit_hold_tx is null) then
    return null;
  end if;
  if _order.credit_released or _order.refund_ledger_id is not null
     or _order.settlement_ledger_id is not null or _order.cashback_ledger_id is not null then
    return null;
  end if;
  select amount into _held from public.credit_ledger where id = _order.hold_ledger_id and direction = 'debit';
  _expected := coalesce(_order.buyer_charge, _order.total);
  if _held is null or _held <> _expected then
    raise exception 'Retail order % hold does not match its charge', _order.order_no;
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
end $function$;

-- 8. Approval: a self purchase never pays a separate cashback credit.
--    Admin still receives seller amount minus cashback; the platform fee is unchanged.
CREATE OR REPLACE FUNCTION public.retail_review_order(_order_id uuid, _approve boolean, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _o public.retail_orders; _actor text; _it record; _eco record;
        _recipient uuid; _racct uuid; _settle uuid; _refund uuid; _cb_ledger uuid; _cbacct uuid;
        _seller numeric(14,2); _fee numeric(14,2); _cb numeric(14,2) := 0; _admin_amt numeric(14,2);
        _self_cb numeric(14,2) := 0;
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _o.ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Only the shop admin can review orders';
  end if;
  if _o.status <> 'pending' then
    raise exception 'This order was already %', _o.status;
  end if;

  select coalesce(full_name, 'Admin') into _actor from public.profiles where id = auth.uid();

  if _approve then
    select * into _eco from public.ecosystems where id = _o.ecosystem_id;
    if coalesce(_eco.operations_frozen, false) or _eco.frozen_at is not null then
      raise exception 'This shop is temporarily frozen by the platform owner';
    end if;

    if _o.payment_method = 'credit' and (_o.hold_ledger_id is null or _o.credit_hold_tx is null) then
      raise exception 'Retail order % has no payment hold and cannot be approved', _o.order_no;
    end if;
    if _o.payment_method = 'credit' and _o.hold_ledger_id is not null then
      if _o.settlement_ledger_id is not null or _o.credit_released or _o.cashback_ledger_id is not null then
        raise exception 'This order was already settled or refunded';
      end if;
      _recipient := public.retail_settlement_recipient(_o.ecosystem_id);
      if _recipient is null then
        raise exception 'This shop has no active admin to receive the payment';
      end if;
      _seller := coalesce(_o.seller_total, _o.total);
      _fee := coalesce(_o.platform_fee_amount, 0);
      if _seller + _fee <> _o.total then
        raise exception 'Order pricing snapshot is inconsistent';
      end if;
      _self_cb := coalesce(_o.self_cashback, 0);
      if _self_cb > 0 then
        -- Self purchase: cashback was already netted out of the buyer's hold.
        _cb := _self_cb;
        if coalesce(_o.buyer_charge, 0) <> round(_o.total - _self_cb, 2) then
          raise exception 'Order self-purchase snapshot is inconsistent';
        end if;
      else
        _cb := case when _o.cashback_recipient_id is not null and not public.is_super_admin(_o.cashback_recipient_id)
                    then coalesce(_o.cashback_total, 0) else 0 end;
      end if;
      if _cb < 0 or _cb > _seller then
        raise exception 'Order cashback snapshot is inconsistent';
      end if;
      _admin_amt := round(_seller - _cb, 2);

      _racct := public.retail_wallet_for(_recipient, _o.ecosystem_id);
      if _admin_amt > 0 then
        insert into public.credit_ledger
          (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference,
           actor_id, tx_id, entry_kind)
        values (_racct, _recipient, _o.ecosystem_id, 'credit', _admin_amt, 0,
                'Retail sale — ' || _o.order_no || ' (' || _o.customer_name || ')'
                  || case when _cb > 0 then ' after ' || _cb::text || ' coins cashback' else '' end,
                _o.order_no, _o.customer_id, _o.credit_hold_tx || '-S', 'retail_settlement')
        returning id into _settle;
      end if;
      if _cb > 0 and _self_cb = 0 then
        _cbacct := public.retail_wallet_for(_o.cashback_recipient_id, _o.ecosystem_id);
        insert into public.credit_ledger
          (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference,
           actor_id, tx_id, entry_kind, base_amount, commission_amount)
        values (_cbacct, _o.cashback_recipient_id, _o.ecosystem_id, 'credit', _cb, 0,
                'Retail cashback — ' || _o.order_no || ' (' || _o.customer_name || ')',
                _o.order_no, _o.customer_id, _o.credit_hold_tx || '-CB', 'retail_cashback',
                _seller, _cb)
        returning id into _cb_ledger;
      end if;
      if _fee > 0 then
        insert into public.retail_platform_fees
          (order_id, ecosystem_id, tx_id, seller_credits, fee_percent, fee_credits)
        values (_o.id, _o.ecosystem_id, _o.credit_hold_tx || '-F', _seller,
                coalesce(_o.platform_fee_percent, 0), _fee)
        on conflict (order_id) do nothing;
      end if;
    end if;

    update public.retail_products p
       set sold_count = p.sold_count + i.quantity
      from public.retail_order_items i
     where i.order_id = _o.id and p.id = i.product_id;
    update public.retail_orders
       set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(coalesce(_note,'')), ''),
           settlement_ledger_id = coalesce(_settle, settlement_ledger_id),
           settled_to = case when _settle is not null then _recipient else settled_to end,
           cashback_ledger_id = coalesce(_cb_ledger, cashback_ledger_id)
     where id = _o.id and status = 'pending';
    if _o.fulfillment = 'delivery' then perform public.retail_sync_order_chat(_o.id); end if;
  else
    for _it in select * from public.retail_order_items where order_id = _o.id loop
      update public.retail_products set stock = stock + _it.quantity where id = _it.product_id;
    end loop;
    _refund := public.retail_refund_hold(_o, auth.uid());
    update public.retail_orders
       set status = 'rejected', credit_released = true, decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(coalesce(_note,'')), ''),
           refund_ledger_id = coalesce(_refund, refund_ledger_id)
     where id = _o.id and status = 'pending';
  end if;

  perform public.notify_member(_o.customer_id, _o.ecosystem_id, 'retail_order',
    'Order ' || _o.order_no || (case when _approve then ' approved' else ' rejected' end),
    coalesce(nullif(btrim(coalesce(_note,'')), ''),
             case when _approve then 'Your order is confirmed.' else 'Your order was rejected and nothing was charged.' end),
    '/app/store');

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, auth.uid(), _actor,
          case when _approve then 'Approved retail order' else 'Rejected retail order' end,
          _o.order_no,
          jsonb_build_object('order_id', _o.id, 'total', _o.total, 'seller_total', _seller,
                             'platform_fee_amount', _fee, 'cashback_total', _cb,
                             'self_cashback', _self_cb, 'buyer_charge', _o.buyer_charge,
                             'cashback_recipient_id', _o.cashback_recipient_id,
                             'customer_id', _o.customer_id, 'note', _note,
                             'settlement_ledger_id', _settle, 'cashback_ledger_id', _cb_ledger,
                             'refund_ledger_id', _refund));
end $function$;

-- 9. Buyer order history: expose the actual charge + self cashback
DROP FUNCTION IF EXISTS public.my_retail_orders(uuid);
CREATE FUNCTION public.my_retail_orders(_ecosystem_id uuid)
 RETURNS TABLE(id uuid, order_no text, status text, fulfillment text, fulfillment_status text, delivered_at timestamp with time zone, completed_at timestamp with time zone, shop_name text, seller_name text, delivery_address text, delivery_notes text, payment_method text, total numeric, seller_total numeric, platform_fee_percent numeric, platform_fee_amount numeric, decision_note text, created_at timestamp with time zone, items jsonb, delivery_fee numeric, self_delivery boolean, delivery_person_name text, collector_name text, collector_status text, hold_held boolean, cod_settled_at timestamp with time zone, chat_thread_id uuid, buyer_charge numeric, self_cashback numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Customer-facing: the internal seller-cut / platform-fee split is never part of this payload.
  select o.id, o.order_no, o.status, o.fulfillment, o.fulfillment_status, o.delivered_at, o.completed_at,
         (select e.name from public.ecosystems e where e.id = o.ecosystem_id),
         (select p.full_name from public.profiles p where p.id = o.seller_id),
         o.delivery_address, o.delivery_notes, o.payment_method, o.total,
         o.total, 0::numeric, 0::numeric,
         o.decision_note, o.created_at,
         coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity,
                    'unit_price', i.unit_price, 'line_total', i.line_total, 'product_id', i.product_id,
                    'regular_unit_price', coalesce(i.regular_unit_price, i.unit_price),
                    'wholesale_applied', i.wholesale_applied,
                    'seller_line_total', i.line_total,
                    'fee_amount', 0) order by i.product_name)
                    from public.retail_order_items i where i.order_id = o.id), '[]'::jsonb),
         o.delivery_fee, o.self_delivery,
         (select p.full_name from public.profiles p where p.id = o.delivery_person_id),
         case when o.collector_status = 'approved' then (select p.full_name from public.profiles p where p.id = o.collector_id) end,
         o.collector_status,
         o.cod_hold_ledger_id is not null and o.cod_settled_at is null and o.refund_ledger_id is null,
         o.cod_settled_at, o.chat_thread_id,
         o.buyer_charge, o.self_cashback
    from public.retail_orders o
   where o.ecosystem_id = _ecosystem_id and o.customer_id = public.effective_uid()
   order by o.created_at desc
   limit 100;
$function$;
GRANT EXECUTE ON FUNCTION public.my_retail_orders(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_retail_orders(uuid) TO service_role;

-- 10. Shop-side order list: cashback column also reflects a netted self purchase
CREATE OR REPLACE FUNCTION public.list_retail_orders(_ecosystem_id uuid, _status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, order_no text, customer_id uuid, customer_name text, status text, fulfillment text, fulfillment_status text, delivered_at timestamp with time zone, completed_at timestamp with time zone, seller_id uuid, seller_name text, delivery_address text, delivery_notes text, payment_method text, total numeric, seller_total numeric, platform_fee_percent numeric, platform_fee_amount numeric, decision_note text, created_at timestamp with time zone, items jsonb, delivery_fee numeric, delivery_split_delivery_pct integer, delivery_split_collector_pct integer, self_delivery boolean, delivery_person_id uuid, delivery_person_name text, collector_id uuid, collector_name text, collector_status text, hold_held boolean, cod_expected_cash numeric, cod_actual_cash numeric, cod_cash_received_at timestamp with time zone, cod_discrepancy boolean, cod_settled_at timestamp with time zone, cod_settlement_kind text, seller_amount numeric, cashback_amount numeric, delivery_share_amount numeric, collector_share_amount numeric, chat_thread_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.id, o.order_no, o.customer_id, o.customer_name, o.status, o.fulfillment,
         o.fulfillment_status, o.delivered_at, o.completed_at, o.seller_id,
         (select p.full_name from public.profiles p where p.id = o.seller_id),
         o.delivery_address, o.delivery_notes, o.payment_method, o.total,
         coalesce(o.seller_total, o.total), coalesce(o.platform_fee_percent, 0), coalesce(o.platform_fee_amount, 0),
         o.decision_note, o.created_at,
         coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity,
                    'unit_price', i.unit_price, 'line_total', i.line_total, 'product_id', i.product_id,
                    'regular_unit_price', coalesce(i.regular_unit_price, i.unit_price),
                    'wholesale_applied', i.wholesale_applied,
                    'seller_line_total', coalesce(i.seller_line_total, i.line_total),
                    'fee_amount', coalesce(i.fee_amount, 0)) order by i.product_name)
                    from public.retail_order_items i where i.order_id = o.id), '[]'::jsonb),
         o.delivery_fee, o.delivery_split_delivery_pct, o.delivery_split_collector_pct,
         o.self_delivery, o.delivery_person_id, (select p.full_name from public.profiles p where p.id = o.delivery_person_id),
         o.collector_id, (select p.full_name from public.profiles p where p.id = o.collector_id), o.collector_status,
         o.cod_hold_ledger_id is not null and o.cod_settled_at is null and o.refund_ledger_id is null,
         o.cod_expected_cash, o.cod_actual_cash, o.cod_cash_received_at, o.cod_discrepancy, o.cod_settled_at, o.cod_settlement_kind,
         (select l.amount from public.credit_ledger l where l.id = o.settlement_ledger_id),
         coalesce((select l.amount from public.credit_ledger l where l.id = o.cashback_ledger_id),
                  case when o.self_cashback > 0 and o.settlement_ledger_id is not null then o.self_cashback end),
         (select l.amount from public.credit_ledger l where l.id = o.delivery_share_ledger_id),
         (select l.amount from public.credit_ledger l where l.id = o.collector_share_ledger_id),
         o.chat_thread_id
    from public.retail_orders o
   where o.ecosystem_id = _ecosystem_id
     and (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())
          or (o.seller_id = auth.uid() and public.retail_seller_allowed(auth.uid(), _ecosystem_id)))
     and (_status is null or _status = 'all' or o.status = _status)
   order by o.created_at desc
   limit 200;
$function$;