-- ============ transaction ids on ledgers ============
alter table public.credit_ledger add column if not exists tx_id text;
alter table public.points_ledger add column if not exists tx_id text;
create unique index if not exists credit_ledger_tx_id_key on public.credit_ledger(tx_id) where tx_id is not null;

create or replace function public.new_tx_id()
returns text language sql volatile set search_path to 'public' as $$
  select 'WW-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));
$$;

-- ============ voucher products ============
create table if not exists public.voucher_products (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  name text not null,
  description text not null default '',
  credit_price numeric(14,2) not null default 0,
  points_price integer,
  promo_price numeric(14,2),
  promo_note text,
  active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.voucher_products to authenticated;
grant all on public.voucher_products to service_role;
alter table public.voucher_products enable row level security;

create policy "Members read products in their ecosystem"
on public.voucher_products for select to authenticated
using (ecosystem_id = public.current_ecosystem(auth.uid())
       or public.is_ecosystem_admin(auth.uid(), ecosystem_id)
       or public.is_super_admin(auth.uid()));

create policy "Admins create products in their ecosystem"
on public.voucher_products for insert to authenticated
with check (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create policy "Admins update products in their ecosystem"
on public.voucher_products for update to authenticated
using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()))
with check (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create trigger voucher_products_updated_at before update on public.voucher_products
for each row execute function public.set_updated_at();

-- ============ import batches ============
create table if not exists public.voucher_imports (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  product_id uuid not null references public.voucher_products(id) on delete cascade,
  actor_id uuid,
  actor_name text not null default '',
  source text not null default 'paste',
  total_rows integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  invalid_count integer not null default 0,
  created_at timestamptz not null default now()
);
grant select on public.voucher_imports to authenticated;
grant all on public.voucher_imports to service_role;
alter table public.voucher_imports enable row level security;

create policy "Admins read imports in their ecosystem"
on public.voucher_imports for select to authenticated
using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

-- ============ voucher sales ============
create table if not exists public.voucher_sales (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  product_id uuid not null references public.voucher_products(id) on delete restrict,
  product_name text not null,
  buyer_id uuid not null,
  buyer_role app_role not null,
  reseller_id uuid,
  list_price numeric(14,2) not null,
  discount_percent integer not null default 0,
  sale_price numeric(14,2) not null,
  payment_method text not null default 'credits',
  tx_id text not null unique,
  created_at timestamptz not null default now()
);
grant select on public.voucher_sales to authenticated;
grant all on public.voucher_sales to service_role;
alter table public.voucher_sales enable row level security;

create policy "Buyers read their own purchases"
on public.voucher_sales for select to authenticated using (buyer_id = auth.uid());

create policy "Admins read sales in their ecosystem"
on public.voucher_sales for select to authenticated
using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

-- ============ voucher codes (sensitive inventory) ============
create table if not exists public.voucher_codes (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  product_id uuid not null references public.voucher_products(id) on delete cascade,
  code text not null,
  status text not null default 'unused' check (status in ('unused','sold')),
  import_id uuid references public.voucher_imports(id) on delete set null,
  sold_to uuid,
  sale_id uuid references public.voucher_sales(id) on delete set null,
  sold_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists voucher_codes_unique_per_ecosystem
  on public.voucher_codes(ecosystem_id, upper(code));
create index if not exists voucher_codes_pick_idx
  on public.voucher_codes(product_id, status);

grant select on public.voucher_codes to authenticated;
grant all on public.voucher_codes to service_role;
alter table public.voucher_codes enable row level security;

create policy "Admins read codes in their ecosystem"
on public.voucher_codes for select to authenticated
using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create policy "Buyers read only codes they bought"
on public.voucher_codes for select to authenticated
using (sold_to = auth.uid() and status = 'sold');

-- ============ wallet mutations ============
create or replace function public.admin_adjust_credits(
  _user_id uuid, _amount numeric, _reason text, _reference text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _acct uuid; _tx text; _actor text; _target text; _dir text;
begin
  select p.ecosystem_id, p.full_name || ' — ' || p.email into _eco, _target
  from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _amount is null or _amount = 0 then raise exception 'Enter an amount'; end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;

  select id into _acct from public.credit_accounts where user_id = _user_id;
  if _acct is null then raise exception 'This member has no credit wallet yet'; end if;

  _tx := public.new_tx_id();
  _dir := case when _amount > 0 then 'credit' else 'debit' end;
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id)
  values (_acct, _user_id, _eco, _dir, abs(_amount), 0, trim(_reason), nullif(trim(_reference),''), auth.uid(), _tx);

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'),
          case when _amount > 0 then 'Added credits' else 'Deducted credits' end,
          coalesce(_target,''),
          jsonb_build_object('amount', abs(_amount), 'reason', trim(_reason), 'reference', _reference, 'tx_id', _tx));
  return _tx;
end; $$;

create or replace function public.reseller_load_credits(
  _customer_id uuid, _amount numeric, _reference text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _my_eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text;
begin
  if not public.has_role(auth.uid(), 'reseller') then
    raise exception 'Only resellers can load credits';
  end if;
  select ecosystem_id into _my_eco from public.profiles where id = auth.uid();
  select ecosystem_id, full_name || ' — ' || email into _eco, _target from public.profiles where id = _customer_id;
  if _eco is null or _eco is distinct from _my_eco then
    raise exception 'That customer is not in your shop';
  end if;
  if _customer_id = auth.uid() then raise exception 'Choose another member'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _customer_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id)
  values (_from, auth.uid(), _eco, 'debit', _amount, 0, 'Credit load to customer', nullif(trim(_reference),''), auth.uid(), _tx);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id)
  values (_to, _customer_id, _eco, 'credit', _amount, 0, 'Credit load from reseller', nullif(trim(_reference),''), auth.uid(), _tx || '-R');

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Reseller'), 'Loaded credits to customer', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'tx_id', _tx));
  return _tx;
