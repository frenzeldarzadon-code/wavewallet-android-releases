-- 1. Per-shop reward points switch -------------------------------------------
alter table public.ecosystems
  add column if not exists points_enabled boolean not null default true,
  add column if not exists points_enabled_changed_at timestamptz;

-- 2. Audit trail of disabled-period point → coin conversions -------------------
create table if not exists public.points_disabled_conversions (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  admin_id uuid,
  source_kind text not null,
  sale_id uuid,
  retail_order_id uuid,
  user_id uuid,
  would_be_points numeric(14,2) not null,
  coin_equivalent numeric(14,2) not null,
  amount_debited numeric(14,2) not null default 0,
  shortfall numeric(14,2) not null default 0,
  status text not null,
  ledger_id uuid,
  tx_id text,
  reversed_at timestamptz,
  reversal_ledger_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.points_disabled_conversions to authenticated;
grant all on public.points_disabled_conversions to service_role;

alter table public.points_disabled_conversions enable row level security;

drop policy if exists "Shop admins and platform owner read conversions" on public.points_disabled_conversions;
create policy "Shop admins and platform owner read conversions"
on public.points_disabled_conversions for select to authenticated
using (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), ecosystem_id));

create unique index if not exists points_disabled_conversions_sale_uniq
  on public.points_disabled_conversions (sale_id) where sale_id is not null;
create unique index if not exists points_disabled_conversions_order_uniq
  on public.points_disabled_conversions (retail_order_id) where retail_order_id is not null;
create index if not exists points_disabled_conversions_eco_idx
  on public.points_disabled_conversions (ecosystem_id, created_at desc);

drop trigger if exists points_disabled_conversions_touch on public.points_disabled_conversions;
create trigger points_disabled_conversions_touch
before update on public.points_disabled_conversions
for each row execute function public.set_updated_at();

-- 3. Read + write helpers ------------------------------------------------------
create or replace function public.shop_points_enabled(_ecosystem_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select coalesce((select e.points_enabled from public.ecosystems e where e.id = _ecosystem_id), true);
$$;

grant execute on function public.shop_points_enabled(uuid) to authenticated, anon;

create or replace function public.set_points_enabled(_ecosystem_id uuid, _enabled boolean)
returns boolean
language plpgsql security definer set search_path to 'public'
as $$
declare _actor text; _prev boolean; _ver integer;
begin
  perform public.require_operational();
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  select points_enabled, points_rule_version into _prev, _ver
    from public.ecosystems where id = _ecosystem_id;
  if _prev is null then raise exception 'Shop not found'; end if;
  if _prev = coalesce(_enabled, true) then return _prev; end if;

  -- Turning points back ON starts a FRESH earning period: the rule version is
  -- bumped so new awards are clearly separated from the disabled period.
  -- Nothing historical is replayed, restored or refunded.
  update public.ecosystems
     set points_enabled = coalesce(_enabled, true),
         points_rule_version = coalesce(_ver, 1) + 1,
         points_rule_updated_at = now(),
         points_enabled_changed_at = now()
   where id = _ecosystem_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Admin'),
          case when coalesce(_enabled, true) then 'Enabled reward points' else 'Disabled reward points' end,
          '',
          jsonb_build_object('previous', _prev, 'new', coalesce(_enabled, true),
                             'version', coalesce(_ver, 1) + 1,
                             'applies_to', 'future qualifying purchases only',
                             'historical_conversions', 'kept as charged'));
  return coalesce(_enabled, true);
end; $$;

grant execute on function public.set_points_enabled(uuid, boolean) to authenticated;

-- 4. Authoritative 1 point = 1 coin settlement while points are OFF ------------
create or replace function public.points_disabled_settlement(
  _eco uuid, _points numeric, _sale_id uuid, _order_id uuid, _user uuid)
returns numeric
language plpgsql security definer set search_path to 'public'
as $$
declare _admin uuid; _acct uuid; _cap numeric(14,2); _amt numeric(14,2);
        _tx text; _ledger uuid; _pts numeric(14,2) := round(coalesce(_points,0), 2);
        _kind text := case when _order_id is not null then 'retail_order' else 'voucher_sale' end;
