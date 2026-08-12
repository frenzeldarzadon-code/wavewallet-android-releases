-- ============================================================
-- Stage 4: points engine + physical rewards
-- ============================================================

-- 1. Configurable earning rule per ecosystem ------------------
alter table public.ecosystems
  add column if not exists credits_per_point numeric(10,2) not null default 10;

-- 2. Points ledger gains entry semantics ----------------------
alter table public.points_ledger
  add column if not exists entry_type text not null default 'adjust',
  add column if not exists sale_id uuid,
  add column if not exists redemption_id uuid;

alter table public.points_ledger
  drop constraint if exists points_ledger_entry_type_check;
alter table public.points_ledger
  add constraint points_ledger_entry_type_check
  check (entry_type in ('earn','spend','hold','release','claim','adjust'));

-- A completed sale may award points only once.
create unique index if not exists points_ledger_earn_once
  on public.points_ledger (sale_id) where entry_type = 'earn';

create index if not exists points_ledger_redemption_idx
  on public.points_ledger (redemption_id);

-- 3. Balance/hold engine --------------------------------------
create or replace function public.apply_points_entry()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _bal integer; _held integer;
begin
  select balance, held into _bal, _held
    from public.points_accounts where id = new.account_id for update;
  if _bal is null then raise exception 'Points account not found'; end if;

  if new.amount is null or new.amount <= 0 then
    raise exception 'Points amount must be positive';
  end if;

  if new.entry_type = 'hold' then
    if (_bal - _held) < new.amount then raise exception 'Insufficient points'; end if;
    _held := _held + new.amount;
  elsif new.entry_type = 'release' then
    _held := greatest(_held - new.amount, 0);
  elsif new.entry_type = 'claim' then
    if _bal < new.amount then raise exception 'Insufficient points'; end if;
    _bal := _bal - new.amount;
    _held := greatest(_held - new.amount, 0);
  elsif new.direction = 'credit' then
    _bal := _bal + new.amount;
  else
    if (_bal - _held) < new.amount then raise exception 'Insufficient points'; end if;
    _bal := _bal - new.amount;
  end if;

  if _bal < 0 then raise exception 'Insufficient points'; end if;

  update public.points_accounts
     set balance = _bal, held = _held, updated_at = now()
   where id = new.account_id;
  new.balance_after := _bal;
  return new;
end; $$;

-- 4. Sale snapshots for points-funded purchases ---------------
alter table public.voucher_sales
  add column if not exists points_price integer,
  add column if not exists points_spent integer not null default 0,
  add column if not exists points_earned integer not null default 0;

