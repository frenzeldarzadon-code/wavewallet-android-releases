-- ============================================================================
-- Retail R6 — Cash-on-Delivery collector float + order-linked chat
-- Retail/Universe only. Voucher Shop, R3/R4 economics and New Generation are
-- untouched (COD is refused outside Universe shops).
-- ============================================================================

-- ---------------------------------------------------------------- shop config
alter table public.ecosystems
  add column if not exists retail_cod_enabled boolean not null default false,
  add column if not exists retail_delivery_fee numeric(12,2) not null default 0,
  add column if not exists retail_delivery_split_delivery_pct integer not null default 0,
  add column if not exists retail_delivery_split_collector_pct integer not null default 0;
alter table public.ecosystems
  add constraint ecosystems_retail_delivery_fee_check check (retail_delivery_fee >= 0),
  add constraint ecosystems_retail_delivery_split_check check (
    retail_delivery_split_delivery_pct between 0 and 100
    and retail_delivery_split_collector_pct between 0 and 100
    and (not retail_cod_enabled
         or retail_delivery_split_delivery_pct + retail_delivery_split_collector_pct = 100));

-- ---------------------------------------------------------------- orders
alter table public.retail_orders drop constraint if exists retail_orders_payment_method_check;
alter table public.retail_orders
  add constraint retail_orders_payment_method_check check (payment_method in ('cash','credit','cod'));

alter table public.retail_orders
  add column if not exists delivery_fee numeric(12,2) not null default 0,
  add column if not exists delivery_split_delivery_pct integer,
  add column if not exists delivery_split_collector_pct integer,
  add column if not exists self_delivery boolean not null default false,
  add column if not exists delivery_person_id uuid,
  add column if not exists collector_id uuid,
  add column if not exists collector_status text not null default 'none',
  add column if not exists collector_responded_at timestamptz,
  add column if not exists cod_hold_tx text,
  add column if not exists cod_hold_ledger_id uuid references public.credit_ledger(id),
  add column if not exists cod_expected_cash numeric(14,2),
  add column if not exists cod_actual_cash numeric(14,2),
  add column if not exists cod_cash_received_at timestamptz,
  add column if not exists cod_discrepancy boolean not null default false,
  add column if not exists cod_settled_at timestamptz,
  add column if not exists cod_settlement_kind text,
  add column if not exists delivery_share_ledger_id uuid references public.credit_ledger(id),
  add column if not exists collector_share_ledger_id uuid references public.credit_ledger(id),
  add column if not exists chat_thread_id uuid;
alter table public.retail_orders
  add constraint retail_orders_delivery_fee_check check (delivery_fee >= 0),
  add constraint retail_orders_collector_status_check
    check (collector_status in ('none','proposed','approved','declined')),
  add constraint retail_orders_cod_settlement_kind_check
    check (cod_settlement_kind is null or cod_settlement_kind in ('collector_confirmed','seller_release','admin_resolved'));
create index if not exists retail_orders_collector_idx on public.retail_orders (collector_id) where collector_id is not null;
create index if not exists retail_orders_delivery_person_idx on public.retail_orders (delivery_person_id) where delivery_person_id is not null;

-- ---------------------------------------------------------------- chat schema
alter table public.dm_threads
  alter column user_a drop not null,
  alter column user_b drop not null,
  add column if not exists kind text not null default 'direct',
  add column if not exists order_id uuid references public.retail_orders(id) on delete set null,
  add column if not exists title text;
alter table public.dm_threads
  add constraint dm_threads_kind_check check (kind in ('direct','order')),
  add constraint dm_threads_direct_parties check (kind <> 'direct' or (user_a is not null and user_b is not null));
create unique index if not exists dm_threads_order_uniq on public.dm_threads (order_id) where order_id is not null;
alter table public.dm_messages alter column recipient_id drop not null;

create table if not exists public.dm_thread_members (
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  user_id uuid not null,
  member_role text not null default 'participant',
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);
grant select on public.dm_thread_members to authenticated;
grant all on public.dm_thread_members to service_role;
alter table public.dm_thread_members enable row level security;
create policy "Members see own thread membership" on public.dm_thread_members
  for select to authenticated using (user_id = auth.uid());

create or replace function public.dm_is_active_member(_thread_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dm_thread_members m
                  where m.thread_id = _thread_id and m.user_id = _user_id and m.removed_at is null)
$$;

drop policy if exists "Participants read threads" on public.dm_threads;
create policy "Participants read threads" on public.dm_threads for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b or public.dm_is_active_member(id, auth.uid()));
drop policy if exists "Participants read messages" on public.dm_messages;
create policy "Participants read messages" on public.dm_messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id or public.dm_is_active_member(thread_id, auth.uid()));

-- ---------------------------------------------------------------- store settings
drop function if exists public.shop_store_settings(uuid);
create function public.shop_store_settings(_ecosystem_id uuid)
returns table(voucher_enabled boolean, retail_enabled boolean, cash_enabled boolean, credit_enabled boolean,
              pickup_enabled boolean, delivery_enabled boolean, public_storefront boolean, contact_email text,
              cod_enabled boolean, delivery_fee numeric, delivery_pct integer, collector_pct integer)
language sql stable security definer set search_path = public as $$
  select e.store_voucher_enabled, e.store_retail_enabled, e.retail_cash_enabled,
         e.retail_credit_enabled, e.retail_pickup_enabled, e.retail_delivery_enabled,
         e.public_storefront_enabled,
         case when public.is_ecosystem_admin(auth.uid(), e.id) or public.is_super_admin(auth.uid())
              then e.contact_email else null end,
         e.retail_cod_enabled and public.is_universe_shop(e.id), e.retail_delivery_fee,
         e.retail_delivery_split_delivery_pct, e.retail_delivery_split_collector_pct
    from public.ecosystems e where e.id = _ecosystem_id;
$$;

create or replace function public.update_retail_delivery_settings(
  _ecosystem_id uuid, _cod_enabled boolean, _delivery_fee numeric, _delivery_pct integer, _collector_pct integer)