begin
  if _pts <= 0 then return 0; end if;

  if (_sale_id is not null and exists (select 1 from public.points_disabled_conversions c
                                        where c.sale_id = _sale_id))
     or (_order_id is not null and exists (select 1 from public.points_disabled_conversions c
                                            where c.retail_order_id = _order_id)) then
    return 0;  -- already settled: never charge the same sale twice
  end if;

  _admin := public.shop_primary_admin(_eco);
  if _admin is null then
    insert into public.points_disabled_conversions
      (ecosystem_id, admin_id, source_kind, sale_id, retail_order_id, user_id,
       would_be_points, coin_equivalent, amount_debited, shortfall, status)
    values (_eco, null, _kind, _sale_id, _order_id, _user, _pts, _pts, 0, _pts, 'unresolved_no_admin')
    on conflict do nothing;
    return 0;
  end if;

  -- Admin self-purchase already paid the point coin cost inside the net charge
  -- (voucher_admin_self_net). Record it, never debit a second time.
  if _sale_id is not null and exists (
       select 1 from public.voucher_sales vs
        where vs.id = _sale_id and vs.buyer_id = _admin and vs.buyer_role = 'admin'
          and coalesce(vs.self_cashback, 0) > 0) then
    insert into public.points_disabled_conversions
      (ecosystem_id, admin_id, source_kind, sale_id, retail_order_id, user_id,
       would_be_points, coin_equivalent, amount_debited, shortfall, status)
    values (_eco, _admin, _kind, _sale_id, _order_id, _user, _pts, _pts, _pts, 0, 'paid_at_purchase')
    on conflict do nothing;
    return _pts;
  end if;

  _acct := public.ensure_global_wallet(_admin);
  perform 1 from public.credit_accounts where id = _acct for update;
  _cap := greatest(coalesce(public.admin_unsecured_balance(_admin), 0), 0);
  _amt := least(_pts, _cap);

  if _amt > 0 then
    _tx := public.new_tx_id();
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                      balance_after, reason, reference, actor_id, tx_id, entry_kind,
                                      base_amount, commission_percent, commission_amount)
    values (_acct, _admin, _eco, 'debit', _amt, 0,
            'Reward points cost (points disabled) — ' || _amt::text || ' points × 1 coin',
            _tx, _admin, _tx, 'points_cost_reconciliation', _amt, 0, 0)
    returning id into _ledger;
  end if;

  insert into public.points_disabled_conversions
    (ecosystem_id, admin_id, source_kind, sale_id, retail_order_id, user_id,
     would_be_points, coin_equivalent, amount_debited, shortfall, status, ledger_id, tx_id)
  values (_eco, _admin, _kind, _sale_id, _order_id, _user, _pts, _pts, _amt,
          round(_pts - _amt, 2),
          case when _amt >= _pts then 'settled' when _amt > 0 then 'partial'
               else 'unresolved_insufficient_balance' end,
          _ledger, _tx)
  on conflict do nothing;

  return _amt;
end; $$;

revoke all on function public.points_disabled_settlement(uuid, numeric, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.points_disabled_reverse(_sale_id uuid, _order_id uuid, _reason text)
returns numeric
language plpgsql security definer set search_path to 'public'
as $$
declare _c public.points_disabled_conversions; _acct uuid; _tx text; _ledger uuid;
begin
  select * into _c from public.points_disabled_conversions
   where (_sale_id is not null and sale_id = _sale_id)
      or (_order_id is not null and retail_order_id = _order_id)
   for update;
  if _c.id is null or _c.reversed_at is not null then return 0; end if;

  if _c.amount_debited > 0 and _c.status <> 'paid_at_purchase' and _c.admin_id is not null then
    _acct := public.ensure_global_wallet(_c.admin_id);
    _tx := public.new_tx_id();
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                      balance_after, reason, reference, actor_id, tx_id, entry_kind,
                                      base_amount, commission_percent, commission_amount)
    values (_acct, _c.admin_id, _c.ecosystem_id, 'credit', _c.amount_debited, 0,
            'Reward points cost reversed — ' || coalesce(nullif(btrim(_reason), ''), 'sale reversed'),
            _tx, coalesce(auth.uid(), _c.admin_id), _tx, 'points_cost_reconciliation',
            _c.amount_debited, 0, 0)
    returning id into _ledger;
  end if;

  update public.points_disabled_conversions
     set reversed_at = now(), reversal_ledger_id = _ledger
   where id = _c.id;
  return case when _c.status = 'paid_at_purchase' then 0 else _c.amount_debited end;
