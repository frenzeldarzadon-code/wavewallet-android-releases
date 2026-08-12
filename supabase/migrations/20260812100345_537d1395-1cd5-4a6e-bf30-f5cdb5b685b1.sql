-- ---------------------------------------------------------------------------
-- 1. Credit lots: provenance for every credit a member receives
-- ---------------------------------------------------------------------------
create table if not exists public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id),
  user_id uuid not null,
  ledger_id uuid not null unique references public.credit_ledger(id),
  source_user_id uuid,
  -- reseller | subreseller | admin | self | system | legacy
  source_kind text not null,
  amount numeric(14,2) not null,
  remaining numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists credit_lots_fifo_idx on public.credit_lots (user_id, created_at) where remaining > 0;

grant select on public.credit_lots to authenticated;
grant all on public.credit_lots to service_role;
alter table public.credit_lots enable row level security;
create policy "Members read own credit lots" on public.credit_lots
  for select to authenticated using (user_id = auth.uid() or source_user_id = auth.uid());
create policy "Shop staff read credit lots" on public.credit_lots
  for select to authenticated
  using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create table if not exists public.credit_lot_consumptions (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id),
  ledger_id uuid not null references public.credit_ledger(id),
  lot_id uuid not null references public.credit_lots(id),
  user_id uuid not null,
  amount numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (ledger_id, lot_id)
);
create index if not exists credit_lot_consumptions_ledger_idx on public.credit_lot_consumptions (ledger_id);

grant select on public.credit_lot_consumptions to authenticated;
grant all on public.credit_lot_consumptions to service_role;
alter table public.credit_lot_consumptions enable row level security;
create policy "Members read own consumptions" on public.credit_lot_consumptions
  for select to authenticated using (user_id = auth.uid());
create policy "Shop staff read consumptions" on public.credit_lot_consumptions
  for select to authenticated
  using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Per-source credit-back breakdown for a voucher sale
-- ---------------------------------------------------------------------------
create table if not exists public.sale_commissions (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id),
  sale_id uuid not null references public.voucher_sales(id),
  recipient_id uuid not null,
  source_lot_id uuid not null references public.credit_lots(id),
  source_ledger_id uuid not null references public.credit_ledger(id),
  credits_consumed numeric(14,2) not null,
  commission_percent integer not null,
  commission_amount numeric(14,2) not null,
  ledger_id uuid references public.credit_ledger(id),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (sale_id, source_lot_id)
);
create index if not exists sale_commissions_recipient_idx on public.sale_commissions (recipient_id, created_at desc);

grant select on public.sale_commissions to authenticated;
grant all on public.sale_commissions to service_role;
alter table public.sale_commissions enable row level security;
create policy "Recipients read own credit-back" on public.sale_commissions
  for select to authenticated using (recipient_id = auth.uid());
create policy "Shop staff read credit-back" on public.sale_commissions
  for select to authenticated
  using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

-- One credit-back ledger entry per recipient per sale (retry-safe).
drop index if exists public.credit_ledger_sale_commission_uniq;
create unique index if not exists credit_ledger_sale_commission_uniq
  on public.credit_ledger (sale_id, user_id) where entry_kind = 'sale_commission';

-- ---------------------------------------------------------------------------
-- 3. Lot bookkeeping trigger: credits create lots, debits consume them FIFO
-- ---------------------------------------------------------------------------
create or replace function public.track_credit_lots()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _kind text; _src uuid; _left numeric(14,2); _take numeric(14,2); _lot record;
begin
  if new.direction = 'credit' then
    _src := new.actor_id;
    if new.entry_kind = 'sale_commission' or _src is null then
      _kind := 'system'; _src := null;
    elsif _src = new.user_id then
      _kind := 'self';
    elsif public.is_super_admin(_src) or public.is_ecosystem_admin(_src, new.ecosystem_id) then
      -- Admin-funded credits never generate credit-back.
      _kind := 'admin';
    elsif exists (select 1 from public.user_roles ur
                   where ur.user_id = _src and ur.role = 'reseller' and ur.ecosystem_id = new.ecosystem_id) then
      _kind := 'reseller';
    elsif exists (select 1 from public.user_roles ur
                   where ur.user_id = _src and ur.role = 'subreseller' and ur.ecosystem_id = new.ecosystem_id) then
      _kind := 'subreseller';
    else
      _kind := 'system'; _src := null;
    end if;

    insert into public.credit_lots (ecosystem_id, user_id, ledger_id, source_user_id, source_kind, amount, remaining)
    values (new.ecosystem_id, new.user_id, new.id, _src, _kind, new.amount, new.amount)
    on conflict (ledger_id) do nothing;
    return null;
  end if;

  -- Debit: consume oldest lots first and record the provenance of the spend.
  _left := new.amount;
  for _lot in
    select id, remaining from public.credit_lots
     where user_id = new.user_id and remaining > 0
     order by created_at, id
     for update
  loop
    exit when _left <= 0;
    _take := least(_left, _lot.remaining);
    update public.credit_lots set remaining = remaining - _take where id = _lot.id;
    insert into public.credit_lot_consumptions (ecosystem_id, ledger_id, lot_id, user_id, amount)
    values (new.ecosystem_id, new.id, _lot.id, new.user_id, _take)
    on conflict (ledger_id, lot_id) do nothing;
    _left := _left - _take;
  end loop;
  return null;
