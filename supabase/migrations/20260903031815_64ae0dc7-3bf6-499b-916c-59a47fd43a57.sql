-- Retail Phase R1: wallet routing, atomic settlement/refund, freeze protection,
-- public exposure fix. Additive only; no historical rows are touched.

alter table public.retail_orders
  add column if not exists wallet_account_id uuid references public.credit_accounts(id),
  add column if not exists hold_ledger_id uuid references public.credit_ledger(id),
  add column if not exists settlement_ledger_id uuid references public.credit_ledger(id),
  add column if not exists refund_ledger_id uuid references public.credit_ledger(id),
  add column if not exists settled_to uuid;

-- ---------------------------------------------------------------------------
-- Wallet resolution: Universe shops -> global wallet; Subscription shops ->
-- that shop's wallet only (never the global fallback). Internal helper.
-- ---------------------------------------------------------------------------
create or replace function public.retail_wallet_for(_user_id uuid, _ecosystem_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare _acct uuid;
begin
  if public.is_universe_shop(_ecosystem_id) then
    return public.ensure_global_wallet(_user_id);
  end if;
  perform public.ensure_membership_wallets(_user_id, _ecosystem_id);
  select id into _acct from public.credit_accounts
   where user_id = _user_id and ecosystem_id = _ecosystem_id;
  if _acct is null then
    raise exception 'No shop wallet for this member in this shop';
  end if;
  return _acct;
end $$;

revoke all on function public.retail_wallet_for(uuid, uuid) from public, anon, authenticated;

-- Shop admin who receives retail settlements (same lookup as voucher sales).
create or replace function public.retail_settlement_recipient(_ecosystem_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select ur.user_id from public.user_roles ur
       join public.profiles pr on pr.id = ur.user_id
      where ur.ecosystem_id = _ecosystem_id and ur.role = 'admin'
        and pr.deleted_at is null and pr.status = 'active'
      order by pr.joined_at limit 1),
    (select m.user_id from public.ecosystem_memberships m
       join public.profiles pr on pr.id = m.user_id
      where m.ecosystem_id = _ecosystem_id and m.role = 'admin' and m.membership_state = 'active'
        and pr.deleted_at is null and pr.status = 'active'
      order by pr.joined_at limit 1))
$$;