returns void language plpgsql security definer set search_path = public as $$
declare _actor text;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Only the shop admin can configure delivery';
  end if;
  if _cod_enabled and not public.is_universe_shop(_ecosystem_id) then
    raise exception 'Cash on delivery is only available in Universe shops';
  end if;
  if coalesce(_delivery_fee, 0) < 0 then raise exception 'Delivery fee cannot be negative'; end if;
  if _delivery_pct is null or _collector_pct is null or _delivery_pct < 0 or _collector_pct < 0
     or _delivery_pct + _collector_pct <> 100 then
    raise exception 'Delivery person percent and collector percent must add up to exactly 100 percent';
  end if;
  update public.ecosystems
     set retail_cod_enabled = _cod_enabled,
         retail_delivery_fee = round(coalesce(_delivery_fee, 0), 2),
         retail_delivery_split_delivery_pct = _delivery_pct,
         retail_delivery_split_collector_pct = _collector_pct
   where id = _ecosystem_id;
  select coalesce(full_name, 'Admin') into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), _actor, 'Updated retail delivery settings', _ecosystem_id::text,
          jsonb_build_object('cod_enabled', _cod_enabled, 'delivery_fee', _delivery_fee,
                             'delivery_pct', _delivery_pct, 'collector_pct', _collector_pct));
end $$;

