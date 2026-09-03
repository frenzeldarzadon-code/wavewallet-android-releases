-- ---------- 1. product settings ----------
ALTER TABLE public.retail_products
  ADD COLUMN IF NOT EXISTS cashback_mode text NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS cashback_value numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.retail_products DROP CONSTRAINT IF EXISTS retail_products_cashback_mode_chk;
ALTER TABLE public.retail_products ADD CONSTRAINT retail_products_cashback_mode_chk
  CHECK (cashback_mode IN ('disabled','percent','fixed'));
ALTER TABLE public.retail_products DROP CONSTRAINT IF EXISTS retail_products_cashback_value_chk;
ALTER TABLE public.retail_products ADD CONSTRAINT retail_products_cashback_value_chk
  CHECK (cashback_value >= 0 AND (cashback_mode <> 'percent' OR cashback_value <= 100));

-- ---------- 2. order snapshots ----------
ALTER TABLE public.retail_order_items
  ADD COLUMN IF NOT EXISTS cashback_mode text NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS cashback_value numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.retail_orders
  ADD COLUMN IF NOT EXISTS seller_id uuid,
  ADD COLUMN IF NOT EXISTS cashback_recipient_id uuid,
  ADD COLUMN IF NOT EXISTS cashback_total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_ledger_id uuid REFERENCES public.credit_ledger(id);

