-- R5: Retail fulfillment foundation (non-financial)
alter table public.retail_orders
  add column if not exists fulfillment_status text not null default 'awaiting',
  add column if not exists fulfillment_updated_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table public.retail_orders drop constraint if exists retail_orders_fulfillment_status_check;
alter table public.retail_orders add constraint retail_orders_fulfillment_status_check
  check (fulfillment_status in ('awaiting','accepted','preparing','ready','out_for_delivery','delivered','completed','closed'));

-- Backfill any existing rows so the fulfillment state agrees with the financial state.
update public.retail_orders set fulfillment_status = 'accepted' where status = 'approved' and fulfillment_status = 'awaiting';
update public.retail_orders set fulfillment_status = 'closed' where status in ('rejected','cancelled') and fulfillment_status = 'awaiting';

-- Legal one-step forward moves for an approved order.
create or replace function public.retail_fulfillment_step_ok(_from text, _to text, _fulfillment text)
returns boolean language sql immutable set search_path = public as $$
  select case
    when _from = 'accepted'         and _to = 'preparing'        then true
    when _from = 'preparing'        and _to = 'ready'            then true
    when _from = 'ready'            and _to = 'out_for_delivery' then _fulfillment = 'delivery'
    when _from = 'ready'            and _to = 'delivered'        then _fulfillment = 'pickup'
    when _from = 'out_for_delivery' and _to = 'delivered'        then true
    when _from = 'delivered'        and _to = 'completed'        then true
    else false end
$$;

create or replace function public.retail_orders_guard()
returns trigger language plpgsql set search_path = public as $function$
declare _creating boolean := (OLD.created_at = now());
        _fcols text[] := array['updated_at','notified_at','fulfillment_status','fulfillment_updated_at','delivered_at','completed_at'];
begin
  -- status machine (financial state, unchanged from R4)
  if NEW.status is distinct from OLD.status then
    if OLD.status <> 'pending' or NEW.status not in ('approved','rejected','cancelled') then
      raise exception 'Retail order % is already % and cannot change', OLD.order_no, OLD.status;
    end if;
    -- fulfillment state follows the financial decision automatically
    NEW.fulfillment_status := case when NEW.status = 'approved' then 'accepted' else 'closed' end;
    NEW.fulfillment_updated_at := now();
  elsif NEW.fulfillment_status is distinct from OLD.fulfillment_status then
    -- fulfillment progress: only approved orders, only one legal step forward
    if OLD.status <> 'approved' or OLD.fulfillment_status in ('completed','closed','awaiting')
       or not public.retail_fulfillment_step_ok(OLD.fulfillment_status, NEW.fulfillment_status, OLD.fulfillment) then
      raise exception 'Retail order % cannot move from % to %', OLD.order_no, OLD.fulfillment_status, NEW.fulfillment_status;
    end if;
    NEW.fulfillment_updated_at := now();
    if NEW.fulfillment_status = 'delivered' then NEW.delivered_at := now(); end if;
    if NEW.fulfillment_status = 'completed' then NEW.completed_at := now(); end if;
  else
    -- no state change: fulfillment timestamps are write-once
    if NEW.delivered_at is distinct from OLD.delivered_at or NEW.completed_at is distinct from OLD.completed_at
       or NEW.fulfillment_updated_at is distinct from OLD.fulfillment_updated_at then
      raise exception 'Retail order % fulfillment timestamps are write-once', OLD.order_no;
    end if;
  end if;
  -- final orders: only bookkeeping / fulfillment columns may change
  if OLD.status <> 'pending'
     and (to_jsonb(NEW) - _fcols) <> (to_jsonb(OLD) - _fcols) then
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
  if NEW.payment_method = 'credit' then
    if NEW.status = 'approved' and (NEW.hold_ledger_id is null or NEW.credit_hold_tx is null or NEW.refund_ledger_id is not null) then
      raise exception 'Retail order % cannot be approved without its payment hold', OLD.order_no;
    end if;
    if NEW.status in ('rejected','cancelled') and (NEW.settlement_ledger_id is not null or NEW.cashback_ledger_id is not null) then
      raise exception 'Retail order % cannot be % after settlement', OLD.order_no, NEW.status;
    end if;
  end if;
  return NEW;
end $function$;