-- Seller-side COD eligibility: the party who receives the product money must
-- hold at least the order's embedded platform fee in AVAILABLE coins
-- (eligibility gate only — the fee itself is funded from the customer total
-- inside the collector float, exactly as R4 funds it from the buyer's hold).
create or replace function public.retail_cod_seller_funded(_ecosystem_id uuid, _fee numeric)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare _recipient uuid; _bal numeric;
begin
  _recipient := public.retail_settlement_recipient(_ecosystem_id);
  if _recipient is null then return false; end if;
  select a.balance into _bal from public.credit_accounts a
   where a.user_id = _recipient and a.ecosystem_id is null;
  return coalesce(_bal, 0) >= coalesce(_fee, 0);
end $$;

-- _seller_total = seller cut of the cart; the 1% applies to product only, never to delivery
create or replace function public.retail_cod_quote(_ecosystem_id uuid, _seller_total numeric)
returns table(available boolean, reason text, delivery_fee numeric, platform_fee numeric, customer_total numeric)
language plpgsql stable security definer set search_path = public as $$
declare _eco record; _pct numeric; _fee numeric(14,2); _dfee numeric(12,2); _ct numeric(14,2);
begin
  select * into _eco from public.ecosystems where id = _ecosystem_id;
  _pct := round(public.retail_platform_fee_percent(), 2);
  _fee := round(coalesce(_seller_total, 0) * _pct / 100, 2);
  _dfee := coalesce(_eco.retail_delivery_fee, 0);
  _ct := round(coalesce(_seller_total,0) + _fee + _dfee, 2);
  if _eco is null or not _eco.retail_cod_enabled or not public.is_universe_shop(_ecosystem_id) then
    return query select false, 'This shop does not offer cash on delivery', _dfee, _fee, _ct; return;
  end if;
  if not _eco.retail_delivery_enabled then
    return query select false, 'This shop does not offer delivery', _dfee, _fee, _ct; return;
  end if;
  if _eco.retail_delivery_split_delivery_pct + _eco.retail_delivery_split_collector_pct <> 100 then
    return query select false, 'Cash on delivery is not fully configured for this shop', _dfee, _fee, _ct; return;
  end if;
  if not public.retail_cod_seller_funded(_ecosystem_id, _fee) then
    return query select false, 'Cash on delivery is temporarily unavailable for this shop', _dfee, _fee, _ct; return;
  end if;
  return query select true, null::text, _dfee, _fee, _ct;
end $$;

-- ---------------------------------------------------------------- guard
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
  if _cod then _fcols := _fcols || _cod_cols; end if;

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

-- ---------------------------------------------------------------- order chat
create or replace function public.retail_sync_order_chat(_order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _tid uuid; _seller uuid; _want uuid[];
begin
  select * into _o from public.retail_orders where id = _order_id;
  if _o.id is null or _o.fulfillment <> 'delivery' then return null; end if;
  _seller := coalesce(_o.seller_id, public.retail_settlement_recipient(_o.ecosystem_id));
  _tid := _o.chat_thread_id;
  if _tid is null then
    select id into _tid from public.dm_threads where order_id = _o.id;
  end if;
  if _tid is null then
    insert into public.dm_threads (ecosystem_id, kind, order_id, title)
    values (_o.ecosystem_id, 'order', _o.id, 'Order ' || _o.order_no) returning id into _tid;
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
end $$;
revoke all on function public.retail_sync_order_chat(uuid) from public, anon, authenticated;

create or replace function public.retail_order_chat(_order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _uid uuid := auth.uid(); _eff uuid := public.effective_uid(); _seller uuid;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  select * into _o from public.retail_orders where id = _order_id;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.fulfillment <> 'delivery' then raise exception 'Only delivery orders have an order chat'; end if;
  _seller := coalesce(_o.seller_id, public.retail_settlement_recipient(_o.ecosystem_id));
  if not (_o.customer_id = _eff or _uid = _seller or _uid = _o.delivery_person_id
          or (_uid = _o.collector_id and _o.collector_status in ('proposed','approved'))
          or public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid)) then
    raise exception 'You are not part of this order';
  end if;
  return public.retail_sync_order_chat(_o.id);
end $$;

-- ---------------------------------------------------------------- COD lifecycle
create or replace function public.retail_cod_manager(_o public.retail_orders, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid)
      or (_o.seller_id is not null and _o.seller_id = _uid and public.retail_seller_allowed(_uid, _o.ecosystem_id))
$$;

create or replace function public.retail_cod_assignees(_order_id uuid)
returns table(user_id uuid, full_name text, handle text, avatar_path text, collector_eligible boolean)
language plpgsql stable security definer set search_path = public as $$
declare _o public.retail_orders; _need numeric(14,2);
begin
  select * into _o from public.retail_orders where id = _order_id;
  if _o.id is null then raise exception 'Order not found'; end if;
  if not public.retail_cod_manager(_o, auth.uid()) then raise exception 'Only the seller can assign this order'; end if;
  _need := round(_o.total + _o.delivery_fee, 2);
  return query
  select p.id, coalesce(p.full_name, 'Member'), p.handle, p.avatar_path,
         (_o.payment_method = 'cod' and coalesce(a.balance, 0) >= _need)
    from public.profiles p
    left join public.credit_accounts a on a.user_id = p.id and a.ecosystem_id is null
   where p.deleted_at is null and p.status = 'active' and p.id <> _o.customer_id
     and not public.is_super_admin(p.id)
     and (exists (select 1 from public.ecosystem_memberships m
                   where m.user_id = p.id and m.ecosystem_id = _o.ecosystem_id and m.membership_state = 'active')
          or exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.ecosystem_id = _o.ecosystem_id))
   order by (_o.payment_method = 'cod' and coalesce(a.balance, 0) >= _need) desc, p.full_name
   limit 200;
end $$;

create or replace function public.retail_cod_assign(_order_id uuid, _self_delivery boolean, _delivery_person_id uuid, _collector_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _uid uuid := auth.uid(); _need numeric(14,2); _bal numeric; _actor text;
        _new_collector boolean;
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if not public.retail_cod_manager(_o, _uid) then raise exception 'Only the seller can assign this order'; end if;
  if _o.status <> 'approved' or _o.fulfillment <> 'delivery' then
    raise exception 'Only approved delivery orders can be assigned';
  end if;
  if _o.fulfillment_status not in ('accepted','preparing','ready') then
    raise exception 'Order % is already %', _o.order_no, replace(_o.fulfillment_status, '_', ' ');
  end if;
  if coalesce(_self_delivery, false) then _delivery_person_id := null; end if;
  if _delivery_person_id is not null then
    if _delivery_person_id = _o.customer_id then raise exception 'The customer cannot deliver their own order'; end if;
    if public.is_super_admin(_delivery_person_id) then raise exception 'That member cannot be assigned'; end if;
    if not exists (select 1 from public.profiles p where p.id = _delivery_person_id and p.deleted_at is null and p.status = 'active') then
      raise exception 'That member is not available';
    end if;
  end if;
  _new_collector := (_collector_id is distinct from _o.collector_id);
  if _new_collector and _o.cod_hold_ledger_id is not null then
    raise exception 'The collector cannot change while their coins are held — cancel the order instead';
  end if;
  if _collector_id is not null then
    if _o.payment_method <> 'cod' then raise exception 'Only cash-on-delivery orders use a collector'; end if;
    if _collector_id = _o.customer_id then raise exception 'The customer cannot collect their own payment'; end if;
    if public.is_super_admin(_collector_id) then raise exception 'That member cannot be a collector'; end if;
    if not exists (select 1 from public.profiles p where p.id = _collector_id and p.deleted_at is null and p.status = 'active') then
      raise exception 'That member is not available';
    end if;
    _need := round(_o.total + _o.delivery_fee, 2);
    select a.balance into _bal from public.credit_accounts a where a.user_id = _collector_id and a.ecosystem_id is null;
    if coalesce(_bal, 0) < _need then
      raise exception 'That member does not have % available coins to collect this order', _need;
    end if;
  end if;

  update public.retail_orders
     set self_delivery = coalesce(_self_delivery, false),
         delivery_person_id = _delivery_person_id,
         collector_id = _collector_id,
         collector_status = case when _collector_id is null then 'none'
                                 when _new_collector then 'proposed' else collector_status end,
         collector_responded_at = case when _new_collector then null else collector_responded_at end
   where id = _o.id and status = 'approved';

  perform public.retail_sync_order_chat(_o.id);

  if _delivery_person_id is not null and _delivery_person_id is distinct from _o.delivery_person_id then
    perform public.notify_member(_delivery_person_id, _o.ecosystem_id, 'retail_order',
      'Delivery assigned — ' || _o.order_no, 'You were assigned to deliver order ' || _o.order_no || ' to ' || _o.customer_name || '.', '/universe/wallet');
  end if;
  if _collector_id is not null and _new_collector then
    perform public.notify_member(_collector_id, _o.ecosystem_id, 'retail_order',
      'Collector request — ' || _o.order_no,
      'Approve to hold ' || _need::text || ' coins as the cash float for order ' || _o.order_no || '.', '/universe/wallet');
  end if;
  select coalesce(full_name, 'Member') into _actor from public.profiles where id = _uid;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, _uid, _actor, 'Retail delivery assignment', _o.order_no,
          jsonb_build_object('order_id', _o.id, 'self_delivery', coalesce(_self_delivery,false),
                             'delivery_person_id', _delivery_person_id, 'collector_id', _collector_id));
end $$;

create or replace function public.retail_cod_collector_respond(_order_id uuid, _accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _uid uuid := auth.uid(); _need numeric(14,2); _acct uuid; _tx text; _hold uuid; _actor text;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  perform public.assert_actor_active();
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.collector_id is distinct from _uid then raise exception 'You are not the collector for this order'; end if;
  if _o.payment_method <> 'cod' or _o.status <> 'approved' then raise exception 'This order is not awaiting a collector'; end if;
  if _o.collector_status <> 'proposed' then raise exception 'You already responded to this request'; end if;
  if _o.cod_hold_ledger_id is not null then raise exception 'Coins are already held for this order'; end if;
  if not public.retail_cod_seller_funded(_o.ecosystem_id, coalesce(_o.platform_fee_amount, 0)) then
    raise exception 'Cash on delivery is temporarily unavailable for this shop';
  end if;
  if not _accept then
    update public.retail_orders set collector_status = 'declined', collector_responded_at = now() where id = _o.id;
    perform public.retail_sync_order_chat(_o.id);
    perform public.notify_member(coalesce(_o.seller_id, public.retail_settlement_recipient(_o.ecosystem_id)), _o.ecosystem_id, 'retail_order',
      'Collector declined — ' || _o.order_no, 'Assign another collector for order ' || _o.order_no || '.', '/admin/orders');
    return;
  end if;
  _need := round(_o.total + _o.delivery_fee, 2);
  _acct := public.ensure_global_wallet(_uid);
  _tx := public.new_tx_id();
  insert into public.credit_ledger
    (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, entry_kind)
  values (_acct, _uid, _o.ecosystem_id, 'debit', _need, 0,
          'Cash-on-delivery float held — ' || _o.order_no, _o.order_no, _uid, _tx, 'retail_cod_hold')
  returning id into _hold;
  update public.retail_orders
     set collector_status = 'approved', collector_responded_at = now(),
         cod_hold_tx = _tx, cod_hold_ledger_id = _hold, cod_expected_cash = _need
   where id = _o.id and cod_hold_ledger_id is null;
  if not found then raise exception 'Coins are already held for this order'; end if;
  perform public.notify_member(coalesce(_o.seller_id, public.retail_settlement_recipient(_o.ecosystem_id)), _o.ecosystem_id, 'retail_order',
    'Collector approved — ' || _o.order_no, _need::text || ' coins are now held as the cash float. The order can go out for delivery.', '/admin/orders');
  select coalesce(full_name, 'Member') into _actor from public.profiles where id = _uid;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, _uid, _actor, 'COD float held', _o.order_no,
          jsonb_build_object('order_id', _o.id, 'amount', _need, 'hold_ledger_id', _hold, 'tx_id', _tx));
end $$;

create or replace function public.retail_cod_settle(_order_id uuid, _kind text, _actor uuid, _actual numeric)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _recipient uuid; _racct uuid; _settle uuid; _cb_ledger uuid; _cbacct uuid;
        _seller numeric(14,2); _fee numeric(14,2); _cb numeric(14,2) := 0; _admin_amt numeric(14,2);
        _dfee numeric(14,2); _d_amt numeric(14,2); _c_amt numeric(14,2); _d_to uuid; _d_ledger uuid; _c_ledger uuid;
        _held numeric(14,2); _dacct uuid; _cacct uuid;
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.payment_method <> 'cod' or _o.status <> 'approved' then raise exception 'Order % cannot settle', _o.order_no; end if;
  if _o.cod_hold_ledger_id is null or _o.collector_status <> 'approved' then
    raise exception 'Order % has no collector hold to settle', _o.order_no;
  end if;
  if _o.cod_settled_at is not null or _o.settlement_ledger_id is not null or _o.cashback_ledger_id is not null
     or _o.refund_ledger_id is not null or _o.credit_released then
    raise exception 'Order % was already settled or released', _o.order_no;
  end if;
  select amount into _held from public.credit_ledger where id = _o.cod_hold_ledger_id and direction = 'debit' and entry_kind = 'retail_cod_hold';
  _seller := coalesce(_o.seller_total, 0); _fee := coalesce(_o.platform_fee_amount, 0); _dfee := coalesce(_o.delivery_fee, 0);
  if _held is null or _held <> round(_seller + _fee + _dfee, 2) or _held <> _o.cod_expected_cash then
    raise exception 'Order % hold does not match its locked economics', _o.order_no;
  end if;
  if _o.delivery_split_delivery_pct + _o.delivery_split_collector_pct <> 100 then
    raise exception 'Order % delivery split snapshot is invalid', _o.order_no;
  end if;
  _recipient := public.retail_settlement_recipient(_o.ecosystem_id);
  if _recipient is null then raise exception 'This shop has no active admin to receive the payment'; end if;
  _cb := case when _o.cashback_recipient_id is not null and not public.is_super_admin(_o.cashback_recipient_id)
              then coalesce(_o.cashback_total, 0) else 0 end;
  if _cb < 0 or _cb > _seller then raise exception 'Order cashback snapshot is inconsistent'; end if;
  _admin_amt := round(_seller - _cb, 2);
  _d_amt := round(_dfee * _o.delivery_split_delivery_pct / 100, 2);
  _c_amt := round(_dfee - _d_amt, 2);
  if round(_admin_amt + _cb + _fee + _d_amt + _c_amt, 2) <> _held then
    raise exception 'Order % allocations (%) do not reconcile with the hold (%)', _o.order_no, _admin_amt + _cb + _fee + _d_amt + _c_amt, _held;
  end if;
  _d_to := coalesce(_o.delivery_person_id, _o.seller_id, _recipient);

  _racct := public.retail_wallet_for(_recipient, _o.ecosystem_id);
  if _admin_amt > 0 then
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, entry_kind)
    values (_racct, _recipient, _o.ecosystem_id, 'credit', _admin_amt, 0,
            'Retail sale (cash on delivery) — ' || _o.order_no || ' (' || _o.customer_name || ')'
              || case when _cb > 0 then ' after ' || _cb::text || ' coins cashback' else '' end,
            _o.order_no, _actor, _o.cod_hold_tx || '-S', 'retail_settlement')
    returning id into _settle;
  end if;
  if _cb > 0 then
    _cbacct := public.retail_wallet_for(_o.cashback_recipient_id, _o.ecosystem_id);
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, entry_kind, base_amount, commission_amount)
    values (_cbacct, _o.cashback_recipient_id, _o.ecosystem_id, 'credit', _cb, 0,
            'Retail cashback — ' || _o.order_no || ' (' || _o.customer_name || ')',
            _o.order_no, _actor, _o.cod_hold_tx || '-CB', 'retail_cashback', _seller, _cb)
    returning id into _cb_ledger;
  end if;
  if _fee > 0 then
    insert into public.retail_platform_fees (order_id, ecosystem_id, tx_id, seller_credits, fee_percent, fee_credits)
    values (_o.id, _o.ecosystem_id, _o.cod_hold_tx || '-F', _seller, coalesce(_o.platform_fee_percent, 0), _fee)
    on conflict (order_id) do nothing;
  end if;
  if _d_amt > 0 then
    _dacct := public.retail_wallet_for(_d_to, _o.ecosystem_id);
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, entry_kind, base_amount, commission_percent, commission_amount)
    values (_dacct, _d_to, _o.ecosystem_id, 'credit', _d_amt, 0,
            'Delivery share — ' || _o.order_no || ' (' || _o.delivery_split_delivery_pct || '% of ' || _dfee || ')',
            _o.order_no, _actor, _o.cod_hold_tx || '-D', 'retail_delivery_share', _dfee, _o.delivery_split_delivery_pct, _d_amt)
    returning id into _d_ledger;
  end if;
  if _c_amt > 0 then
    _cacct := public.retail_wallet_for(_o.collector_id, _o.ecosystem_id);
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, entry_kind, base_amount, commission_percent, commission_amount)
    values (_cacct, _o.collector_id, _o.ecosystem_id, 'credit', _c_amt, 0,
            'Collector share — ' || _o.order_no || ' (' || _o.delivery_split_collector_pct || '% of ' || _dfee || ')',
            _o.order_no, _actor, _o.cod_hold_tx || '-C', 'retail_collector_share', _dfee, _o.delivery_split_collector_pct, _c_amt)
    returning id into _c_ledger;
  end if;

  update public.retail_orders
     set cod_settled_at = now(), cod_settlement_kind = _kind,
         cod_actual_cash = coalesce(_actual, cod_actual_cash, cod_expected_cash),
         cod_cash_received_at = coalesce(cod_cash_received_at, now()),
         cod_discrepancy = false,
         settlement_ledger_id = _settle, settled_to = case when _settle is not null then _recipient end,
         cashback_ledger_id = _cb_ledger, delivery_share_ledger_id = _d_ledger, collector_share_ledger_id = _c_ledger
   where id = _o.id and cod_settled_at is null;
  if not found then raise exception 'Order % was already settled', _o.order_no; end if;

  perform public.notify_member(_recipient, _o.ecosystem_id, 'retail_order', 'Order ' || _o.order_no || ' settled',
    _admin_amt::text || ' coins credited from the cash-on-delivery float.', '/admin/orders');
  perform public.notify_member(_o.collector_id, _o.ecosystem_id, 'retail_order', 'Order ' || _o.order_no || ' settled',
    'Your held float was settled' || case when _c_amt > 0 then '; your collector share of ' || _c_amt::text || ' coins was credited.' else '.' end, '/universe/wallet');
  if _d_amt > 0 and _d_to not in (_recipient, _o.collector_id) then
    perform public.notify_member(_d_to, _o.ecosystem_id, 'retail_order', 'Delivery share — ' || _o.order_no,
      _d_amt::text || ' coins were credited for delivering order ' || _o.order_no || '.', '/universe/wallet');
  end if;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, _actor, (select coalesce(full_name,'Member') from public.profiles where id = _actor),
          'COD settlement (' || _kind || ')', _o.order_no,
          jsonb_build_object('order_id', _o.id, 'held', _held, 'seller_amount', _admin_amt, 'cashback', _cb,
                             'platform_fee', _fee, 'delivery_share', _d_amt, 'delivery_to', _d_to,
                             'collector_share', _c_amt, 'collector_id', _o.collector_id,
                             'settlement_ledger_id', _settle, 'cashback_ledger_id', _cb_ledger,
                             'delivery_share_ledger_id', _d_ledger, 'collector_share_ledger_id', _c_ledger));
