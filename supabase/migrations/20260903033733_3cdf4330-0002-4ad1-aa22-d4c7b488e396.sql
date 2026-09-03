-- ============================================================
-- Retail R2 — pricing foundation: wholesale (single tier) + additive platform fee
-- ============================================================

-- 1. Platform fee setting (existing platform_settings pattern)
alter table public.platform_settings
  add column if not exists retail_platform_fee_percent numeric not null default 1;
alter table public.platform_settings
  drop constraint if exists platform_settings_retail_fee_range;
alter table public.platform_settings
  add constraint platform_settings_retail_fee_range
  check (retail_platform_fee_percent >= 0 and retail_platform_fee_percent <= 100);

create or replace function public.retail_platform_fee_percent()
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce((select retail_platform_fee_percent from public.platform_settings where id = 1), 0)::numeric;
$$;
grant execute on function public.retail_platform_fee_percent() to anon, authenticated, service_role;

-- 2. Order-level snapshot
alter table public.retail_orders
  add column if not exists seller_total numeric(14,2),
  add column if not exists platform_fee_percent numeric(6,2),
  add column if not exists platform_fee_amount numeric(14,2);
update public.retail_orders
   set seller_total = total, platform_fee_percent = 0, platform_fee_amount = 0
 where seller_total is null;

-- 3. Item-level snapshot
alter table public.retail_order_items
  add column if not exists regular_unit_price numeric(12,2),
  add column if not exists wholesale_applied boolean not null default false,
  add column if not exists seller_line_total numeric(14,2),
  add column if not exists fee_amount numeric(14,2);
update public.retail_order_items
   set regular_unit_price = unit_price, seller_line_total = line_total, fee_amount = 0
 where seller_line_total is null;

-- 4. Collected platform fees (mirrors shop_transfer_fees)
create table if not exists public.retail_platform_fees (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.retail_orders(id) on delete cascade,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  tx_id text not null,
  seller_credits numeric(14,2) not null,
  fee_percent numeric(6,2) not null,
  fee_credits numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (order_id)
);
grant select on public.retail_platform_fees to authenticated;
grant all on public.retail_platform_fees to service_role;
alter table public.retail_platform_fees enable row level security;
drop policy if exists "Platform owner reads retail fees" on public.retail_platform_fees;
create policy "Platform owner reads retail fees" on public.retail_platform_fees
  for select to authenticated using (public.is_super_admin(auth.uid()));

-- 5. Money settings RPC gains the retail fee (drop old signature to avoid an overload)
drop function if exists public.set_platform_money_settings(integer, integer, numeric, numeric, numeric, numeric, numeric);
create or replace function public.set_platform_money_settings(
  _cashback_reseller integer, _cashback_subreseller integer, _credits_per_unit numeric,
  _php_per_unit numeric, _withdrawal_fee numeric, _shop_transfer_fee numeric default null,
  _cash_in_fee numeric default null, _retail_fee numeric default null)