-- Fulfillment progression (no money movement). Seller side: shop admin / super admin /
-- the order's attributed storefront seller. Customer side: confirm receipt only.
create or replace function public.retail_update_fulfillment(_order_id uuid, _next text)
returns void language plpgsql security definer set search_path = public as $function$
declare _o public.retail_orders; _uid uuid := auth.uid(); _eff uuid := public.effective_uid();
        _is_admin boolean; _is_seller boolean; _is_customer boolean; _actor text; _title text; _body text;
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  _is_admin := public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid);
  _is_seller := _o.seller_id is not null and _o.seller_id = _uid and public.retail_seller_allowed(_uid, _o.ecosystem_id);
  _is_customer := _o.customer_id = _eff;
  if not (_is_admin or _is_seller or _is_customer) then
    raise exception 'You are not allowed to update this order';
  end if;
  if _o.status <> 'approved' then
    raise exception 'Order % is % and has no fulfillment to update', _o.order_no, _o.status;
  end if;
  if _next = 'completed' then
    if not (_is_customer or _is_admin) then
      raise exception 'Only the customer can confirm receipt of this order';
    end if;
  elsif not (_is_admin or _is_seller) then
    raise exception 'Only the seller can update fulfillment for this order';
  end if;
  if not public.retail_fulfillment_step_ok(_o.fulfillment_status, _next, _o.fulfillment) then
    raise exception 'Order % cannot move from % to %', _o.order_no, _o.fulfillment_status, _next;
  end if;

  -- Only the fulfillment state changes; the guard trigger stamps the timestamps and
  -- refuses any touch on price, fee, cashback or ledger columns.
  update public.retail_orders set fulfillment_status = _next where id = _o.id and status = 'approved';

  _title := 'Order ' || _o.order_no || ' — ' || replace(_next, '_', ' ');
  _body := case _next
    when 'preparing'        then 'The shop is preparing your order.'
    when 'ready'            then case when _o.fulfillment = 'pickup' then 'Your order is ready for pickup.' else 'Your order is packed and ready to go out.' end
    when 'out_for_delivery' then 'Your order is on its way.'
    when 'delivered'        then 'Your order has been handed over. Please confirm you received it.'
    when 'completed'        then 'Order completed. Thank you!'
    else 'Order status updated.' end;
  if _next <> 'completed' or not _is_customer then
    perform public.notify_member(_o.customer_id, _o.ecosystem_id, 'retail_order', _title, _body, '/app/store');
  end if;
  if _next = 'completed' and _o.seller_id is not null and _o.seller_id <> _o.customer_id then
    perform public.notify_member(_o.seller_id, _o.ecosystem_id, 'retail_order', _title,
      _o.customer_name || ' confirmed receipt of order ' || _o.order_no || '.', '/admin/orders');
  end if;

  select coalesce(full_name, 'Member') into _actor from public.profiles where id = _uid;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, _uid, _actor, 'Retail fulfillment: ' || _next, _o.order_no,
          jsonb_build_object('order_id', _o.id, 'from', _o.fulfillment_status, 'to', _next,
                             'by', case when _is_admin then 'admin' when _is_seller then 'seller' else 'customer' end));
end $function$;
grant execute on function public.retail_update_fulfillment(uuid, text) to authenticated;

-- Order lists: expose fulfillment state; sellers see the orders attributed to them.
drop function if exists public.list_retail_orders(uuid, text);
create function public.list_retail_orders(_ecosystem_id uuid, _status text default null)
returns table(id uuid, order_no text, customer_id uuid, customer_name text, status text, fulfillment text,
              fulfillment_status text, delivered_at timestamptz, completed_at timestamptz, seller_id uuid, seller_name text,
              delivery_address text, delivery_notes text, payment_method text, total numeric,
              seller_total numeric, platform_fee_percent numeric, platform_fee_amount numeric,
              decision_note text, created_at timestamptz, items jsonb)
language sql stable security definer set search_path = public as $$
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
                    from public.retail_order_items i where i.order_id = o.id), '[]'::jsonb)
    from public.retail_orders o
   where o.ecosystem_id = _ecosystem_id
     and (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())
          or (o.seller_id = auth.uid() and public.retail_seller_allowed(auth.uid(), _ecosystem_id)))
     and (_status is null or _status = 'all' or o.status = _status)
   order by o.created_at desc
   limit 200;
$$;
grant execute on function public.list_retail_orders(uuid, text) to authenticated;

drop function if exists public.my_retail_orders(uuid);
create function public.my_retail_orders(_ecosystem_id uuid)
returns table(id uuid, order_no text, status text, fulfillment text, fulfillment_status text,
              delivered_at timestamptz, completed_at timestamptz, shop_name text, seller_name text,
              delivery_address text, delivery_notes text, payment_method text, total numeric,
              seller_total numeric, platform_fee_percent numeric, platform_fee_amount numeric,
              decision_note text, created_at timestamptz, items jsonb)
language sql stable security definer set search_path = public as $$
  select o.id, o.order_no, o.status, o.fulfillment, o.fulfillment_status, o.delivered_at, o.completed_at,
         (select e.name from public.ecosystems e where e.id = o.ecosystem_id),
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
                    from public.retail_order_items i where i.order_id = o.id), '[]'::jsonb)
    from public.retail_orders o
   where o.ecosystem_id = _ecosystem_id and o.customer_id = public.effective_uid()
   order by o.created_at desc
   limit 100;
$$;
grant execute on function public.my_retail_orders(uuid) to authenticated;