end $$;
revoke all on function public.retail_cod_settle(uuid, text, uuid, numeric) from public, anon, authenticated;

create or replace function public.retail_cod_cash_received(_order_id uuid, _actual_cash numeric)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _uid uuid := auth.uid(); _actual numeric(14,2);
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.collector_id is distinct from _uid then raise exception 'Only the assigned collector can confirm cash'; end if;
  if _o.status <> 'approved' or _o.payment_method <> 'cod' or _o.cod_hold_ledger_id is null then
    raise exception 'This order has no active cash float';
  end if;
  if _o.fulfillment_status not in ('out_for_delivery','delivered','completed') then
    raise exception 'Cash can only be confirmed once the order is out for delivery';
  end if;
  if _o.cod_settled_at is not null or _o.cod_cash_received_at is not null then
    raise exception 'Cash was already confirmed for order %', _o.order_no;
  end if;
  _actual := round(coalesce(_actual_cash, -1), 2);
  if _actual < 0 then raise exception 'Enter the cash amount received'; end if;
  if _actual = _o.cod_expected_cash then
    perform public.retail_cod_settle(_o.id, 'collector_confirmed', _uid, _actual);
  else
    update public.retail_orders
       set cod_actual_cash = _actual, cod_cash_received_at = now(), cod_discrepancy = true
     where id = _o.id and cod_cash_received_at is null;
    perform public.notify_member(public.retail_settlement_recipient(_o.ecosystem_id), _o.ecosystem_id, 'retail_order',
      'Cash discrepancy — ' || _o.order_no,
      'Collector received ' || _actual::text || ' but ' || _o.cod_expected_cash::text || ' was expected. Resolve it in Retail orders.', '/admin/orders');
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_o.ecosystem_id, _uid, (select coalesce(full_name,'Member') from public.profiles where id = _uid),
            'COD cash discrepancy', _o.order_no,
            jsonb_build_object('order_id', _o.id, 'expected', _o.cod_expected_cash, 'actual', _actual));
  end if;