-- ---------- 3. cashback earner resolution ----------
-- Same precedence as the live Universe voucher engine: a buying reseller /
-- subreseller earns their own cashback; otherwise the storefront seller when
-- they are a reseller / subreseller; otherwise nobody (the shop admin keeps the
-- whole seller amount at settlement — the approved direct-shop behaviour).
CREATE OR REPLACE FUNCTION public.retail_cashback_recipient(_buyer uuid, _seller uuid, _ecosystem_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _role public.app_role;
begin
  if _buyer is null or _ecosystem_id is null then return null; end if;
  select m.role into _role from public.ecosystem_memberships m
   where m.user_id = _buyer and m.ecosystem_id = _ecosystem_id and m.membership_state = 'active';
  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _buyer and ur.ecosystem_id = _ecosystem_id
     order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
  end if;
  if _role in ('reseller','subreseller') then return _buyer; end if;

  if _seller is null or _seller = _buyer then return null; end if;
  _role := null;
  select m.role into _role from public.ecosystem_memberships m
   where m.user_id = _seller and m.ecosystem_id = _ecosystem_id and m.membership_state = 'active';
  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _seller and ur.ecosystem_id = _ecosystem_id
     order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
  end if;
  if _role in ('reseller','subreseller') then return _seller; end if;
  return null;
end $$;

-- Cashback for one line from the ACTUAL seller amount paid (wholesale-aware,
-- fee excluded). Fixed = per unit, capped so cashback never exceeds the line.
CREATE OR REPLACE FUNCTION public.retail_line_cashback(_mode text, _value numeric, _seller_line numeric, _qty integer)
RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  select case
    when _mode = 'percent' then least(round(coalesce(_seller_line,0) * coalesce(_value,0) / 100.0, 2), round(coalesce(_seller_line,0),2))
    when _mode = 'fixed'   then least(round(coalesce(_value,0) * coalesce(_qty,0), 2), round(coalesce(_seller_line,0),2))
    else 0::numeric end;
$$;

-- ---------- 4. order placement ----------
DROP FUNCTION IF EXISTS public.retail_place_order(uuid, jsonb, text, text, text, text);

CREATE OR REPLACE FUNCTION public.retail_place_order(
  _ecosystem_id uuid, _items jsonb, _fulfillment text, _payment_method text,
  _address text DEFAULT NULL, _notes text DEFAULT NULL, _seller_id uuid DEFAULT NULL)
RETURNS TABLE(order_id uuid, order_no text, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  _uid uuid := public.effective_uid();
  _eco record; _item jsonb; _p record; _qty int;
  _total numeric(14,2) := 0; _seller_total numeric(14,2) := 0; _fee_total numeric(14,2) := 0;
  _cb_total numeric(14,2) := 0; _cb_line numeric(14,2);
  _pct numeric(6,2); _unit numeric(12,2); _wholesale boolean;
  _seller_line numeric(14,2); _fee_line numeric(14,2); _line numeric(14,2);
  _oid uuid; _ono text; _acct uuid; _name text; _tx text; _hold uuid;
  _universe boolean; _seller uuid; _cb_recipient uuid;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  perform public.assert_actor_active();
  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco is null or _eco.archived_at is not null then raise exception 'Shop not found'; end if;
  if not _eco.store_retail_enabled then raise exception 'This shop has no retail store'; end if;
  if coalesce(_eco.operations_frozen, false) or _eco.frozen_at is not null then
    raise exception 'This shop is temporarily frozen by the platform owner';
  end if;
  if not public.subscription_ok(_ecosystem_id) then raise exception 'This shop is temporarily unavailable'; end if;
  if not public.has_membership(_uid, _ecosystem_id) then
    raise exception 'Join this shop before ordering';
  end if;
  _universe := public.is_universe_shop(_ecosystem_id);

  -- Storefront seller attribution: Universe only, authorized sellers only.
  if _seller_id is not null and _seller_id <> _uid then
    if not _universe then
      raise exception 'Seller storefronts are only available in Universe shops';
    end if;
    if not exists (select 1 from public.shop_seller_authorizations a
                    where a.ecosystem_id = _ecosystem_id and a.user_id = _seller_id and a.active) then
      raise exception 'That seller is not authorized to sell for this shop';
    end if;
    _seller := _seller_id;
  end if;

  if _fulfillment not in ('pickup','delivery') then raise exception 'Choose pickup or delivery'; end if;
  if _fulfillment = 'pickup' and not _eco.retail_pickup_enabled then
    raise exception 'This shop does not offer pickup'; end if;
  if _fulfillment = 'delivery' then
    if not _eco.retail_delivery_enabled then raise exception 'This shop does not offer delivery'; end if;
    if btrim(coalesce(_address, '')) = '' then raise exception 'A delivery address is required'; end if;
  end if;
  if _payment_method not in ('cash','credit') then raise exception 'Choose a payment method'; end if;
  if _payment_method = 'cash' and not _eco.retail_cash_enabled then
    raise exception 'This shop does not accept cash'; end if;
  if _payment_method = 'credit' and not _eco.retail_credit_enabled then
    raise exception 'This shop does not accept coin payment'; end if;
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'Your cart is empty';
  end if;

  _pct := round(public.retail_platform_fee_percent(), 2);
  -- Coin cashback is only ever funded by a coin sale: cash orders move no coins.
  _cb_recipient := case when _payment_method = 'credit'
                        then public.retail_cashback_recipient(_uid, _seller, _ecosystem_id) end;

  select coalesce(full_name, 'Member') into _name from public.profiles where id = _uid;
  _ono := 'RO-' || to_char(now(), 'YYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));

  insert into public.retail_orders
    (order_no, ecosystem_id, customer_id, customer_name, fulfillment, delivery_address,
     delivery_notes, payment_method, total, seller_total, platform_fee_percent, platform_fee_amount,
     seller_id, cashback_recipient_id, cashback_total)
  values (_ono, _ecosystem_id, _uid, _name, _fulfillment,
          nullif(btrim(coalesce(_address,'')), ''), nullif(btrim(coalesce(_notes,'')), ''),
          _payment_method, 0, 0, _pct, 0, _seller, _cb_recipient, 0)
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
    -- Cashback base = the actual seller amount paid for the line (never the fee,
    -- never the undiscounted regular price). Earned only when someone qualifies.
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

  if _payment_method = 'credit' then
    _acct := public.retail_wallet_for(_uid, _ecosystem_id);
    _tx := public.new_tx_id();
    insert into public.credit_ledger
      (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference,
       actor_id, tx_id, entry_kind)
    values (_acct, _uid, _ecosystem_id, 'debit', _total, 0,
            'Retail order hold — ' || _ono, _ono, _uid, _tx, 'retail_hold')
    returning id into _hold;
    update public.retail_orders
       set credit_hold_tx = _tx, hold_ledger_id = _hold, wallet_account_id = _acct
     where id = _oid;
  end if;

  update public.retail_orders
     set total = _total, seller_total = _seller_total, platform_fee_amount = _fee_total,
         cashback_total = _cb_total
   where id = _oid;

  perform public.notify_member(u.user_id, _ecosystem_id, 'retail_order',
    'New retail order ' || _ono,
    _name || ' placed a ' || _payment_method || ' order worth ' || _total::text || ' coins.',
    '/admin/orders')
    from public.user_roles u
   where u.ecosystem_id = _ecosystem_id and u.role = 'admin';

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, _uid, _name, 'Placed retail order', _ono,
          jsonb_build_object('order_id', _oid, 'total', _total, 'seller_total', _seller_total,
                             'platform_fee_percent', _pct, 'platform_fee_amount', _fee_total,
                             'cashback_total', _cb_total, 'cashback_recipient_id', _cb_recipient,
                             'seller_id', _seller,
                             'payment_method', _payment_method, 'fulfillment', _fulfillment));

  return query select _oid, _ono, _total;
end $$;

-- ---------- 5. approval: admin remainder + one-shot cashback ----------
CREATE OR REPLACE FUNCTION public.retail_review_order(_order_id uuid, _approve boolean, _note text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _o public.retail_orders; _actor text; _it record; _eco record;
        _recipient uuid; _racct uuid; _settle uuid; _refund uuid; _cb_ledger uuid; _cbacct uuid;
        _seller numeric(14,2); _fee numeric(14,2); _cb numeric(14,2) := 0; _admin_amt numeric(14,2);
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
      -- Cashback is carved out of the seller amount (never out of the fee, never
      -- on top of the sale): admin gets the remainder, the earner gets cashback.
      _cb := case when _o.cashback_recipient_id is not null and not public.is_super_admin(_o.cashback_recipient_id)
                  then coalesce(_o.cashback_total, 0) else 0 end;
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
      if _cb > 0 then
        -- Unique tx_id (hold tx + '-CB') makes a second cashback credit impossible.
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
                             'cashback_recipient_id', _o.cashback_recipient_id,
                             'customer_id', _o.customer_id, 'note', _note,
                             'settlement_ledger_id', _settle, 'cashback_ledger_id', _cb_ledger,
                             'refund_ledger_id', _refund));
end $$;

GRANT EXECUTE ON FUNCTION public.retail_place_order(uuid, jsonb, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retail_cashback_recipient(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retail_line_cashback(text, numeric, numeric, integer) TO authenticated, anon;