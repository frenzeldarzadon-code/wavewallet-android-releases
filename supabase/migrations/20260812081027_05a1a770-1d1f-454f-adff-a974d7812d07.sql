alter table public.ecosystems
  add column if not exists points_rule_version integer not null default 1,
  add column if not exists points_rule_updated_at timestamptz not null default now();

alter table public.voucher_sales
  add column if not exists credits_per_point_used numeric(14,4),
  add column if not exists points_rule_version integer;

alter table public.points_ledger
  add column if not exists credits_basis numeric(14,2),
  add column if not exists credits_per_point_used numeric(14,4),
  add column if not exists points_rule_version integer;

-- A sale may award earning points exactly once, even if the purchase is retried.
create unique index if not exists points_ledger_earn_once
  on public.points_ledger (sale_id) where entry_type = 'earn';

create or replace function public.set_points_rule(_ecosystem_id uuid, _credits_per_point numeric)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _actor text; _prev numeric; _ver integer;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _credits_per_point is null or _credits_per_point <= 0 then
    raise exception 'The earning ratio must be greater than zero';
  end if;
  select credits_per_point, points_rule_version into _prev, _ver
    from public.ecosystems where id = _ecosystem_id;
  update public.ecosystems
     set credits_per_point = _credits_per_point,
         points_rule_version = coalesce(_ver,1) + 1,
         points_rule_updated_at = now()
   where id = _ecosystem_id;
  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Updated points earning rule', '',
          jsonb_build_object('previous', _prev, 'new', _credits_per_point,
                             'version', coalesce(_ver,1) + 1,
                             'applies_to', 'future qualifying purchases only'));
  return _credits_per_point;
end; $function$;

create or replace function public.purchase_voucher(_product_id uuid)
 returns table(tx_id text, code text, sale_price numeric, product_name text, sale_id uuid, points_earned integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _price numeric;
        _code public.voucher_codes; _tx text; _sale uuid; _status public.account_status;
        _ratio numeric; _ver integer; _earn integer := 0;
begin
  select ecosystem_id, status into _my_eco, _status from public.profiles where id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;

  select role into _role from public.user_roles where user_id = auth.uid()
   order by case role when 'reseller' then 0 else 1 end limit 1;
  if _role = 'reseller' then
    select reseller_discount_percent into _discount from public.profiles where id = auth.uid();
  end if;
  _discount := coalesce(_discount, 0);

  _list := coalesce(_p.promo_price, _p.credit_price);
  _price := round(_list * (100 - _discount) / 100.0, 2);

  select * into _code from public.voucher_codes
   where product_id = _product_id and status = 'unused'
   order by created_at for update skip locked limit 1;
  if _code.id is null then raise exception 'No voucher codes are available for this product'; end if;

  select id into _acct from public.credit_accounts where user_id = auth.uid();
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  -- Snapshot the ratio that is active right now; later rule changes never touch this sale.
  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := floor(_price / _ratio)::int; end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          case when _role = 'reseller' then auth.uid() else (select reseller_id from public.profiles where id = auth.uid()) end,
          _list, _discount, _price, 'credits', _tx, _p.points_price, 0, _earn, _ratio, _ver)
  returning id into _sale;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id)
  values (_acct, auth.uid(), _my_eco, 'debit', _price, 0, 'Voucher purchase — ' || _p.name, _tx, auth.uid(), _tx);

  update public.voucher_codes
     set status = 'sold', sold_to = auth.uid(), sale_id = _sale, sold_at = now()
   where id = _code.id and status = 'unused';
  if not found then raise exception 'That voucher code was just sold. Please try again.'; end if;

  if _earn > 0 then
    select id into _pacct from public.points_accounts where user_id = auth.uid();
    if _pacct is not null then
      insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                        balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id,
                                        credits_basis, credits_per_point_used, points_rule_version)
      values (_pacct, auth.uid(), _my_eco, 'credit', _earn, 0,
              'Points earned — ' || _p.name || ' (' || _ratio::text || ' credits = 1 pt)',
              _tx, auth.uid(), _tx || '-P', 'earn', _sale, _price, _ratio, _ver);
    else
      _earn := 0;
    end if;
  end if;

  return query select _tx, _code.code, _price, _p.name, _sale, _earn;
end; $function$;

-- Explicit reversal of a past award: a NEW ledger entry that reuses the original
-- snapshot. The original entry and its ratio are never rewritten.
create or replace function public.reverse_sale_points(_sale_id uuid, _reason text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _s public.voucher_sales; _orig public.points_ledger; _acct uuid; _tx text; _actor text;
begin
  select * into _s from public.voucher_sales where id = _sale_id;
  if _s.id is null then raise exception 'Sale not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _s.ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;

  select * into _orig from public.points_ledger
   where sale_id = _sale_id and entry_type = 'earn' limit 1;
  if _orig.id is null then raise exception 'This sale did not award points'; end if;
  if exists (select 1 from public.points_ledger
              where sale_id = _sale_id and entry_type = 'adjust' and direction = 'debit') then
    raise exception 'These points were already reversed';
  end if;

  select id into _acct from public.points_accounts where user_id = _orig.user_id;
  if _acct is null then raise exception 'Points wallet not found'; end if;

  _tx := public.new_tx_id();
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id,
                                    credits_basis, credits_per_point_used, points_rule_version)
  values (_acct, _orig.user_id, _orig.ecosystem_id, 'debit', _orig.amount, 0,
          'Points reversed — ' || trim(_reason), _orig.tx_id, auth.uid(), _tx, 'adjust', _sale_id,
          _orig.credits_basis, _orig.credits_per_point_used, _orig.points_rule_version);

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_orig.ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Reversed earned points',
          _s.product_name,
          jsonb_build_object('sale_id', _sale_id, 'points', _orig.amount,
                             'ratio_used', _orig.credits_per_point_used, 'reason', trim(_reason)));
  return _tx;
end; $function$;

revoke execute on function public.reverse_sale_points(uuid, text) from anon;