-- 5. Reward products ------------------------------------------
create table if not exists public.reward_products (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  name text not null,
  description text not null default '',
  points_price integer not null check (points_price > 0),
  stock integer not null default 0 check (stock >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.reward_products to authenticated;
grant all on public.reward_products to service_role;
alter table public.reward_products enable row level security;

create policy "Members read active rewards in their shop"
  on public.reward_products for select to authenticated
  using (ecosystem_id = public.current_ecosystem(auth.uid()));

create policy "Admins read their shop rewards"
  on public.reward_products for select to authenticated
  using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create policy "Admins create rewards"
  on public.reward_products for insert to authenticated
  with check (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create policy "Admins update rewards"
  on public.reward_products for update to authenticated
  using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()))
  with check (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create trigger reward_products_updated_at
  before update on public.reward_products
  for each row execute function public.set_updated_at();

-- 6. Reward redemptions ---------------------------------------
create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  reward_id uuid not null references public.reward_products(id),
  reward_name text not null,
  points_price integer not null,
  user_id uuid not null,
  user_name text not null default '',
  code text not null unique,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled','claimed')),
  tx_id text,
  note text,
  handled_by uuid,
  handled_by_name text,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.reward_redemptions to authenticated;
grant all on public.reward_redemptions to service_role;
alter table public.reward_redemptions enable row level security;

create policy "Members read own redemptions"
  on public.reward_redemptions for select to authenticated
  using (user_id = auth.uid());

create policy "Shop staff read redemptions"
  on public.reward_redemptions for select to authenticated
  using (
    public.is_ecosystem_admin(auth.uid(), ecosystem_id)
    or public.is_super_admin(auth.uid())
    or (public.has_role(auth.uid(), 'reseller')
        and ecosystem_id = public.current_ecosystem(auth.uid()))
  );

create index if not exists reward_redemptions_eco_idx
  on public.reward_redemptions (ecosystem_id, created_at desc);

create trigger reward_redemptions_updated_at
  before update on public.reward_redemptions
  for each row execute function public.set_updated_at();

-- 7. Earning rule helpers -------------------------------------
create or replace function public.set_points_rule(_ecosystem_id uuid, _credits_per_point numeric)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare _actor text; _prev numeric;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _credits_per_point is null or _credits_per_point <= 0 then
    raise exception 'The earning ratio must be greater than zero';
  end if;
  select credits_per_point into _prev from public.ecosystems where id = _ecosystem_id;
  update public.ecosystems set credits_per_point = _credits_per_point where id = _ecosystem_id;
  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Updated points earning rule', '',
          jsonb_build_object('previous', _prev, 'new', _credits_per_point));
  return _credits_per_point;
end; $$;

create or replace function public.admin_adjust_points(_user_id uuid, _amount integer, _reason text, _reference text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare _eco uuid; _acct uuid; _tx text; _actor text; _target text;
begin
  select p.ecosystem_id, p.full_name || ' — ' || p.email into _eco, _target
  from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _amount is null or _amount = 0 then raise exception 'Enter an amount'; end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;

  select id into _acct from public.points_accounts where user_id = _user_id;
  if _acct is null then raise exception 'This member has no points wallet yet'; end if;

  _tx := public.new_tx_id();
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type)
  values (_acct, _user_id, _eco, case when _amount > 0 then 'credit' else 'debit' end,
          abs(_amount), 0, trim(_reason), nullif(trim(_reference),''), auth.uid(), _tx, 'adjust');

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'),
          case when _amount > 0 then 'Added points' else 'Deducted points' end,
          coalesce(_target,''),
          jsonb_build_object('amount', abs(_amount), 'reason', trim(_reason), 'tx_id', _tx));
  return _tx;
end; $$;

-- 8. Credit purchase now awards points ------------------------
drop function if exists public.purchase_voucher(uuid);
create or replace function public.purchase_voucher(_product_id uuid)
returns table(tx_id text, code text, sale_price numeric, product_name text, sale_id uuid, points_earned integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _price numeric;
        _code public.voucher_codes; _tx text; _sale uuid; _status public.account_status;
        _ratio numeric; _earn integer := 0;
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

  select credits_per_point into _ratio from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := floor(_price / _ratio)::int; end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          case when _role = 'reseller' then auth.uid() else (select reseller_id from public.profiles where id = auth.uid()) end,
          _list, _discount, _price, 'credits', _tx, _p.points_price, 0, _earn)
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
                                        balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id)
      values (_pacct, auth.uid(), _my_eco, 'credit', _earn, 0,
              'Points earned — ' || _p.name, _tx, auth.uid(), _tx || '-P', 'earn', _sale);
    else
      _earn := 0;
    end if;
  end if;

  return query select _tx, _code.code, _price, _p.name, _sale, _earn;
end; $$;

-- 9. Points-funded voucher purchase ---------------------------
create or replace function public.purchase_voucher_with_points(_product_id uuid)
returns table(tx_id text, code text, points_spent integer, product_name text, sale_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare _my_eco uuid; _p public.voucher_products; _pacct uuid; _role public.app_role;
        _code public.voucher_codes; _tx text; _sale uuid; _status public.account_status; _pts integer;
begin
  select ecosystem_id, status into _my_eco, _status from public.profiles where id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;
  _pts := _p.points_price;
  if _pts is null or _pts <= 0 then raise exception 'This voucher cannot be bought with points'; end if;

  select role into _role from public.user_roles where user_id = auth.uid()
   order by case role when 'reseller' then 0 else 1 end limit 1;

  select * into _code from public.voucher_codes
   where product_id = _product_id and status = 'unused'
   order by created_at for update skip locked limit 1;
  if _code.id is null then raise exception 'No voucher codes are available for this product'; end if;

  select id into _pacct from public.points_accounts where user_id = auth.uid();
  if _pacct is null then raise exception 'Points wallet not found'; end if;

  _tx := public.new_tx_id();

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          (select reseller_id from public.profiles where id = auth.uid()),
          coalesce(_p.promo_price, _p.credit_price), 0, 0, 'points', _tx, _pts, _pts, 0)
  returning id into _sale;

  -- Debit points last: the ledger trigger rolls the sale back when points are short.
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id)
  values (_pacct, auth.uid(), _my_eco, 'debit', _pts, 0,
          'Voucher purchase — ' || _p.name, _tx, auth.uid(), _tx, 'spend', _sale);

  update public.voucher_codes
     set status = 'sold', sold_to = auth.uid(), sale_id = _sale, sold_at = now()
   where id = _code.id and status = 'unused';
  if not found then raise exception 'That voucher code was just sold. Please try again.'; end if;

  return query select _tx, _code.code, _pts, _p.name, _sale;