end $$;

create or replace function public.retail_cod_fallback_days() returns integer
language sql immutable as $$ select 3 $$;

create or replace function public.retail_cod_seller_release(_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _uid uuid := auth.uid();
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if not public.retail_cod_manager(_o, _uid) then raise exception 'Only the seller can release this float'; end if;
  if _o.status <> 'approved' or _o.payment_method <> 'cod' or _o.cod_hold_ledger_id is null then
    raise exception 'This order has no active cash float';
  end if;
  if _o.cod_settled_at is not null then raise exception 'Order % was already settled', _o.order_no; end if;
  if _o.cod_discrepancy then raise exception 'This order has a cash discrepancy — the shop admin must resolve it'; end if;
  if _o.completed_at is null then raise exception 'The customer has not confirmed receipt yet'; end if;
  if now() < _o.completed_at + make_interval(days => public.retail_cod_fallback_days()) then
    raise exception 'Held coins can be released % days after the customer confirmed receipt (%)',
      public.retail_cod_fallback_days(), to_char(_o.completed_at + make_interval(days => public.retail_cod_fallback_days()), 'YYYY-MM-DD HH24:MI');
  end if;
  perform public.retail_cod_settle(_o.id, 'seller_release', _uid, null);
end $$;

create or replace function public.retail_cod_cancel_internal(_order_id uuid, _actor uuid, _note text, _kind text)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _it record; _rel uuid; _acct uuid; _held numeric(14,2);
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.payment_method <> 'cod' or _o.status <> 'approved' then raise exception 'Order % cannot be cancelled', _o.order_no; end if;
  if _o.cod_settled_at is not null or _o.settlement_ledger_id is not null or _o.refund_ledger_id is not null or _o.credit_released then
    raise exception 'Order % was already settled or released', _o.order_no;
  end if;
  if _o.cod_hold_ledger_id is not null then
    select amount into _held from public.credit_ledger where id = _o.cod_hold_ledger_id and direction = 'debit';
    if _held is null or _held <> _o.cod_expected_cash then raise exception 'Order % hold does not match', _o.order_no; end if;
    _acct := public.ensure_global_wallet(_o.collector_id);
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, entry_kind, reverses_ledger_id)
    values (_acct, _o.collector_id, _o.ecosystem_id, 'credit', _held, 0,
            'Cash-on-delivery float released — ' || _o.order_no, _o.order_no, _actor,
            _o.cod_hold_tx || '-R', 'retail_cod_release', _o.cod_hold_ledger_id)
    returning id into _rel;
  end if;
  for _it in select * from public.retail_order_items where order_id = _o.id loop
    update public.retail_products set stock = stock + _it.quantity, sold_count = greatest(sold_count - _it.quantity, 0) where id = _it.product_id;
  end loop;
  update public.retail_orders
     set status = 'cancelled', refund_ledger_id = _rel, credit_released = true,
         decision_note = coalesce(nullif(btrim(coalesce(_note,'')), ''), decision_note),
         decided_at = now(), decided_by = _actor
   where id = _o.id and status = 'approved';
  if not found then raise exception 'Order % was already changed', _o.order_no; end if;
  perform public.notify_member(_o.customer_id, _o.ecosystem_id, 'retail_order', 'Order ' || _o.order_no || ' cancelled',
    coalesce(nullif(btrim(coalesce(_note,'')), ''), 'The seller cancelled this order. Nothing was charged.'), '/app/store');
  if _rel is not null then
    perform public.notify_member(_o.collector_id, _o.ecosystem_id, 'retail_order', 'Float released — ' || _o.order_no,
      _held::text || ' coins are available again.', '/universe/wallet');
  end if;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, _actor, (select coalesce(full_name,'Member') from public.profiles where id = _actor),
          'COD order cancelled (' || _kind || ')', _o.order_no,
          jsonb_build_object('order_id', _o.id, 'released', _held, 'release_ledger_id', _rel, 'note', _note));