returns platform_settings
language plpgsql security definer set search_path = public
as $function$
declare _row public.platform_settings; _prev public.platform_settings; _actor text;
        _fee numeric; _cin numeric; _rfee numeric;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can change money settings';
  end if;
  if _cashback_reseller is null or _cashback_subreseller is null
     or _cashback_reseller < 0 or _cashback_subreseller < 0 then
    raise exception 'Cashback percentages must be zero or more';
  end if;
  if _cashback_reseller + _cashback_subreseller > 100 then
    raise exception 'Reseller + subreseller cashback cannot exceed 100%%';
  end if;
  if coalesce(_credits_per_unit,0) <= 0 or coalesce(_php_per_unit,0) <= 0 then
    raise exception 'The credit valuation must use positive amounts';
  end if;
  if _withdrawal_fee is null or _withdrawal_fee < 0 or _withdrawal_fee > 100 then
    raise exception 'The cash out fee must be between 0%% and 100%%';
  end if;

  select * into _prev from public.platform_settings where id = 1;
  _fee := coalesce(_shop_transfer_fee, _prev.shop_transfer_fee_credits, 5);
  if _fee < 0 then raise exception 'The shop transfer fee cannot be negative'; end if;
  _cin := coalesce(_cash_in_fee, _prev.cash_in_fee_percent, 0);
  if _cin < 0 or _cin > 100 then
    raise exception 'The cash in fee must be between 0%% and 100%%';
  end if;
  _rfee := coalesce(_retail_fee, _prev.retail_platform_fee_percent, 1);
  if _rfee < 0 or _rfee > 100 then
    raise exception 'The retail platform fee must be between 0%% and 100%%';
  end if;

  update public.platform_settings
     set cashback_reseller_percent = _cashback_reseller,
         cashback_subreseller_percent = _cashback_subreseller,
         cash_out_credits_per_unit = _credits_per_unit,
         cash_out_php_per_unit = _php_per_unit,
         withdrawal_fee_percent = _withdrawal_fee,
         shop_transfer_fee_credits = _fee,
         cash_in_fee_percent = _cin,
         retail_platform_fee_percent = _rfee,
         updated_at = now(), updated_by = auth.uid()
   where id = 1
   returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce(_actor,'Super Admin'), 'Updated platform money settings', 'Platform settings',
          jsonb_build_object(
            'previous', jsonb_build_object(
              'cashback_reseller_percent', _prev.cashback_reseller_percent,
              'cashback_subreseller_percent', _prev.cashback_subreseller_percent,
              'cash_out_credits_per_unit', _prev.cash_out_credits_per_unit,
              'cash_out_php_per_unit', _prev.cash_out_php_per_unit,
              'withdrawal_fee_percent', _prev.withdrawal_fee_percent,
              'cash_in_fee_percent', _prev.cash_in_fee_percent,
              'shop_transfer_fee_credits', _prev.shop_transfer_fee_credits,
              'retail_platform_fee_percent', _prev.retail_platform_fee_percent),
            'new', jsonb_build_object(
              'cashback_reseller_percent', _cashback_reseller,
              'cashback_subreseller_percent', _cashback_subreseller,
              'cash_out_credits_per_unit', _credits_per_unit,
              'cash_out_php_per_unit', _php_per_unit,
              'withdrawal_fee_percent', _withdrawal_fee,
              'cash_in_fee_percent', _cin,
              'shop_transfer_fee_credits', _fee,
              'retail_platform_fee_percent', _rfee),
            'applies_to', 'future transactions only'));
  return _row;
end $function$;

-- 6. Order placement — applicable price first, fee on the applicable seller amount only
create or replace function public.retail_place_order(
  _ecosystem_id uuid, _items jsonb, _fulfillment text, _payment_method text,
  _address text default null, _notes text default null)
returns table(order_id uuid, order_no text, total numeric)
language plpgsql security definer set search_path = public
as $function$
declare
  _uid uuid := public.effective_uid();
  _eco record; _item jsonb; _p record; _qty int;
  _total numeric(14,2) := 0; _seller_total numeric(14,2) := 0; _fee_total numeric(14,2) := 0;
  _pct numeric(6,2); _unit numeric(12,2); _wholesale boolean;
  _seller_line numeric(14,2); _fee_line numeric(14,2); _line numeric(14,2);
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

  -- Fee percentage snapshotted once per order; later setting changes never touch this order.
  _pct := round(public.retail_platform_fee_percent(), 2);

  select coalesce(full_name, 'Member') into _name from public.profiles where id = _uid;
  _ono := 'RO-' || to_char(now(), 'YYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));

  insert into public.retail_orders
    (order_no, ecosystem_id, customer_id, customer_name, fulfillment, delivery_address,
     delivery_notes, payment_method, total, seller_total, platform_fee_percent, platform_fee_amount)
  values (_ono, _ecosystem_id, _uid, _name, _fulfillment,
          nullif(btrim(coalesce(_address,'')), ''), nullif(btrim(coalesce(_notes,'')), ''),
          _payment_method, 0, 0, _pct, 0)
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

    -- (a) applicable seller unit price: the shop's single wholesale tier once the
    --     quantity reaches the minimum, otherwise the regular price.
    _wholesale := coalesce(_p.wholesale_price, 0) > 0
              and coalesce(_p.wholesale_min_qty, 0) > 0
              and _qty >= _p.wholesale_min_qty;
    _unit := case when _wholesale then _p.wholesale_price else _p.price end;
    -- (b) seller amount for the line, (c) fee on that amount only, (d) customer line.
    _seller_line := round(_unit * _qty, 2);
    _fee_line := round(_seller_line * _pct / 100, 2);
    _line := _seller_line + _fee_line;

    update public.retail_products set stock = stock - _qty where id = _p.id;
    insert into public.retail_order_items
      (order_id, product_id, product_name, unit_price, quantity, line_total,
       regular_unit_price, wholesale_applied, seller_line_total, fee_amount)
    values (_oid, _p.id, _p.name, _unit, _qty, _line,
            _p.price, _wholesale, _seller_line, _fee_line);
    _seller_total := _seller_total + _seller_line;
    _fee_total := _fee_total + _fee_line;
    _total := _total + _line;
  end loop;

  if _seller_total <= 0 then raise exception 'Your cart is empty'; end if;

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

  update public.retail_orders
     set total = _total, seller_total = _seller_total, platform_fee_amount = _fee_total
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
                             'payment_method', _payment_method, 'fulfillment', _fulfillment));

  return query select _oid, _ono, _total;