end; $$;

-- 10. Customer-facing reward list ------------------------------
create or replace function public.list_rewards()
returns table(id uuid, name text, description text, points_price integer, available integer)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare _eco uuid;
begin
  select ecosystem_id into _eco from public.profiles where id = auth.uid();
  if _eco is null then return; end if;
  return query
    select r.id, r.name, r.description, r.points_price,
           greatest(r.stock - r.reserved, 0)
    from public.reward_products r
    where r.ecosystem_id = _eco and r.active and not r.archived
    order by r.points_price;
end; $$;

-- 11. Redemption lifecycle -------------------------------------
create or replace function public.request_redemption(_reward_id uuid)
returns table(id uuid, code text, reward_name text, points_price integer, status text, tx_id text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare _my_eco uuid; _r public.reward_products; _acct uuid; _tx text;
        _code text; _red uuid; _status public.account_status; _me text;
begin
  select ecosystem_id, status, full_name into _my_eco, _status, _me
    from public.profiles where id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;

  select * into _r from public.reward_products where id = _reward_id for update;
  if _r.id is null or _r.ecosystem_id <> _my_eco then raise exception 'Reward not available'; end if;
  if not _r.active or _r.archived then raise exception 'This reward is not available right now'; end if;
  if (_r.stock - _r.reserved) < 1 then raise exception 'This reward is out of stock'; end if;

  select id into _acct from public.points_accounts where user_id = auth.uid();
  if _acct is null then raise exception 'Points wallet not found'; end if;

  update public.reward_products set reserved = reserved + 1 where id = _r.id;

  _tx := public.new_tx_id();
  _code := 'RDM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));

  insert into public.reward_redemptions (ecosystem_id, reward_id, reward_name, points_price,
                                         user_id, user_name, code, status, tx_id)
  values (_my_eco, _r.id, _r.name, _r.points_price, auth.uid(), coalesce(_me,''), _code, 'pending', _tx)
  returning reward_redemptions.id into _red;

  -- Holds the points: available balance drops, nothing is deducted yet.
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type, redemption_id)
  values (_acct, auth.uid(), _my_eco, 'debit', _r.points_price, 0,
          'Points held — ' || _r.name, _code, auth.uid(), _tx, 'hold', _red);

  return query select _red, _code, _r.name, _r.points_price, 'pending'::text, _tx;
end; $$;

create or replace function public.lookup_redemption(_code text)
returns table(id uuid, code text, reward_name text, points_price integer, status text,
              user_name text, created_at timestamptz, ecosystem_name text)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare _eco uuid;
begin
  select ecosystem_id into _eco from public.profiles where id = auth.uid();
  if not (public.is_super_admin(auth.uid())
          or (_eco is not null and (public.is_ecosystem_admin(auth.uid(), _eco)
                                    or public.has_role(auth.uid(), 'reseller')))) then
    raise exception 'Not authorized to verify redemptions';
  end if;
  return query
    select r.id, r.code, r.reward_name, r.points_price, r.status, r.user_name, r.created_at, e.name
    from public.reward_redemptions r
    join public.ecosystems e on e.id = r.ecosystem_id
    where upper(r.code) = upper(trim(_code))
      and (public.is_super_admin(auth.uid()) or r.ecosystem_id = _eco);
end; $$;