revoke all on function public.retail_settlement_recipient(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Place order
-- ---------------------------------------------------------------------------
create or replace function public.retail_place_order(
  _ecosystem_id uuid, _items jsonb, _fulfillment text, _payment_method text,
  _address text default null, _notes text default null)
returns table(order_id uuid, order_no text, total numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _uid uuid := public.effective_uid();
  _eco record; _item jsonb; _p record; _qty int; _total numeric(14,2) := 0;
  _oid uuid; _ono text; _acct uuid; _name text; _tx text; _hold uuid;
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

  select coalesce(full_name, 'Member') into _name from public.profiles where id = _uid;
  _ono := 'RO-' || to_char(now(), 'YYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));

  insert into public.retail_orders
    (order_no, ecosystem_id, customer_id, customer_name, fulfillment, delivery_address,
     delivery_notes, payment_method, total)
  values (_ono, _ecosystem_id, _uid, _name, _fulfillment,
          nullif(btrim(coalesce(_address,'')), ''), nullif(btrim(coalesce(_notes,'')), ''),
          _payment_method, 0)
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
    update public.retail_products set stock = stock - _qty where id = _p.id;
    insert into public.retail_order_items
      (order_id, product_id, product_name, unit_price, quantity, line_total)
    values (_oid, _p.id, _p.name, _p.price, _qty, round(_p.price * _qty, 2));
    _total := _total + round(_p.price * _qty, 2);
  end loop;

  if _total <= 0 then raise exception 'Your cart is empty'; end if;

  if _payment_method = 'credit' then
    -- Universe shop -> buyer's global wallet; New Generation -> that shop's wallet.
    _acct := public.retail_wallet_for(_uid, _ecosystem_id);
    _tx := public.new_tx_id();
    -- apply_credit_entry raises on insufficient balance, which rolls back the
    -- whole order (stock reservation included) — no orphaned hold is possible.
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

  update public.retail_orders set total = _total where id = _oid;

  perform public.notify_member(u.user_id, _ecosystem_id, 'retail_order',
    'New retail order ' || _ono,
    _name || ' placed a ' || _payment_method || ' order worth ' || _total::text || ' coins.',
    '/admin/orders')
    from public.user_roles u
   where u.ecosystem_id = _ecosystem_id and u.role = 'admin';

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, _uid, _name, 'Placed retail order', _ono,
          jsonb_build_object('order_id', _oid, 'total', _total,
                             'payment_method', _payment_method, 'fulfillment', _fulfillment));

  return query select _oid, _ono, _total;
end $$;

-- ---------------------------------------------------------------------------
-- Refund helper shared by reject + cancel (caller holds the row lock).
-- ---------------------------------------------------------------------------
create or replace function public.retail_refund_hold(_order public.retail_orders, _actor uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare _acct uuid; _refund uuid;
begin
  if _order.payment_method <> 'credit' or _order.hold_ledger_id is null and _order.credit_hold_tx is null then
    return null;
  end if;
  if _order.credit_released or _order.refund_ledger_id is not null or _order.settlement_ledger_id is not null then
    return null;
  end if;
  _acct := coalesce(_order.wallet_account_id,
                    public.retail_wallet_for(_order.customer_id, _order.ecosystem_id));
  insert into public.credit_ledger
    (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference,
     actor_id, tx_id, entry_kind, reverses_ledger_id)
  values (_acct, _order.customer_id, _order.ecosystem_id, 'credit', _order.total, 0,
          'Retail order refund — ' || _order.order_no, _order.order_no, _actor,
          coalesce(_order.credit_hold_tx, public.new_tx_id()) || '-R', 'retail_refund', _order.hold_ledger_id)
  returning id into _refund;
  return _refund;
end $$;

revoke all on function public.retail_refund_hold(public.retail_orders, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Review (approve = settle to the shop admin, reject = refund)
-- ---------------------------------------------------------------------------
create or replace function public.retail_review_order(_order_id uuid, _approve boolean, _note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _o public.retail_orders; _actor text; _it record; _eco record;
        _recipient uuid; _racct uuid; _settle uuid; _refund uuid;
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
      if _o.settlement_ledger_id is not null or _o.credit_released then
        raise exception 'This order was already settled or refunded';
      end if;
      _recipient := public.retail_settlement_recipient(_o.ecosystem_id);
      if _recipient is null then
        raise exception 'This shop has no active admin to receive the payment';
      end if;
      -- Recipient wallet follows the same shop-kind routing as the hold.
      _racct := public.retail_wallet_for(_recipient, _o.ecosystem_id);
      insert into public.credit_ledger
        (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference,
         actor_id, tx_id, entry_kind)
      values (_racct, _recipient, _o.ecosystem_id, 'credit', _o.total, 0,
              'Retail sale — ' || _o.order_no || ' (' || _o.customer_name || ')', _o.order_no,
              _o.customer_id, _o.credit_hold_tx || '-S', 'retail_settlement')
      returning id into _settle;
    end if;

    update public.retail_products p
       set sold_count = p.sold_count + i.quantity
      from public.retail_order_items i
     where i.order_id = _o.id and p.id = i.product_id;
    update public.retail_orders
       set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(coalesce(_note,'')), ''),
           settlement_ledger_id = coalesce(_settle, settlement_ledger_id),
           settled_to = case when _settle is not null then _recipient else settled_to end
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
          jsonb_build_object('order_id', _o.id, 'total', _o.total,
                             'customer_id', _o.customer_id, 'note', _note,
                             'settlement_ledger_id', _settle, 'refund_ledger_id', _refund));
end $$;

-- ---------------------------------------------------------------------------
-- Cancel (customer, pending only)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_retail_order(_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _o public.retail_orders; _it record; _refund uuid;
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.customer_id <> public.effective_uid() then raise exception 'Not your order'; end if;
  if _o.status <> 'pending' then raise exception 'This order was already %', _o.status; end if;
  for _it in select * from public.retail_order_items where order_id = _o.id loop
    update public.retail_products set stock = stock + _it.quantity where id = _it.product_id;
  end loop;
  _refund := public.retail_refund_hold(_o, public.effective_uid());
  update public.retail_orders
     set status = 'cancelled', credit_released = true, decided_at = now(),
         refund_ledger_id = coalesce(_refund, refund_ledger_id)
   where id = _o.id and status = 'pending';
end $$;

-- ---------------------------------------------------------------------------
-- Public exposure fix
-- ---------------------------------------------------------------------------
drop policy if exists "Public sees publicly listed retail products" on public.retail_products;

drop function if exists public.list_retail_products(uuid);
create function public.list_retail_products(_ecosystem_id uuid)
returns table(id uuid, name text, description text, image_path text, price numeric, stock integer,
              sold_count integer, public_visible boolean, rating_avg numeric, rating_count integer,
              brand text, variant text, size_label text, unit text, category text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.name, p.description, p.image_path, p.price, p.stock, p.sold_count, p.public_visible,
         coalesce((select round(avg(r.rating)::numeric,2) from public.retail_product_ratings r
                    where r.product_id = p.id), 0)::numeric,
         coalesce((select count(*)::int from public.retail_product_ratings r
                    where r.product_id = p.id), 0),
         p.brand, p.variant, p.size_label, p.unit, p.category
    from public.retail_products p
   where p.ecosystem_id = _ecosystem_id
     and p.active and p.published and not p.archived
     and (public.has_membership(auth.uid(), _ecosystem_id)
          or (p.public_visible and exists (select 1 from public.ecosystems e
                where e.id = _ecosystem_id and e.public_storefront_enabled and e.store_retail_enabled)))
   order by p.category nulls last, p.name;
$$;

grant execute on function public.list_retail_products(uuid) to anon, authenticated;