end $$;
revoke all on function public.retail_cod_cancel_internal(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.retail_cod_seller_cancel(_order_id uuid, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _uid uuid := auth.uid();
begin
  select * into _o from public.retail_orders where id = _order_id;
  if _o.id is null then raise exception 'Order not found'; end if;
  if not public.retail_cod_manager(_o, _uid) then raise exception 'Only the seller can cancel this order'; end if;
  if _o.cod_discrepancy and not (public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid)) then
    raise exception 'This order has a cash discrepancy — the shop admin must resolve it';
  end if;
  perform public.retail_cod_cancel_internal(_o.id, _uid, _note, 'seller');
end $$;

create or replace function public.retail_cod_resolve_discrepancy(_order_id uuid, _action text, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _uid uuid := auth.uid();
begin
  select * into _o from public.retail_orders where id = _order_id;
  if _o.id is null then raise exception 'Order not found'; end if;
  if not (public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid)) then
    raise exception 'Only the shop admin can resolve a cash discrepancy';
  end if;
  if not _o.cod_discrepancy or _o.cod_settled_at is not null then raise exception 'This order has no open discrepancy'; end if;
  if _action = 'settle' then
    perform public.retail_cod_settle(_o.id, 'admin_resolved', _uid, _o.cod_actual_cash);
  elsif _action = 'cancel' then
    perform public.retail_cod_cancel_internal(_o.id, _uid, _note, 'discrepancy');
  else
    raise exception 'Choose settle or cancel';
  end if;
end $$;

-- ---------------------------------------------------------------- collector / delivery views
create or replace function public.retail_cod_held_total()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(o.cod_expected_cash), 0)
    from public.retail_orders o
   where o.collector_id = auth.uid() and o.cod_hold_ledger_id is not null
     and o.cod_settled_at is null and o.refund_ledger_id is null and o.status = 'approved';
$$;

