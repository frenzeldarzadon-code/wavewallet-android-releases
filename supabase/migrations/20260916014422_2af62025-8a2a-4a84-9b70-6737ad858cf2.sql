-- 1. Remove the superseded "charge admin for would-be points" mechanism.
drop trigger if exists points_disabled_award_guard on public.points_ledger;
drop trigger if exists voucher_sale_points_cost_reversal on public.voucher_sales;
drop trigger if exists retail_order_points_cost_reversal on public.retail_orders;
drop function if exists public.points_disabled_reverse(uuid, uuid, text);
drop function if exists public.points_disabled_settlement(uuid, numeric, uuid, uuid, uuid);
drop function if exists public.points_disabled_award_guard();
drop function if exists public.retail_order_points_cost_reversal();
drop function if exists public.voucher_sale_points_cost_reversal();
drop table if exists public.points_disabled_conversions;

-- 2. Points earned while the shop has rewards OFF are simply not awarded.
create or replace function public.points_disabled_award_block()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.entry_type <> 'earn' or new.direction <> 'credit' then return new; end if;
  if new.ecosystem_id is null then return new; end if;
  if public.shop_points_enabled(new.ecosystem_id) then return new; end if;
  -- Rewards are disabled for this shop: no points, and no replacement coins.
  return null;
end; $$;

drop trigger if exists points_disabled_award_block on public.points_ledger;
create trigger points_disabled_award_block
  before insert on public.points_ledger
  for each row execute function public.points_disabled_award_block();

-- 3. Audit trail of one-time conversions performed at disable time.
create table if not exists public.points_disable_conversions (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  generation integer not null,
  user_id uuid not null,
  points_converted numeric(14,2) not null,
  coins_credited numeric(14,2) not null,
  points_ledger_id uuid,
  credit_ledger_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists points_disable_conversions_unique
  on public.points_disable_conversions (ecosystem_id, generation, user_id);
create index if not exists points_disable_conversions_eco_idx
  on public.points_disable_conversions (ecosystem_id, created_at desc);

grant select on public.points_disable_conversions to authenticated;
grant all on public.points_disable_conversions to service_role;

alter table public.points_disable_conversions enable row level security;

drop policy if exists "Conversion records visible to owner, shop admin, platform owner"
  on public.points_disable_conversions;
create policy "Conversion records visible to owner, shop admin, platform owner"
  on public.points_disable_conversions for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );

drop trigger if exists set_points_disable_conversions_updated_at on public.points_disable_conversions;
create trigger set_points_disable_conversions_updated_at
  before update on public.points_disable_conversions
  for each row execute function public.set_updated_at();

-- 4. One-time, idempotent, concurrency-safe conversion of a shop's live points.
create or replace function public.convert_shop_points_to_coins(_eco uuid, _generation integer)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _row record;
  _avail numeric(14,2);
  _total numeric(14,2) := 0;
  _pl uuid;
  _cl uuid;
  _acct uuid;
  _tx text;
  _conv uuid;
begin
  for _row in
    select pa.id, pa.user_id
      from public.points_accounts pa
     where pa.ecosystem_id = _eco
       and pa.balance > 0
     order by pa.id
     for update
  loop
    -- only genuinely available points convert; held (pending redemption) stay put
    select round(greatest(pa.balance - pa.held, 0), 2) into _avail
      from public.points_accounts pa where pa.id = _row.id;
    if _avail <= 0 then continue; end if;

    -- idempotency guard: one conversion per (shop, disable event, member)
    insert into public.points_disable_conversions
      (ecosystem_id, generation, user_id, points_converted, coins_credited)
    values (_eco, _generation, _row.user_id, _avail, _avail)
    on conflict (ecosystem_id, generation, user_id) do nothing
    returning id into _conv;
    if _conv is null then continue; end if;

    _tx := public.new_tx_id();

    insert into public.points_ledger
      (account_id, user_id, ecosystem_id, direction, amount, balance_after,
       entry_type, reason, reference, actor_id, tx_id)
    values (_row.id, _row.user_id, _eco, 'debit', _avail, 0, 'adjust',
            'Reward points disabled — converted to Universe Coins 1:1',
            _tx, coalesce(auth.uid(), _row.user_id), _tx)
    returning id into _pl;

    _acct := public.ensure_global_wallet(_row.user_id);
    insert into public.credit_ledger
      (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason,
       reference, actor_id, tx_id, entry_kind, base_amount, commission_percent, commission_amount)
    values (_acct, _row.user_id, _eco, 'credit', _avail, 0,
            'Reward points converted to Universe Coins (1 point = 1 coin)',
            _tx, coalesce(auth.uid(), _row.user_id), _tx, 'points_conversion', _avail, 0, 0)
    returning id into _cl;

    update public.points_disable_conversions
       set points_ledger_id = _pl, credit_ledger_id = _cl
     where id = _conv;

    _total := _total + _avail;
    _conv := null;
  end loop;

  return _total;
end; $$;

revoke all on function public.convert_shop_points_to_coins(uuid, integer) from public, anon, authenticated;
grant execute on function public.convert_shop_points_to_coins(uuid, integer) to service_role;

-- 5. Toggle: disabling converts current points once; enabling starts a fresh period.
create or replace function public.set_points_enabled(_ecosystem_id uuid, _enabled boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare _actor text; _prev boolean; _ver integer; _new boolean := coalesce(_enabled, true);
        _converted numeric(14,2) := 0;
begin
  perform public.require_operational();
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  select points_enabled, points_rule_version into _prev, _ver
    from public.ecosystems where id = _ecosystem_id for update;
  if _prev is null then raise exception 'Shop not found'; end if;
  if _prev = _new then return _prev; end if;

  _ver := coalesce(_ver, 1) + 1;

  update public.ecosystems
     set points_enabled = _new,
         points_rule_version = _ver,
         points_rule_updated_at = now(),
         points_enabled_changed_at = now()
   where id = _ecosystem_id;

  -- Turning points OFF converts the shop's current available points to coins, once.
  -- Turning points back ON starts a FRESH earning period: nothing is restored or refunded.
  if not _new then
    _converted := public.convert_shop_points_to_coins(_ecosystem_id, _ver);
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Admin'),
          case when _new then 'Enabled reward points' else 'Disabled reward points' end,
          '',
          jsonb_build_object('previous', _prev, 'new', _new, 'generation', _ver,
                             'points_converted_to_coins', _converted,
                             'conversion_rate', '1 point = 1 Universe Coin',
                             'historical_conversions', 'permanent, never restored'));
  return _new;
end; $$;

-- 6. Conversion history for the shop admin / platform owner.
create or replace function public.shop_points_conversions(_eco uuid)
returns table (
  id uuid, generation integer, user_id uuid, member_name text, member_handle text,
  points_converted numeric, coins_credited numeric, created_at timestamptz
)
language sql
stable security definer
set search_path to 'public'
as $$
  select c.id, c.generation, c.user_id, p.full_name, p.handle,
         c.points_converted, c.coins_credited, c.created_at
    from public.points_disable_conversions c
    left join public.profiles p on p.id = c.user_id
   where c.ecosystem_id = _eco
     and (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _eco))
   order by c.created_at desc, c.id;
$$;

revoke all on function public.shop_points_conversions(uuid) from public, anon;
grant execute on function public.shop_points_conversions(uuid) to authenticated, service_role;