end; $$;

create or replace function public.transfer_credits(
  _recipient_id uuid, _amount numeric, _note text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _my_eco uuid; _eco uuid; _from uuid; _to uuid; _tx text; _status public.account_status;
begin
  select ecosystem_id into _my_eco from public.profiles where id = auth.uid();
  select ecosystem_id, status into _eco, _status from public.profiles where id = _recipient_id;
  if _my_eco is null or _eco is null or _eco is distinct from _my_eco then
    raise exception 'Transfers are only allowed inside your own shop';
  end if;
  if _recipient_id = auth.uid() then raise exception 'You cannot send credits to yourself'; end if;
  if _status <> 'active' then raise exception 'That account is suspended'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _recipient_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  -- The ledger trigger recomputes the balance and refuses to go negative.
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id)
  values (_from, auth.uid(), _my_eco, 'debit', _amount, 0, 'Credit transfer sent', nullif(trim(_note),''), auth.uid(), _tx);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id)
  values (_to, _recipient_id, _my_eco, 'credit', _amount, 0, 'Credit transfer received', nullif(trim(_note),''), auth.uid(), _tx || '-R');
  return _tx;
end; $$;

-- Safe recipient lookup: same ecosystem only, no bulk listing of the directory.
create or replace function public.lookup_transfer_recipient(_query text)
returns table(id uuid, full_name text, phone text, masked_email text)
language plpgsql stable security definer set search_path to 'public' as $$
declare _eco uuid; _q text := lower(trim(coalesce(_query,'')));
begin
  if length(_q) < 4 then return; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid();
  if _eco is null then return; end if;
  return query
    select p.id, p.full_name, p.phone,
           regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2')
    from public.profiles p
    where p.ecosystem_id = _eco and p.id <> auth.uid() and p.status = 'active'
      and (lower(p.email) = _q or replace(p.phone,' ','') = replace(_q,' ',''))
    limit 5;
end; $$;

-- ============ manual voucher import ============
create or replace function public.import_voucher_codes(
  _product_id uuid, _codes text[], _source text default 'paste')
returns table(batch_id uuid, imported_count integer, duplicate_count integer, invalid_count integer)
language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _batch uuid; _total int := coalesce(array_length(_codes,1),0);
        _imported int := 0; _dupes int := 0; _invalid int := 0; _c text; _clean text;
        _seen text[] := '{}'; _actor text; _pname text;
begin
  select ecosystem_id, name into _eco, _pname from public.voucher_products where id = _product_id;
  if _eco is null then raise exception 'Product not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.voucher_imports (ecosystem_id, product_id, actor_id, actor_name, source, total_rows)
  values (_eco, _product_id, auth.uid(), coalesce(_actor,'Admin'), coalesce(_source,'paste'), _total)
  returning id into _batch;

  foreach _c in array coalesce(_codes, '{}'::text[]) loop
    _clean := trim(coalesce(_c,''));
    if _clean = '' or length(_clean) < 3 or length(_clean) > 64 then
      _invalid := _invalid + 1;
    elsif upper(_clean) = any(_seen) then
      _dupes := _dupes + 1;
    else
      _seen := array_append(_seen, upper(_clean));
      begin
        insert into public.voucher_codes (ecosystem_id, product_id, code, import_id)
        values (_eco, _product_id, _clean, _batch);
        _imported := _imported + 1;
      exception when unique_violation then
        _dupes := _dupes + 1;
      end;
    end if;
  end loop;

  update public.voucher_imports
     set imported_count = _imported, duplicate_count = _dupes, invalid_count = _invalid
   where id = _batch;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'), 'Imported voucher codes', coalesce(_pname,''),
          jsonb_build_object('imported', _imported, 'duplicates', _dupes, 'invalid', _invalid, 'batch', _batch));

  return query select _batch, _imported, _dupes, _invalid;