end $function$;

-- 7. Approval settles the SELLER amount to the admin; the fee stays with the platform.
create or replace function public.retail_review_order(_order_id uuid, _approve boolean, _note text default null)
returns void
language plpgsql security definer set search_path = public
as $function$
declare _o public.retail_orders; _actor text; _it record; _eco record;
        _recipient uuid; _racct uuid; _settle uuid; _refund uuid;
        _seller numeric(14,2); _fee numeric(14,2);
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
      _seller := coalesce(_o.seller_total, _o.total);
      _fee := coalesce(_o.platform_fee_amount, 0);
      if _seller + _fee <> _o.total then
        raise exception 'Order pricing snapshot is inconsistent';
      end if;
      -- Recipient wallet follows the same shop-kind routing as the hold.
      _racct := public.retail_wallet_for(_recipient, _o.ecosystem_id);
      insert into public.credit_ledger
        (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference,
         actor_id, tx_id, entry_kind)
      values (_racct, _recipient, _o.ecosystem_id, 'credit', _seller, 0,
              'Retail sale — ' || _o.order_no || ' (' || _o.customer_name || ')', _o.order_no,
              _o.customer_id, _o.credit_hold_tx || '-S', 'retail_settlement')
      returning id into _settle;
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
          jsonb_build_object('order_id', _o.id, 'total', _o.total, 'seller_total', _seller,
                             'platform_fee_amount', _fee,
                             'customer_id', _o.customer_id, 'note', _note,
                             'settlement_ledger_id', _settle, 'refund_ledger_id', _refund));
end $function$;

-- 8. Buyer listing: wholesale price/min qty are customer-facing; SKU/barcode stay private.
drop function if exists public.list_retail_products(uuid);
create function public.list_retail_products(_ecosystem_id uuid)
returns table(id uuid, name text, description text, image_path text, price numeric, stock integer,
              sold_count integer, public_visible boolean, rating_avg numeric, rating_count integer,
              brand text, variant text, size_label text, unit text, category text,
              wholesale_price numeric, wholesale_min_qty integer)
language sql stable security definer set search_path = public
as $function$
  select p.id, p.name, p.description, p.image_path, p.price, p.stock, p.sold_count, p.public_visible,
         coalesce((select round(avg(r.rating)::numeric,2) from public.retail_product_ratings r
                    where r.product_id = p.id), 0)::numeric,
         coalesce((select count(*)::int from public.retail_product_ratings r
                    where r.product_id = p.id), 0),
         p.brand, p.variant, p.size_label, p.unit, p.category,
         coalesce(p.wholesale_price, 0)::numeric, coalesce(p.wholesale_min_qty, 0)::int
    from public.retail_products p
   where p.ecosystem_id = _ecosystem_id
     and p.active and p.published and not p.archived
     and (public.has_membership(auth.uid(), _ecosystem_id)
          or (p.public_visible and exists (select 1 from public.ecosystems e
                where e.id = _ecosystem_id and e.public_storefront_enabled and e.store_retail_enabled)))
   order by p.category nulls last, p.name;
$function$;
grant execute on function public.list_retail_products(uuid) to anon, authenticated, service_role;

-- 9. Public storefront shows the customer price (regular seller amount + fee) for retail rows.
create or replace function public.public_shop_products(_slug text)
returns table(kind text, id uuid, name text, description text, image_path text, price numeric,
              available integer, rating_avg numeric, rating_count integer)