end;
$$;

drop trigger if exists track_credit_lots_trg on public.credit_ledger;
create trigger track_credit_lots_trg
  after insert on public.credit_ledger
  for each row execute function public.track_credit_lots();

-- ---------------------------------------------------------------------------
-- 4. Backfill: existing balances become one unattributed legacy lot each
-- ---------------------------------------------------------------------------
do $$
declare _a record; _seed uuid;
begin
  for _a in select ca.id, ca.user_id, ca.ecosystem_id, ca.balance
              from public.credit_accounts ca
             where ca.balance > 0
               and not exists (select 1 from public.credit_lots l where l.user_id = ca.user_id)
  loop
    select id into _seed from public.credit_ledger
      where user_id = _a.user_id order by created_at limit 1;
    if _seed is null then continue; end if;
    insert into public.credit_lots (ecosystem_id, user_id, ledger_id, source_user_id, source_kind, amount, remaining)
    values (_a.ecosystem_id, _a.user_id, _seed, null, 'legacy', _a.balance, _a.balance)
    on conflict (ledger_id) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Purchase: credit-back follows the funding source of the credits spent
-- ---------------------------------------------------------------------------
drop function if exists public.purchase_voucher(uuid, integer);

create function public.purchase_voucher(_product_id uuid, _quantity integer default 1)
returns table(tx_id text, codes text[], sale_price numeric, unit_price numeric,
              quantity integer, product_name text, sale_id uuid, points_earned integer,
              commission_amount numeric, commission_percent integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _unit numeric; _total numeric;
        _tx text; _sale uuid; _status public.account_status;
        _ratio numeric; _ver integer; _earn integer := 0;
        _qty integer; _ids uuid[]; _codes text[]; _debit uuid;
        _c record; _rate integer; _amt numeric(14,2);
        _bonus_total numeric(14,2) := 0; _top_recipient uuid; _top_rate integer := 0;
        _racct uuid; _rec record;
begin
  _qty := coalesce(_quantity, 1);
  if _qty < 1 or _qty > 50 then raise exception 'Choose between 1 and 50 vouchers'; end if;

  select ecosystem_id, status into _my_eco, _status from public.profiles where id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;

  select role into _role from public.user_roles where user_id = auth.uid()
   order by case role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
  if _role in ('reseller','subreseller') then
    select reseller_discount_percent into _discount from public.profiles where id = auth.uid();
  end if;
  _discount := coalesce(_discount, 0);

  _list := coalesce(_p.promo_price, _p.credit_price);
  _unit := round(_list * (100 - _discount) / 100.0, 2);
  _total := round(_unit * _qty, 2);

  select array_agg(id order by created_at), array_agg(code order by created_at)
    into _ids, _codes
  from (
    select id, code, created_at
    from public.voucher_codes
    where product_id = _product_id and status = 'unused'
    order by created_at
    for update skip locked
    limit _qty
  ) s;

  if _ids is null or array_length(_ids, 1) < _qty then
    raise exception 'Only % voucher code(s) are available for this product', coalesce(array_length(_ids,1), 0);
  end if;

  select id into _acct from public.credit_accounts where user_id = auth.uid();
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := floor(_total / _ratio)::int; end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version,
                                    quantity, unit_price, commission_percent, commission_amount)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          case when _role in ('reseller','subreseller') then auth.uid()
               else (select reseller_id from public.profiles where id = auth.uid()) end,
          _list, _discount, round((_list - _unit) * _qty, 2), _total,
          'credits', _tx, _p.points_price, 0, _earn, _ratio, _ver,
          _qty, _unit, 0, 0)
  returning id into _sale;

  -- The FIFO lot trigger records which credits funded this debit.
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, sale_id, entry_kind)
  values (_acct, auth.uid(), _my_eco, 'debit', _total, 0,
          'Voucher purchase — ' || _p.name || case when _qty > 1 then ' ×' || _qty else '' end,
          _tx, auth.uid(), _tx, _sale, 'purchase')
  returning id into _debit;

  update public.voucher_codes
     set status = 'sold', sold_to = auth.uid(), sale_id = _sale, sold_at = now()
   where id = any(_ids) and status = 'unused';
  if not found then raise exception 'Those voucher codes were just sold. Please try again.'; end if;

  -- Credit-back goes to whoever actually supplied the credits being spent,
  -- split per source lot. Buyers who are resellers themselves earn nothing.
  if coalesce(_role, 'customer') = 'customer' then
    for _c in
      select cc.amount, l.id as lot_id, l.ledger_id, l.source_user_id
        from public.credit_lot_consumptions cc
        join public.credit_lots l on l.id = cc.lot_id
       where cc.ledger_id = _debit
         and l.source_user_id is not null
         and l.source_kind in ('reseller','subreseller')
    loop
      if _c.source_user_id = auth.uid() then continue; end if;
      _rate := public.sale_commission_rate_for(_c.source_user_id);
      if _rate <= 0 then continue; end if;
      _amt := round(_c.amount * _rate / 100.0, 2);
      if _amt <= 0 then continue; end if;

      insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                           source_ledger_id, credits_consumed, commission_percent, commission_amount)
      values (_my_eco, _sale, _c.source_user_id, _c.lot_id, _c.ledger_id, _c.amount, _rate, _amt)
      on conflict (sale_id, source_lot_id) do nothing;
    end loop;

    -- One aggregated ledger credit per recipient, atomic with the sale.
    for _rec in
      select sc.recipient_id,
             sum(sc.commission_amount) as amount,
             sum(sc.credits_consumed) as basis,
             max(sc.commission_percent) as pct
        from public.sale_commissions sc
       where sc.sale_id = _sale and sc.ledger_id is null
       group by sc.recipient_id
    loop
      select id into _racct from public.credit_accounts where user_id = _rec.recipient_id;
      continue when _racct is null;

      insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                        reason, reference, actor_id, tx_id, sale_id, entry_kind,
                                        base_amount, commission_percent, commission_amount)
      values (_racct, _rec.recipient_id, _my_eco, 'credit', _rec.amount, 0,
              'Sales credit-back — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of credits you funded)',
              _tx, auth.uid(), _tx || '-C' || left(replace(_rec.recipient_id::text,'-',''), 6),
              _sale, 'sale_commission', _rec.basis, _rec.pct, _rec.amount)
      returning id into _racct;

      update public.sale_commissions set ledger_id = _racct
       where sale_id = _sale and recipient_id = _rec.recipient_id and ledger_id is null;

      _bonus_total := _bonus_total + _rec.amount;
      if _rec.pct > _top_rate then _top_rate := _rec.pct; _top_recipient := _rec.recipient_id; end if;
    end loop;

    if _bonus_total > 0 then
      update public.voucher_sales
         set commission_amount = _bonus_total,
             commission_percent = _top_rate,
             commission_recipient_id = _top_recipient
       where id = _sale;
    end if;
  end if;

  if _earn > 0 then
    select id into _pacct from public.points_accounts where user_id = auth.uid();
    if _pacct is not null then
      insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                        balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id,
                                        credits_basis, credits_per_point_used, points_rule_version)
      values (_pacct, auth.uid(), _my_eco, 'credit', _earn, 0,
              'Points earned — ' || _p.name || ' (' || _ratio::text || ' credits = 1 pt)',
              _tx, auth.uid(), _tx || '-P', 'earn', _sale, _total, _ratio, _ver);
    else
      _earn := 0;
    end if;
  end if;

  return query select _tx, _codes, _total, _unit, _qty, _p.name, _sale, _earn, _bonus_total, _top_rate;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Reversal: claw back a sale's credit-back exactly once