create or replace function public.review_redemption(_id uuid, _decision text, _note text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare _r public.reward_redemptions; _acct uuid; _actor text; _new text;
begin
  select * into _r from public.reward_redemptions where id = _id for update;
  if _r.id is null then raise exception 'Redemption not found'; end if;

  if _decision = 'cancel' then
    if _r.user_id <> auth.uid() then raise exception 'Only the customer can cancel this request'; end if;
    _new := 'cancelled';
  else
    if not (public.is_super_admin(auth.uid())
            or public.is_ecosystem_admin(auth.uid(), _r.ecosystem_id)
            or (public.has_role(auth.uid(), 'reseller')
                and public.current_ecosystem(auth.uid()) = _r.ecosystem_id)) then
      raise exception 'Not authorized to review this redemption';
    end if;
    if _decision = 'approve' then _new := 'claimed';
    elsif _decision = 'reject' then _new := 'rejected';
    else raise exception 'Unknown decision'; end if;
  end if;

  if _r.status <> 'pending' then
    raise exception 'This redemption is already %', _r.status;
  end if;

  select id into _acct from public.points_accounts where user_id = _r.user_id;

  if _new = 'claimed' then
    -- Deduct the held points and consume one unit of stock exactly once.
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                      balance_after, reason, reference, actor_id, tx_id, entry_type, redemption_id)
    values (_acct, _r.user_id, _r.ecosystem_id, 'debit', _r.points_price, 0,
            'Reward claimed — ' || _r.reward_name, _r.code, auth.uid(),
            coalesce(_r.tx_id,'') || '-C', 'claim', _r.id);
    update public.reward_products
       set stock = greatest(stock - 1, 0), reserved = greatest(reserved - 1, 0)
     where id = _r.reward_id;
  else
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                      balance_after, reason, reference, actor_id, tx_id, entry_type, redemption_id)
    values (_acct, _r.user_id, _r.ecosystem_id, 'credit', _r.points_price, 0,
            'Points released — ' || _r.reward_name, _r.code, auth.uid(),
            coalesce(_r.tx_id,'') || '-R', 'release', _r.id);
    update public.reward_products set reserved = greatest(reserved - 1, 0) where id = _r.reward_id;
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();

  update public.reward_redemptions
     set status = _new, note = nullif(trim(_note),''),
         handled_by = auth.uid(), handled_by_name = coalesce(_actor,''), handled_at = now()
   where id = _r.id and status = 'pending';
  if not found then raise exception 'This redemption was already handled'; end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_r.ecosystem_id, auth.uid(), coalesce(_actor,'Staff'),
          case _new when 'claimed' then 'Approved reward redemption'
                    when 'rejected' then 'Rejected reward redemption'
                    else 'Cancelled reward redemption' end,
          _r.reward_name || ' — ' || _r.user_name,
          jsonb_build_object('code', _r.code, 'points', _r.points_price, 'status', _new));
  return _new;
end; $$;

-- 12. Admin redemption listing --------------------------------
create or replace function public.list_ecosystem_redemptions(_ecosystem_id uuid)
returns setof public.reward_redemptions
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if not (public.is_super_admin(auth.uid())
          or public.is_ecosystem_admin(auth.uid(), _ecosystem_id)
          or (public.has_role(auth.uid(), 'reseller')
              and public.current_ecosystem(auth.uid()) = _ecosystem_id)) then
    raise exception 'Not authorized to read this ecosystem';
  end if;
  return query
    select * from public.reward_redemptions
    where ecosystem_id = _ecosystem_id
    order by case when status = 'pending' then 0 else 1 end, created_at desc
    limit 200;
end; $$;

revoke all on function public.set_points_rule(uuid, numeric) from public, anon;
revoke all on function public.admin_adjust_points(uuid, integer, text, text) from public, anon;
revoke all on function public.purchase_voucher_with_points(uuid) from public, anon;
revoke all on function public.list_rewards() from public, anon;
revoke all on function public.request_redemption(uuid) from public, anon;
revoke all on function public.lookup_redemption(text) from public, anon;
revoke all on function public.review_redemption(uuid, text, text) from public, anon;
revoke all on function public.list_ecosystem_redemptions(uuid) from public, anon;

grant execute on function public.set_points_rule(uuid, numeric) to authenticated;
grant execute on function public.admin_adjust_points(uuid, integer, text, text) to authenticated;
grant execute on function public.purchase_voucher_with_points(uuid) to authenticated;
grant execute on function public.list_rewards() to authenticated;
grant execute on function public.request_redemption(uuid) to authenticated;
grant execute on function public.lookup_redemption(text) to authenticated;
grant execute on function public.review_redemption(uuid, text, text) to authenticated;
grant execute on function public.list_ecosystem_redemptions(uuid) to authenticated;