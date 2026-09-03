create or replace function public.retail_place_order(_ecosystem_id uuid, _items jsonb, _fulfillment text, _payment_method text, _address text default null, _notes text default null, _seller_id uuid default null, _client_ref uuid default null)
returns table(order_id uuid, order_no text, total numeric)
language plpgsql security definer set search_path = public as $$
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
  if not public.has_membership(_uid, _ecosystem_id) then
    raise exception 'Join this shop before ordering';
  end if;
  _universe := public.is_universe_shop(_ecosystem_id);

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
                             'seller_id', _seller, 'delivery_fee', _dfee,
                             'delivery_split', case when _payment_method = 'cod' then jsonb_build_object('delivery', _dpct, 'collector', _cpct) end,
                             'payment_method', _payment_method, 'fulfillment', _fulfillment));

  return query select _oid, _ono, _total;
end $$;
revoke all on function public.retail_place_order(uuid, jsonb, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.retail_place_order(uuid, jsonb, text, text, text, text, uuid, uuid) to authenticated;