-- ---------------------------------------------------------------------------
create or replace function public.reverse_sale_commission(_sale_id uuid, _reason text default null)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare _eco uuid; _rec record; _acct uuid; _tx text; _sum numeric(14,2) := 0; _actor text;
begin
  perform public.require_operational();
  select ecosystem_id into _eco from public.voucher_sales where id = _sale_id;
  if _eco is null then raise exception 'Sale not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  _tx := public.new_tx_id();
  for _rec in
    select recipient_id, sum(commission_amount) as amount
      from public.sale_commissions
     where sale_id = _sale_id and reversed_at is null
     group by recipient_id
  loop
    select id into _acct from public.credit_accounts where user_id = _rec.recipient_id;
    continue when _acct is null;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind)
    values (_acct, _rec.recipient_id, _eco, 'debit', _rec.amount, 0,
            'Credit-back reversed' || coalesce(' — ' || nullif(trim(_reason),''), ''),
            _tx, auth.uid(), _tx, _sale_id, 'sale_commission_reversal');
    _sum := _sum + _rec.amount;
  end loop;

  update public.sale_commissions set reversed_at = now()
   where sale_id = _sale_id and reversed_at is null;
  update public.voucher_sales set commission_amount = 0, commission_percent = 0
   where id = _sale_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'), 'Reversed sale credit-back', _sale_id::text,
          jsonb_build_object('amount', _sum, 'reason', _reason, 'tx_id', _tx));

  return _sum;
end;
$$;
