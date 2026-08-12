-- 1. Sale-level commission snapshot ------------------------------------------
alter table public.voucher_sales
  add column if not exists quantity integer not null default 1,
  add column if not exists unit_price numeric(14,2),
  add column if not exists commission_recipient_id uuid,
  add column if not exists commission_percent integer not null default 0,
  add column if not exists commission_amount numeric(14,2) not null default 0;

update public.voucher_sales set unit_price = sale_price where unit_price is null;

alter table public.credit_ledger
  add column if not exists sale_id uuid references public.voucher_sales(id),
  add column if not exists entry_kind text not null default 'general';

-- One sale can never produce more than one credit-back entry (retry-safe).
create unique index if not exists credit_ledger_sale_commission_uniq
  on public.credit_ledger (sale_id) where entry_kind = 'sale_commission';

-- 2. Rate resolver for customer-sale credit-back ------------------------------
create or replace function public.sale_commission_rate_for(_recipient uuid)
returns integer
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare _eco uuid; _override integer; _pct integer; _status public.account_status;
begin
  if _recipient is null then return 0; end if;

  select p.ecosystem_id, p.reseller_commission_percent, p.status
    into _eco, _override, _status
  from public.profiles p where p.id = _recipient;
  if _eco is null or _status <> 'active' then return 0; end if;

  -- Admins and platform owners never earn credit-back: they supply inventory.
  if public.is_super_admin(_recipient) or public.is_ecosystem_admin(_recipient, _eco) then
    return 0;
  end if;

  -- Only resellers and subresellers linked to the buyer are eligible.
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = _recipient
      and ur.role in ('reseller','subreseller')
      and ur.ecosystem_id = _eco
  ) then
    return 0;
  end if;

  if _override is not null then
    _pct := _override;
  else
    select coalesce(e.default_commission_percent, 0) into _pct
      from public.ecosystems e where e.id = _eco;
  end if;

  return least(greatest(coalesce(_pct, 0), 0), 100);
end;
$$;

-- 3. Purchase with quantity + per-purchase credit-back ------------------------
drop function if exists public.purchase_voucher(uuid);

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
        _qty integer; _ids uuid[]; _codes text[];
        _recipient uuid; _rate integer := 0; _bonus numeric(14,2) := 0; _racct uuid;
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

  -- Reserve exactly _qty unused codes.
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

  -- Credit-back goes to the reseller/subreseller who owns this customer, never
  -- to admins and never to the buyer themselves.
  if coalesce(_role, 'customer') = 'customer' then
    select reseller_id into _recipient from public.profiles where id = auth.uid();
    if _recipient = auth.uid() then _recipient := null; end if;
    if _recipient is not null then
      if (select ecosystem_id from public.profiles where id = _recipient) is distinct from _my_eco then
        _recipient := null;
      end if;
    end if;
    _rate := public.sale_commission_rate_for(_recipient);
    if _rate > 0 then
      _bonus := round(_total * _rate / 100.0, 2);
    else
      _rate := 0;
    end if;
    if _bonus <= 0 then _recipient := null; _rate := 0; _bonus := 0; end if;
  end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version,
                                    quantity, unit_price, commission_recipient_id,
                                    commission_percent, commission_amount)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          case when _role in ('reseller','subreseller') then auth.uid()
               else (select reseller_id from public.profiles where id = auth.uid()) end,
          _list, _discount, round((_list - _unit) * _qty, 2), _total,
          'credits', _tx, _p.points_price, 0, _earn, _ratio, _ver,
          _qty, _unit, _recipient, _rate, _bonus)
  returning id into _sale;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, sale_id, entry_kind)
  values (_acct, auth.uid(), _my_eco, 'debit', _total, 0,
          'Voucher purchase — ' || _p.name || case when _qty > 1 then ' ×' || _qty else '' end,
          _tx, auth.uid(), _tx, _sale, 'purchase');

  update public.voucher_codes
     set status = 'sold', sold_to = auth.uid(), sale_id = _sale, sold_at = now()
   where id = any(_ids) and status = 'unused';
  if not found then raise exception 'Those voucher codes were just sold. Please try again.'; end if;

  -- Per-purchase credit-back, atomic with the sale.
  if _bonus > 0 and _recipient is not null then
    select id into _racct from public.credit_accounts where user_id = _recipient;
    if _racct is not null then
      insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                        reason, reference, actor_id, tx_id, sale_id, entry_kind,
                                        base_amount, commission_percent, commission_amount)
      values (_racct, _recipient, _my_eco, 'credit', _bonus, 0,
              'Sales credit-back — ' || _p.name || ' ×' || _qty || ' (' || _rate || '%)',
              _tx, auth.uid(), _tx || '-C', _sale, 'sale_commission',
              _total, _rate, _bonus);
    else
      _bonus := 0; _rate := 0;
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

  return query select _tx, _codes, _total, _unit, _qty, _p.name, _sale, _earn, _bonus, _rate;
end;
$$;