end; $$;

-- ============ shop listing (hides codes, exposes availability only) ============
create or replace function public.list_shop_products()
returns table(id uuid, name text, description text, credit_price numeric, points_price integer,
              promo_price numeric, promo_note text, available integer)
language plpgsql stable security definer set search_path to 'public' as $$
declare _eco uuid;
begin
  select ecosystem_id into _eco from public.profiles where id = auth.uid();
  if _eco is null then return; end if;
  return query
    select p.id, p.name, p.description, p.credit_price, p.points_price, p.promo_price, p.promo_note,
           (select count(*)::int from public.voucher_codes c
             where c.product_id = p.id and c.status = 'unused')
    from public.voucher_products p
    where p.ecosystem_id = _eco and p.active and not p.archived
    order by p.credit_price;
end; $$;

create or replace function public.admin_product_inventory(_ecosystem_id uuid)
returns table(product_id uuid, total integer, unused integer, sold integer)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to read this ecosystem';
  end if;
  return query
    select p.id,
           count(c.id)::int,
           count(c.id) filter (where c.status = 'unused')::int,
           count(c.id) filter (where c.status = 'sold')::int
    from public.voucher_products p
    left join public.voucher_codes c on c.product_id = p.id
    where p.ecosystem_id = _ecosystem_id
    group by p.id;
end; $$;

-- ============ atomic purchase ============
create or replace function public.purchase_voucher(_product_id uuid)
returns table(tx_id text, code text, sale_price numeric, product_name text, sale_id uuid)
language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _my_eco uuid; _p public.voucher_products; _acct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _price numeric;
        _code public.voucher_codes; _tx text; _sale uuid; _status public.account_status;
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

  -- Reserve exactly one unused code; concurrent buyers skip locked rows.
  select * into _code from public.voucher_codes
   where product_id = _product_id and status = 'unused'
   order by created_at
   for update skip locked
   limit 1;
  if _code.id is null then raise exception 'No voucher codes are available for this product'; end if;

  select id into _acct from public.credit_accounts where user_id = auth.uid();
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, sale_price, payment_method, tx_id)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          case when _role = 'reseller' then auth.uid() else (select reseller_id from public.profiles where id = auth.uid()) end,
          _list, _discount, _price, 'credits', _tx)
  returning id into _sale;

  -- Debit last: the ledger trigger raises on insufficient credits and rolls the whole sale back.
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id)
  values (_acct, auth.uid(), _my_eco, 'debit', _price, 0, 'Voucher purchase — ' || _p.name, _tx, auth.uid(), _tx);

  update public.voucher_codes
     set status = 'sold', sold_to = auth.uid(), sale_id = _sale, sold_at = now()
   where id = _code.id and status = 'unused';
  if not found then raise exception 'That voucher code was just sold. Please try again.'; end if;

  return query select _tx, _code.code, _price, _p.name, _sale;
end; $$;

revoke all on function public.new_tx_id() from public, anon;
revoke all on function public.admin_adjust_credits(uuid, numeric, text, text) from public, anon;
revoke all on function public.reseller_load_credits(uuid, numeric, text) from public, anon;
revoke all on function public.transfer_credits(uuid, numeric, text) from public, anon;
revoke all on function public.lookup_transfer_recipient(text) from public, anon;
revoke all on function public.import_voucher_codes(uuid, text[], text) from public, anon;
revoke all on function public.list_shop_products() from public, anon;
revoke all on function public.admin_product_inventory(uuid) from public, anon;
revoke all on function public.purchase_voucher(uuid) from public, anon;

grant execute on function public.admin_adjust_credits(uuid, numeric, text, text) to authenticated;
grant execute on function public.reseller_load_credits(uuid, numeric, text) to authenticated;
grant execute on function public.transfer_credits(uuid, numeric, text) to authenticated;
grant execute on function public.lookup_transfer_recipient(text) to authenticated;
grant execute on function public.import_voucher_codes(uuid, text[], text) to authenticated;
grant execute on function public.list_shop_products() to authenticated;
grant execute on function public.admin_product_inventory(uuid) to authenticated;
grant execute on function public.purchase_voucher(uuid) to authenticated;