language sql stable security definer set search_path = public
as $function$
  WITH shop AS (
    SELECT e.* FROM public.ecosystems e
     WHERE e.slug = _slug AND e.archived_at IS NULL AND e.public_storefront_enabled
       AND (NOT e.is_test OR public.can_see_test_shop(e.id)))
  SELECT 'retail'::text, p.id, p.name, p.description, p.image_path,
         round(p.price * (1 + public.retail_platform_fee_percent() / 100), 2), p.stock,
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.retail_product_ratings r
                    WHERE r.product_id = p.id),0)::numeric,
         coalesce((SELECT count(*)::int FROM public.retail_product_ratings r
                    WHERE r.product_id = p.id),0)
    FROM public.retail_products p JOIN shop s ON s.id = p.ecosystem_id
   WHERE s.store_retail_enabled AND p.active AND p.published AND NOT p.archived AND p.public_visible
  UNION ALL
  SELECT 'voucher'::text, v.id, v.name, v.description, NULL, v.credit_price,
         (SELECT count(*)::int FROM public.voucher_codes c
           WHERE c.product_id = v.id AND c.status = 'unused'),
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.product_ratings r
                    WHERE r.product_id = v.id),0)::numeric,
         coalesce((SELECT count(*)::int FROM public.product_ratings r
                    WHERE r.product_id = v.id),0)
    FROM public.voucher_products v JOIN shop s ON s.id = v.ecosystem_id
   WHERE s.store_voucher_enabled AND v.active AND NOT v.archived
   ORDER BY 1, 3;
$function$;

-- 10. Order listings expose the pricing snapshot.
drop function if exists public.list_retail_orders(uuid, text);
create function public.list_retail_orders(_ecosystem_id uuid, _status text default null)
returns table(id uuid, order_no text, customer_id uuid, customer_name text, status text, fulfillment text,
              delivery_address text, delivery_notes text, payment_method text, total numeric,
              seller_total numeric, platform_fee_percent numeric, platform_fee_amount numeric,
              decision_note text, created_at timestamptz, items jsonb)
language sql stable security definer set search_path = public
as $function$
  SELECT o.id, o.order_no, o.customer_id, o.customer_name, o.status, o.fulfillment,
         o.delivery_address, o.delivery_notes, o.payment_method, o.total,
         coalesce(o.seller_total, o.total), coalesce(o.platform_fee_percent, 0), coalesce(o.platform_fee_amount, 0),
         o.decision_note, o.created_at,
         coalesce((SELECT jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity,
                    'unit_price', i.unit_price, 'line_total', i.line_total, 'product_id', i.product_id,
                    'regular_unit_price', coalesce(i.regular_unit_price, i.unit_price),
                    'wholesale_applied', i.wholesale_applied,
                    'seller_line_total', coalesce(i.seller_line_total, i.line_total),
                    'fee_amount', coalesce(i.fee_amount, 0))
                    ORDER BY i.product_name)
                     FROM public.retail_order_items i WHERE i.order_id = o.id), '[]'::jsonb)
    FROM public.retail_orders o
   WHERE o.ecosystem_id = _ecosystem_id
     AND (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) OR public.is_super_admin(auth.uid()))
     AND (_status IS NULL OR _status = 'all' OR o.status = _status)
   ORDER BY o.created_at DESC
   LIMIT 200;
$function$;
grant execute on function public.list_retail_orders(uuid, text) to authenticated, service_role;

drop function if exists public.my_retail_orders(uuid);
create function public.my_retail_orders(_ecosystem_id uuid)
returns table(id uuid, order_no text, status text, fulfillment text, delivery_address text,
              delivery_notes text, payment_method text, total numeric,
              seller_total numeric, platform_fee_percent numeric, platform_fee_amount numeric,
              decision_note text, created_at timestamptz, items jsonb)
language sql stable security definer set search_path = public
as $function$
  SELECT o.id, o.order_no, o.status, o.fulfillment, o.delivery_address, o.delivery_notes,
         o.payment_method, o.total,
         coalesce(o.seller_total, o.total), coalesce(o.platform_fee_percent, 0), coalesce(o.platform_fee_amount, 0),
         o.decision_note, o.created_at,
         coalesce((SELECT jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity,
                    'unit_price', i.unit_price, 'line_total', i.line_total, 'product_id', i.product_id,
                    'regular_unit_price', coalesce(i.regular_unit_price, i.unit_price),
                    'wholesale_applied', i.wholesale_applied,
                    'seller_line_total', coalesce(i.seller_line_total, i.line_total),
                    'fee_amount', coalesce(i.fee_amount, 0))
                    ORDER BY i.product_name)
                     FROM public.retail_order_items i WHERE i.order_id = o.id), '[]'::jsonb)
    FROM public.retail_orders o
   WHERE o.ecosystem_id = _ecosystem_id AND o.customer_id = public.effective_uid()
   ORDER BY o.created_at DESC
   LIMIT 100;
$function$;
grant execute on function public.my_retail_orders(uuid) to authenticated, service_role;