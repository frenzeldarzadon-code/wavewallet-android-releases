-- 1. Additive columns -------------------------------------------------
alter table public.retail_orders   add column if not exists reversed_at timestamptz;
alter table public.retail_platform_fees add column if not exists reversed_at timestamptz;

-- 2. Order chat for EVERY retail order --------------------------------
create or replace function public.retail_sync_order_chat(_order_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare _o public.retail_orders; _tid uuid; _seller uuid; _want uuid[];
begin
  select * into _o from public.retail_orders where id = _order_id;
  if _o.id is null then return null; end if;
  _seller := coalesce(_o.seller_id, public.retail_settlement_recipient(_o.ecosystem_id));
  _tid := _o.chat_thread_id;
  if _tid is null then
    select id into _tid from public.dm_threads where order_id = _o.id;
  end if;
  if _tid is null then
    insert into public.dm_threads (ecosystem_id, kind, order_id, title)
    values (_o.ecosystem_id, 'order', _o.id, 'Order ' || _o.order_no)
    on conflict (order_id) where order_id is not null do update set title = excluded.title
    returning id into _tid;
  end if;
  if _o.chat_thread_id is distinct from _tid then
    update public.retail_orders set chat_thread_id = _tid where id = _o.id;
  end if;
  _want := array_remove(array[_o.customer_id, _seller, _o.delivery_person_id,
                              case when _o.collector_status in ('proposed','approved') then _o.collector_id end], null);
  insert into public.dm_thread_members (thread_id, user_id, member_role)
  select _tid, u, case when u = _o.customer_id then 'customer' when u = _seller then 'seller'
                       when u = _o.delivery_person_id then 'delivery' else 'collector' end
    from unnest(_want) u
  on conflict (thread_id, user_id) do update set removed_at = null,
     member_role = excluded.member_role;
  update public.dm_thread_members set removed_at = now()
   where thread_id = _tid and removed_at is null and not (user_id = any(_want));
  return _tid;
end $function$;

create or replace function public.retail_order_chat(_order_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare _o public.retail_orders; _uid uuid := auth.uid(); _eff uuid := public.effective_uid(); _seller uuid;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  select * into _o from public.retail_orders where id = _order_id;
  if _o.id is null then raise exception 'Order not found'; end if;
  _seller := coalesce(_o.seller_id, public.retail_settlement_recipient(_o.ecosystem_id));
  if not (_o.customer_id = _eff or _uid = _seller or _uid = _o.delivery_person_id
          or (_uid = _o.collector_id and _o.collector_status in ('proposed','approved'))
          or public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid)) then
    raise exception 'You are not part of this order';
  end if;
  return public.retail_sync_order_chat(_o.id);
end $function$;

create or replace function public.retail_orders_chat_sync()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform public.retail_sync_order_chat(NEW.id);
  return null;
end $function$;

drop trigger if exists retail_orders_chat_sync on public.retail_orders;
create trigger retail_orders_chat_sync
after insert or update of seller_id, delivery_person_id, collector_id, collector_status, chat_thread_id
on public.retail_orders for each row execute function public.retail_orders_chat_sync();

-- backfill existing orders (idempotent)
do $$ declare r record; begin
  for r in select id from public.retail_orders loop
    perform public.retail_sync_order_chat(r.id);
  end loop;
end $$;

-- 3. Guard: allow an audited reversal-cancellation of a non-COD order --
create or replace function public.retail_orders_guard()
returns trigger language plpgsql set search_path to 'public' as $function$
declare _creating boolean := (OLD.created_at = now());
        _fcols text[] := array['updated_at','notified_at','fulfillment_status','fulfillment_updated_at','delivered_at','completed_at','chat_thread_id'];
        _cod_cols text[] := array['self_delivery','delivery_person_id','collector_id','collector_status','collector_responded_at',
                                  'cod_hold_tx','cod_hold_ledger_id','cod_expected_cash','cod_actual_cash','cod_cash_received_at',
                                  'cod_discrepancy','cod_settled_at','cod_settlement_kind','delivery_share_ledger_id',
                                  'collector_share_ledger_id','settlement_ledger_id','settled_to','cashback_ledger_id',
                                  'refund_ledger_id','credit_released','decision_note','decided_at','decided_by','status'];
        _cod boolean := (OLD.payment_method = 'cod');
        _reversing boolean := (NEW.reversed_at is not null and OLD.reversed_at is null);
begin
  if _cod then _fcols := _fcols || _cod_cols;
  elsif OLD.fulfillment = 'delivery' then
    _fcols := _fcols || array['self_delivery','delivery_person_id'];
  end if;
  if _reversing then _fcols := _fcols || _cod_cols || array['reversed_at']; end if;
  if NEW.reversed_at is not null and OLD.reversed_at is not null
     and NEW.reversed_at is distinct from OLD.reversed_at then
    raise exception 'Retail order % was already reversed', OLD.order_no;
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
    elsif _reversing and OLD.status = 'approved' and NEW.status = 'cancelled' then
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
  if NEW.settlement_ledger_id is not null and NEW.refund_ledger_id is not null and not _reversing then
    raise exception 'Retail order % cannot be both settled and refunded', OLD.order_no;
  end if;
  if NEW.cashback_ledger_id is not null and NEW.refund_ledger_id is not null and not _reversing then
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
    if NEW.status in ('rejected','cancelled') and not _reversing
       and (NEW.settlement_ledger_id is not null or NEW.cashback_ledger_id is not null) then
      raise exception 'Retail order % cannot be % after settlement', OLD.order_no, NEW.status;
    end if;
  elsif NEW.payment_method = 'cod' then
    if NEW.fulfillment <> 'delivery' then raise exception 'Retail order % cash on delivery requires delivery', OLD.order_no; end if;
    if (NEW.settlement_ledger_id is not null or NEW.cashback_ledger_id is not null or NEW.cod_settled_at is not null
        or NEW.delivery_share_ledger_id is not null or NEW.collector_share_ledger_id is not null)
       and (NEW.cod_hold_ledger_id is null or NEW.cod_settled_at is null or NEW.status <> 'approved') and not _reversing then
      raise exception 'Retail order % can only settle from an approved order with a collector hold', OLD.order_no;
    end if;
    if NEW.collector_status = 'approved' and NEW.cod_hold_ledger_id is null then
      raise exception 'Retail order % collector approval requires the coin hold', OLD.order_no;
    end if;
    if NEW.cod_hold_ledger_id is not null and (NEW.collector_id is null or NEW.collector_status <> 'approved') then
      raise exception 'Retail order % collector cannot change while coins are held', OLD.order_no;
    end if;
    if NEW.cod_settled_at is not null and NEW.refund_ledger_id is not null and not _reversing then
      raise exception 'Retail order % cannot be both settled and released', OLD.order_no;
    end if;
  else
    if NEW.collector_id is not null or NEW.cod_hold_ledger_id is not null or NEW.cod_settled_at is not null then
      raise exception 'Retail order % is a cash order and has no collector float', OLD.order_no;
    end if;
  end if;
  return NEW;
end $function$;

-- 4. Seller / admin cancellation at any live stage ---------------------
create or replace function public.retail_seller_cancel_order(_order_id uuid, _note text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare _o public.retail_orders; _uid uuid := auth.uid(); _it record;
        _reason text; _lg public.credit_ledger; _acct uuid; _refund uuid; _charge numeric(14,2);
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if not public.retail_cod_manager(_o, _uid) then raise exception 'Only the seller or shop admin can cancel this order'; end if;
  _reason := coalesce(nullif(btrim(coalesce(_note, '')), ''), 'Cancelled by the seller');

  if _o.status in ('cancelled','rejected') then
    raise exception 'Order % was already %', _o.order_no, _o.status;
  end if;

  if _o.status = 'pending' then
    for _it in select * from public.retail_order_items where order_id = _o.id loop
      update public.retail_products set stock = stock + _it.quantity where id = _it.product_id;
    end loop;
    _refund := public.retail_refund_hold(_o, _uid);
    update public.retail_orders
       set status = 'cancelled', credit_released = true, decided_at = now(), decided_by = _uid,
           decision_note = _reason, refund_ledger_id = coalesce(_refund, refund_ledger_id)
     where id = _o.id and status = 'pending';
    if not found then raise exception 'Order % was already changed', _o.order_no; end if;
  elsif _o.payment_method = 'cod' and _o.cod_settled_at is null and _o.settlement_ledger_id is null then
    perform public.retail_cod_cancel_internal(_o.id, _uid, _reason, 'seller');
    return;
  else
    -- approved order: reverse every credit movement that already happened
    if _o.cod_discrepancy and not (public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid)) then
      raise exception 'This order has a cash discrepancy — the shop admin must resolve it';
    end if;

    if _o.cashback_ledger_id is not null then
      select * into _lg from public.credit_ledger where id = _o.cashback_ledger_id;
      if _lg.id is not null and _lg.direction = 'credit' then
        insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                          reason, reference, actor_id, tx_id, entry_kind, reverses_ledger_id)
        values (_lg.account_id, _lg.user_id, _lg.ecosystem_id, 'debit', _lg.amount, 0,
                'Retail cashback reversed — ' || _o.order_no, _o.order_no, _uid,
                coalesce(_lg.tx_id, public.new_tx_id()) || '-CBR', 'retail_cashback_reversal', _lg.id);
      end if;
    end if;

    if _o.settlement_ledger_id is not null then
      select * into _lg from public.credit_ledger where id = _o.settlement_ledger_id;
      if _lg.id is not null and _lg.direction = 'credit' then
        insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                          reason, reference, actor_id, tx_id, entry_kind, reverses_ledger_id)
        values (_lg.account_id, _lg.user_id, _lg.ecosystem_id, 'debit', _lg.amount, 0,
                'Retail settlement reversed — ' || _o.order_no, _o.order_no, _uid,
                coalesce(_lg.tx_id, public.new_tx_id()) || '-SR', 'retail_settlement_reversal', _lg.id);
      end if;
    end if;

    if _o.payment_method = 'credit' and _o.hold_ledger_id is not null and _o.refund_ledger_id is null then
      select * into _lg from public.credit_ledger where id = _o.hold_ledger_id;
      _charge := coalesce(_lg.amount, coalesce(_o.buyer_charge, _o.total));
      _acct := coalesce(_o.wallet_account_id, public.retail_wallet_for(_o.customer_id, _o.ecosystem_id));
      insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                        reason, reference, actor_id, tx_id, entry_kind, reverses_ledger_id)
      values (_acct, _o.customer_id, _o.ecosystem_id, 'credit', _charge, 0,
              'Retail order refund — ' || _o.order_no, _o.order_no, _uid,
              coalesce(_o.credit_hold_tx, public.new_tx_id()) || '-CR', 'retail_refund', _o.hold_ledger_id)
      returning id into _refund;
    end if;

    for _it in select * from public.retail_order_items where order_id = _o.id loop
      update public.retail_products
         set stock = stock + _it.quantity, sold_count = greatest(sold_count - _it.quantity, 0)
       where id = _it.product_id;
    end loop;

    perform public.retail_reverse_order_points(_o.id, 'Order ' || _o.order_no || ' cancelled');
    update public.retail_platform_fees set reversed_at = now()
     where order_id = _o.id and reversed_at is null;

    update public.retail_orders
       set status = 'cancelled', reversed_at = now(), credit_released = true,
           decided_at = now(), decided_by = _uid, decision_note = _reason,
           refund_ledger_id = coalesce(_refund, refund_ledger_id)
     where id = _o.id and status = 'approved';
    if not found then raise exception 'Order % was already changed', _o.order_no; end if;
  end if;

  perform public.notify_member(_o.customer_id, _o.ecosystem_id, 'retail_order',
    'Order ' || _o.order_no || ' cancelled', _reason, '/app/store');
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, _uid, (select coalesce(full_name,'Member') from public.profiles where id = _uid),
          'Retail order cancelled by seller', _o.order_no,
          jsonb_build_object('order_id', _o.id, 'from_status', _o.status,
                             'fulfillment', _o.fulfillment_status, 'note', _reason));