create or replace function public.retail_my_cod_assignments()
returns table(id uuid, order_no text, shop_name text, customer_name text, delivery_address text, delivery_notes text,
              status text, fulfillment_status text, my_role text, collector_status text, self_delivery boolean,
              total numeric, delivery_fee numeric, expected_cash numeric, actual_cash numeric,
              hold_held boolean, cash_received_at timestamptz, discrepancy boolean, settled_at timestamptz,
              completed_at timestamptz, my_share numeric, chat_thread_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.order_no, e.name, o.customer_name, o.delivery_address, o.delivery_notes,
         o.status, o.fulfillment_status,
         case when o.collector_id = auth.uid() then 'collector' else 'delivery' end,
         o.collector_status, o.self_delivery,
         o.total, o.delivery_fee, coalesce(o.cod_expected_cash, round(o.total + o.delivery_fee, 2)), o.cod_actual_cash,
         o.cod_hold_ledger_id is not null and o.cod_settled_at is null and o.refund_ledger_id is null,
         o.cod_cash_received_at, o.cod_discrepancy, o.cod_settled_at, o.completed_at,
         coalesce((select l.amount from public.credit_ledger l
                    where l.id = case when o.collector_id = auth.uid() then o.collector_share_ledger_id else o.delivery_share_ledger_id end), 0),
         o.chat_thread_id, o.created_at
    from public.retail_orders o join public.ecosystems e on e.id = o.ecosystem_id
   where (o.collector_id = auth.uid() and o.collector_status in ('proposed','approved'))
      or o.delivery_person_id = auth.uid()
   order by (o.status = 'approved' and o.cod_settled_at is null) desc, o.created_at desc
   limit 200;
$$;

-- ---------------------------------------------------------------- order lists
drop function if exists public.list_retail_orders(uuid, text);
create function public.list_retail_orders(_ecosystem_id uuid, _status text default null)
returns table(id uuid, order_no text, customer_id uuid, customer_name text, status text, fulfillment text,
              fulfillment_status text, delivered_at timestamptz, completed_at timestamptz, seller_id uuid, seller_name text,
              delivery_address text, delivery_notes text, payment_method text, total numeric, seller_total numeric,
              platform_fee_percent numeric, platform_fee_amount numeric, decision_note text, created_at timestamptz, items jsonb,
              delivery_fee numeric, delivery_split_delivery_pct integer, delivery_split_collector_pct integer,
              self_delivery boolean, delivery_person_id uuid, delivery_person_name text,
              collector_id uuid, collector_name text, collector_status text,
              hold_held boolean, cod_expected_cash numeric, cod_actual_cash numeric, cod_cash_received_at timestamptz,
              cod_discrepancy boolean, cod_settled_at timestamptz, cod_settlement_kind text,
              seller_amount numeric, cashback_amount numeric, delivery_share_amount numeric, collector_share_amount numeric,
              chat_thread_id uuid)
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
                    from public.retail_order_items i where i.order_id = o.id), '[]'::jsonb),
         o.delivery_fee, o.delivery_split_delivery_pct, o.delivery_split_collector_pct,
         o.self_delivery, o.delivery_person_id, (select p.full_name from public.profiles p where p.id = o.delivery_person_id),
         o.collector_id, (select p.full_name from public.profiles p where p.id = o.collector_id), o.collector_status,
         o.cod_hold_ledger_id is not null and o.cod_settled_at is null and o.refund_ledger_id is null,
         o.cod_expected_cash, o.cod_actual_cash, o.cod_cash_received_at, o.cod_discrepancy, o.cod_settled_at, o.cod_settlement_kind,
         (select l.amount from public.credit_ledger l where l.id = o.settlement_ledger_id),
         (select l.amount from public.credit_ledger l where l.id = o.cashback_ledger_id),
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
$$;

drop function if exists public.my_retail_orders(uuid);
create function public.my_retail_orders(_ecosystem_id uuid)
returns table(id uuid, order_no text, status text, fulfillment text, fulfillment_status text, delivered_at timestamptz,
              completed_at timestamptz, shop_name text, seller_name text, delivery_address text, delivery_notes text,
              payment_method text, total numeric, seller_total numeric, platform_fee_percent numeric, platform_fee_amount numeric,
              decision_note text, created_at timestamptz, items jsonb,
              delivery_fee numeric, self_delivery boolean, delivery_person_name text, collector_name text, collector_status text,
              hold_held boolean, cod_settled_at timestamptz, chat_thread_id uuid)
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
                    from public.retail_order_items i where i.order_id = o.id), '[]'::jsonb),
         o.delivery_fee, o.self_delivery,
         (select p.full_name from public.profiles p where p.id = o.delivery_person_id),
         case when o.collector_status = 'approved' then (select p.full_name from public.profiles p where p.id = o.collector_id) end,
         o.collector_status,
         o.cod_hold_ledger_id is not null and o.cod_settled_at is null and o.refund_ledger_id is null,
         o.cod_settled_at, o.chat_thread_id
    from public.retail_orders o
   where o.ecosystem_id = _ecosystem_id and o.customer_id = public.effective_uid()
   order by o.created_at desc
   limit 100;
$$;

-- ---------------------------------------------------------------- place order (adds 'cod')
create or replace function public.retail_place_order(_ecosystem_id uuid, _items jsonb, _fulfillment text, _payment_method text, _address text default null, _notes text default null, _seller_id uuid default null)
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
     delivery_fee, delivery_split_delivery_pct, delivery_split_collector_pct)
  values (_ono, _ecosystem_id, _uid, _name, _fulfillment,
          nullif(btrim(coalesce(_address,'')), ''), nullif(btrim(coalesce(_notes,'')), ''),
          _payment_method, 0, 0, _pct, 0, _seller, _cb_recipient, 0,
          _dfee, _dpct, _cpct)
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

-- ---------------------------------------------------------------- review (R4 body; adds order chat on approval)
create or replace function public.retail_review_order(_order_id uuid, _approve boolean, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
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
                             'cashback_recipient_id', _o.cashback_recipient_id,
                             'customer_id', _o.customer_id, 'note', _note,
                             'settlement_ledger_id', _settle, 'cashback_ledger_id', _cb_ledger,
                             'refund_ledger_id', _refund));
end $$;

-- ---------------------------------------------------------------- fulfillment (R5 body; adds COD gate + delivery-person hand-over)
create or replace function public.retail_update_fulfillment(_order_id uuid, _next text)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.retail_orders; _uid uuid := auth.uid(); _eff uuid := public.effective_uid();
        _is_admin boolean; _is_seller boolean; _is_customer boolean; _is_courier boolean; _actor text; _title text; _body text;
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  _is_admin := public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid);
  _is_seller := _o.seller_id is not null and _o.seller_id = _uid and public.retail_seller_allowed(_uid, _o.ecosystem_id);
  _is_customer := _o.customer_id = _eff;
  _is_courier := _o.delivery_person_id is not null and _o.delivery_person_id = _uid;
  if not (_is_admin or _is_seller or _is_customer or _is_courier) then
    raise exception 'You are not allowed to update this order';
  end if;
  if _o.status <> 'approved' then
    raise exception 'Order % is % and has no fulfillment to update', _o.order_no, _o.status;
  end if;
  if _next = 'completed' then
    if not (_is_customer or _is_admin) then
      raise exception 'Only the customer can confirm receipt of this order';
    end if;
  elsif _next = 'delivered' and _is_courier and _o.fulfillment_status = 'out_for_delivery' then
    null;
  elsif not (_is_admin or _is_seller) then
    raise exception 'Only the seller can update fulfillment for this order';
  end if;
  if not public.retail_fulfillment_step_ok(_o.fulfillment_status, _next, _o.fulfillment) then
    raise exception 'Order % cannot move from % to %', _o.order_no, _o.fulfillment_status, _next;
  end if;
  if _next = 'out_for_delivery' and _o.payment_method = 'cod'
     and (_o.collector_status <> 'approved' or _o.cod_hold_ledger_id is null) then
    raise exception 'Order % needs an approved collector (coins held) before it goes out for delivery', _o.order_no;
  end if;

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
  if _next = 'completed' and _o.payment_method = 'cod' and _o.cod_hold_ledger_id is not null and _o.cod_settled_at is null then
    perform public.notify_member(_o.collector_id, _o.ecosystem_id, 'retail_order', 'Confirm cash — ' || _o.order_no,
      'The customer confirmed receipt. Mark CASH RECEIVED to settle the float.', '/universe/wallet');
  end if;

  select coalesce(full_name, 'Member') into _actor from public.profiles where id = _uid;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, _uid, _actor, 'Retail fulfillment: ' || _next, _o.order_no,
          jsonb_build_object('order_id', _o.id, 'from', _o.fulfillment_status, 'to', _next,
                             'by', case when _is_admin then 'admin' when _is_seller then 'seller' when _is_courier then 'delivery' else 'customer' end));