end; $$;

revoke all on function public.points_disabled_reverse(uuid, uuid, text) from public, anon, authenticated;

-- 5. Suppress new point awards while OFF, settling them 1:1 instead -----------
create or replace function public.points_disabled_award_guard()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.entry_type <> 'earn' or new.direction <> 'credit' then return new; end if;
  if new.ecosystem_id is null then return new; end if;
  if public.shop_points_enabled(new.ecosystem_id) then return new; end if;

  perform public.points_disabled_settlement(new.ecosystem_id, new.amount,
            new.sale_id, new.retail_order_id, new.user_id);
  return null;  -- no points are awarded while the shop has reward points OFF
end; $$;

drop trigger if exists points_disabled_award_guard on public.points_ledger;
create trigger points_disabled_award_guard
before insert on public.points_ledger
for each row execute function public.points_disabled_award_guard();

-- Keep the recorded sale consistent with the suppressed award.
create or replace function public.voucher_sales_points_disabled()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if coalesce(new.points_earned, 0) > 0 and not public.shop_points_enabled(new.ecosystem_id) then
    new.points_earned := 0;
  end if;
  return new;
end; $$;

drop trigger if exists voucher_sales_points_disabled on public.voucher_sales;
create trigger voucher_sales_points_disabled
before insert or update on public.voucher_sales
for each row execute function public.voucher_sales_points_disabled();

-- 6. Reverse the conversion when the source sale/order is reversed ------------
create or replace function public.voucher_sale_points_cost_reversal()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.refunded_at is not null and old.refunded_at is null then
    perform public.points_disabled_reverse(new.id, null,
      coalesce(nullif(btrim(new.refund_reason), ''), 'sale refunded'));
  end if;
  return new;
end; $$;

drop trigger if exists voucher_sale_points_cost_reversal on public.voucher_sales;
create trigger voucher_sale_points_cost_reversal
after update on public.voucher_sales
for each row execute function public.voucher_sale_points_cost_reversal();

create or replace function public.retail_order_points_cost_reversal()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('cancelled', 'refunded', 'rejected') then
    perform public.points_disabled_reverse(null, new.id, 'order ' || new.status);
  end if;
  return new;
end; $$;

drop trigger if exists retail_order_points_cost_reversal on public.retail_orders;
create trigger retail_order_points_cost_reversal
after update on public.retail_orders
for each row execute function public.retail_order_points_cost_reversal();

-- 7. Rewards Shop is unavailable while points are OFF -------------------------
create or replace function public.list_rewards(_ecosystem_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, description text, points_price integer, available integer, image_path text, rating_avg numeric, rating_count integer, redeemed_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eco uuid;
begin
  if _ecosystem_id is not null then
    if not public.is_universe_shop(_ecosystem_id) then return; end if;
    _eco := _ecosystem_id;
  else
    select pr.ecosystem_id into _eco from public.profiles pr where pr.id = auth.uid();
  end if;
  if _eco is null then return; end if;
  if not public.shop_points_enabled(_eco) then return; end if;
  return query
    select r.id, r.name, r.description, r.points_price,
           greatest(r.stock - r.reserved, 0), r.image_path,
           coalesce((select round(avg(g.rating)::numeric, 2) from public.reward_ratings g
                      where g.reward_id = r.id), 0)::numeric,
           coalesce((select count(*)::int from public.reward_ratings g
                      where g.reward_id = r.id), 0),
           coalesce((select count(*)::int from public.reward_redemptions d
                      where d.reward_id = r.id and d.status = 'claimed'), 0)
    from public.reward_products r
    where r.ecosystem_id = _eco and r.active and not r.archived
    order by r.points_price;
end; $function$;

create or replace function public.reward_redemption_points_enabled()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.shop_points_enabled(new.ecosystem_id) then
    raise exception 'Reward points are disabled for this shop, so rewards cannot be redeemed right now.';
  end if;
  return new;
end; $$;

drop trigger if exists reward_redemption_points_enabled on public.reward_redemptions;
create trigger reward_redemption_points_enabled
before insert on public.reward_redemptions
for each row execute function public.reward_redemption_points_enabled();