end $function$;

revoke all on function public.retail_seller_cancel_order(uuid, text) from public, anon;
grant execute on function public.retail_seller_cancel_order(uuid, text) to authenticated, service_role;

-- 5. Order workspace behind a chat thread ------------------------------
create or replace function public.retail_order_workspace(_thread_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare _o public.retail_orders; _uid uuid := auth.uid(); _eff uuid := public.effective_uid();
        _seller uuid; _role text; _admin boolean; _manager boolean; _e record;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  select o.* into _o from public.retail_orders o
    join public.dm_threads t on t.order_id = o.id where t.id = _thread_id;
  if _o.id is null then return null; end if;
  if not public.dm_is_active_member(_thread_id, _uid) then
    raise exception 'You are not part of this order';
  end if;
  select name, slug into _e from public.ecosystems where id = _o.ecosystem_id;
  _seller := coalesce(_o.seller_id, public.retail_settlement_recipient(_o.ecosystem_id));
  _admin := public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid);
  _manager := public.retail_cod_manager(_o, _uid);
  _role := case when _manager then 'seller'
                when _o.customer_id = _eff then 'customer'
                when _uid = _o.delivery_person_id then 'delivery'
                when _uid = _o.collector_id then 'collector'
                else 'member' end;
  return jsonb_build_object(
    'order_id', _o.id,
    'thread_id', _thread_id,
    'order_no', _o.order_no,
    'shop_name', _e.name,
    'shop_slug', _e.slug,
    'ecosystem_id', _o.ecosystem_id,
    'status', _o.status,
    'fulfillment', _o.fulfillment,
    'fulfillment_status', _o.fulfillment_status,
    'payment_method', _o.payment_method,
    'total', _o.total,
    'delivery_fee', _o.delivery_fee,
    'buyer_charge', coalesce(_o.buyer_charge, _o.total),
    'delivery_address', _o.delivery_address,
    'collector_status', _o.collector_status,
    'cod_cash_received_at', _o.cod_cash_received_at,
    'cod_settled_at', _o.cod_settled_at,
    'decision_note', _o.decision_note,
    'created_at', _o.created_at,
    'role', _role,
    'is_admin', _admin,
    'can_review', _manager and _o.status = 'pending',
    'can_advance', (_manager or (_uid = _o.delivery_person_id and _o.fulfillment_status = 'out_for_delivery'))
                   and _o.status = 'approved'
                   and _o.fulfillment_status not in ('completed','closed'),
    'can_confirm_receipt', _o.customer_id = _eff and _o.status = 'approved'
                           and _o.fulfillment_status = 'delivered',
    'can_customer_cancel', _o.customer_id = _eff and _o.status = 'pending',
    'can_seller_cancel', _manager and _o.status in ('pending','approved')
                         and _o.fulfillment_status <> 'closed',
    'can_collector_confirm', _uid = _o.collector_id and _o.payment_method = 'cod'
                             and _o.collector_status = 'approved'
                             and _o.cod_cash_received_at is null and _o.status = 'approved',
    'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'name', i.name,
                                                           'quantity', i.quantity, 'line_total', i.line_total)
                                order by i.name)
                         from public.retail_order_items i where i.order_id = _o.id), '[]'::jsonb));
end $function$;

revoke all on function public.retail_order_workspace(uuid) from public, anon;
grant execute on function public.retail_order_workspace(uuid) to authenticated, service_role;