end $$;

-- ---------------------------------------------------------------- chat RPCs
drop function if exists public.dm_thread_list();
create function public.dm_thread_list()
returns table(thread_id uuid, member_id uuid, member_name text, member_handle text, member_avatar text,
              last_message_at timestamptz, preview text, unread integer, blocked boolean,
              kind text, order_id uuid, title text, participants jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  return query
  select t.id,
         other.id, coalesce(other.full_name,'Member'), other.handle, other.avatar_path,
         t.last_message_at, t.last_message_preview,
         (select count(*)::int from public.dm_messages m
           where m.thread_id = t.id and m.recipient_id = auth.uid() and m.read_at is null),
         exists (select 1 from public.social_blocks b
                  where (b.blocker_id = auth.uid() and b.blocked_id = other.id)
                     or (b.blocker_id = other.id and b.blocked_id = auth.uid())),
         t.kind, t.order_id, t.title, '[]'::jsonb
    from public.dm_threads t
    join public.profiles other
      on other.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
   where t.kind = 'direct' and auth.uid() in (t.user_a, t.user_b)
  union all
  select t.id, null, null, null, null,
         t.last_message_at, t.last_message_preview,
         (select count(*)::int from public.dm_messages m
           where m.thread_id = t.id and m.sender_id <> auth.uid()
             and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz)),
         false,
         t.kind, t.order_id, t.title,
         coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.full_name,'Member'),
                                                       'handle', p.handle, 'avatar', p.avatar_path, 'role', mm.member_role)
                                    order by mm.added_at)
                     from public.dm_thread_members mm join public.profiles p on p.id = mm.user_id
                    where mm.thread_id = t.id and mm.removed_at is null), '[]'::jsonb)
    from public.dm_threads t
    join public.dm_thread_members me on me.thread_id = t.id and me.user_id = auth.uid() and me.removed_at is null
   where t.kind = 'order'
   order by coalesce(last_message_at, now()) desc;
end $$;

drop function if exists public.dm_messages_for(uuid);
create function public.dm_messages_for(_thread_id uuid)
returns table(id uuid, sender_id uuid, body text, image_path text, created_at timestamptz, mine boolean, sender_name text)
language plpgsql security definer set search_path = public as $$
declare _t public.dm_threads;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into _t from public.dm_threads t where t.id = _thread_id;
  if _t.id is null then raise exception 'Conversation not found'; end if;
  if _t.kind = 'direct' then
    if auth.uid() not in (_t.user_a, _t.user_b) then raise exception 'Conversation not found'; end if;
    update public.dm_messages set read_at = now()
     where thread_id = _thread_id and recipient_id = auth.uid() and read_at is null;
  else
    if not public.dm_is_active_member(_thread_id, auth.uid()) then raise exception 'Conversation not found'; end if;
    update public.dm_thread_members set last_read_at = now() where thread_id = _thread_id and user_id = auth.uid();
  end if;
  return query
  select m.id, m.sender_id, m.body, m.image_path, m.created_at, m.sender_id = auth.uid(),
         (select coalesce(p.full_name, 'Member') from public.profiles p where p.id = m.sender_id)
    from public.dm_messages m where m.thread_id = _thread_id order by m.created_at;
end $$;

create or replace function public.dm_send_thread(_thread_id uuid, _body text, _image_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _t public.dm_threads; _mid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  if length(btrim(coalesce(_body,''))) = 0 and _image_path is null then raise exception 'Write a message first'; end if;
  if length(coalesce(_body,'')) > 2000 then raise exception 'That message is too long'; end if;
  if (select count(*) from public.dm_messages
       where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'You are sending messages too quickly — please slow down';
  end if;
  select * into _t from public.dm_threads t where t.id = _thread_id;
  if _t.id is null or _t.kind <> 'order' then raise exception 'Conversation not found'; end if;
  if not public.dm_is_active_member(_thread_id, auth.uid()) then raise exception 'You are not part of this conversation'; end if;
  if _image_path is not null and split_part(_image_path, '/', 1) <> _t.ecosystem_id::text then
    raise exception 'Invalid image location';
  end if;
  insert into public.dm_messages (thread_id, ecosystem_id, sender_id, recipient_id, body, image_path)
  values (_t.id, _t.ecosystem_id, auth.uid(), null, btrim(coalesce(_body,'')), _image_path)
  returning id into _mid;
  update public.dm_threads
     set last_message_at = now(),
         last_message_preview = coalesce(nullif(left(btrim(coalesce(_body,'')), 120), ''), 'Photo')
   where id = _t.id;
  update public.dm_thread_members set last_read_at = now() where thread_id = _t.id and user_id = auth.uid();
  return jsonb_build_object('thread_id', _t.id, 'message_id', _mid);
end $$;

create or replace function public.dm_unread_count()
returns integer language sql stable security definer set search_path = public as $$
  select (select coalesce(count(*),0)::int from public.dm_messages
           where recipient_id = auth.uid() and read_at is null)
       + (select coalesce(count(*),0)::int
            from public.dm_thread_members me
            join public.dm_messages m on m.thread_id = me.thread_id
           where me.user_id = auth.uid() and me.removed_at is null
             and m.sender_id <> auth.uid() and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz));
$$;