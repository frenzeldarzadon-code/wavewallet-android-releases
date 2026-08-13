-- ============================================================
-- 1. Platform settings: admin credit purchase configuration
-- ============================================================
alter table public.platform_settings
  add column if not exists admin_credit_discount_percent integer not null default 100,
  add column if not exists credit_gcash_number text not null default '',
  add column if not exists credit_gcash_account_name text not null default '',
  add column if not exists credit_payment_instructions text not null default
    'Send the exact amount to the GCash account above, then submit the reference number for verification.',
  add column if not exists credit_release_mode text not null default 'manual',
  add column if not exists default_admin_sale_commission_percent integer not null default 0;

alter table public.platform_settings
  drop constraint if exists platform_settings_admin_discount_chk;
alter table public.platform_settings
  add constraint platform_settings_admin_discount_chk
  check (admin_credit_discount_percent between 0 and 100);

alter table public.platform_settings
  drop constraint if exists platform_settings_release_mode_chk;
alter table public.platform_settings
  add constraint platform_settings_release_mode_chk
  check (credit_release_mode in ('manual','auto'));

alter table public.platform_settings
  drop constraint if exists platform_settings_admin_sale_comm_chk;
alter table public.platform_settings
  add constraint platform_settings_admin_sale_comm_chk
  check (default_admin_sale_commission_percent between 0 and 100);

-- Per-shop commission earned by the shop admin on member purchases.
alter table public.ecosystems
  add column if not exists admin_sale_commission_percent integer not null default 0;
alter table public.ecosystems
  drop constraint if exists ecosystems_admin_sale_comm_chk;
alter table public.ecosystems
  add constraint ecosystems_admin_sale_comm_chk
  check (admin_sale_commission_percent between 0 and 100);

-- ============================================================
-- 2. Credit packages (platform owner configured)
-- ============================================================
create table if not exists public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credits numeric(14,2) not null check (credits > 0),
  price_php numeric(12,2) not null check (price_php >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.credit_packages to authenticated;
grant all on public.credit_packages to service_role;
alter table public.credit_packages enable row level security;

drop policy if exists "Signed-in members can read credit packages" on public.credit_packages;
create policy "Signed-in members can read credit packages"
  on public.credit_packages for select to authenticated using (true);

drop trigger if exists credit_packages_updated_at on public.credit_packages;
create trigger credit_packages_updated_at before update on public.credit_packages
  for each row execute function public.set_updated_at();

insert into public.credit_packages (name, credits, price_php, active, sort_order)
select 'Starter — 1,000 credits', 1000, 10, true, 0
where not exists (select 1 from public.credit_packages);

-- ============================================================
-- 3. Admin credit purchase orders
-- ============================================================
create table if not exists public.credit_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id),
  buyer_id uuid not null,
  buyer_name text not null,
  package_id uuid references public.credit_packages(id),
  package_name text not null,
  quantity integer not null default 1 check (quantity between 1 and 100),
  credits numeric(14,2) not null check (credits > 0),
  list_php numeric(12,2) not null check (list_php >= 0),
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  amount_due numeric(12,2) not null check (amount_due >= 0),
  payment_reference text not null,
  note text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','frozen')),
  reviewed_by uuid,
  reviewer_name text,
  reviewed_at timestamptz,
  decision_reason text,
  credit_ledger_id uuid references public.credit_ledger(id),
  freeze_ledger_id uuid references public.credit_ledger(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_purchase_orders_eco_idx
  on public.credit_purchase_orders (ecosystem_id, created_at desc);

-- Anti-duplicate: one live order per GCash reference. Rejected references free up.
create unique index if not exists credit_purchase_orders_reference_uq
  on public.credit_purchase_orders (lower(btrim(payment_reference)))
  where status in ('pending','approved','frozen');

grant select on public.credit_purchase_orders to authenticated;
grant all on public.credit_purchase_orders to service_role;
alter table public.credit_purchase_orders enable row level security;

drop policy if exists "Buyers, their admins and the platform owner read orders"
  on public.credit_purchase_orders;
create policy "Buyers, their admins and the platform owner read orders"
  on public.credit_purchase_orders for select to authenticated
  using (
    buyer_id = auth.uid()
    or public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );

drop trigger if exists credit_purchase_orders_updated_at on public.credit_purchase_orders;
create trigger credit_purchase_orders_updated_at before update on public.credit_purchase_orders
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. Package + settings management (platform owner only)
-- ============================================================
create or replace function public.save_credit_package(
  _id uuid, _name text, _credits numeric, _price_php numeric,
  _active boolean, _sort_order integer)
returns public.credit_packages
language plpgsql security definer set search_path to 'public' as $$
declare _row public.credit_packages;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can manage credit packages';
  end if;
  if coalesce(btrim(_name),'') = '' then raise exception 'A package name is required'; end if;
  if coalesce(_credits,0) <= 0 then raise exception 'Credits must be greater than zero'; end if;
  if coalesce(_price_php,-1) < 0 then raise exception 'Price cannot be negative'; end if;

  if _id is null then
    insert into public.credit_packages (name, credits, price_php, active, sort_order)
    values (btrim(_name), _credits, _price_php, coalesce(_active,true), coalesce(_sort_order,0))
    returning * into _row;
  else
    update public.credit_packages
       set name = btrim(_name), credits = _credits, price_php = _price_php,
           active = coalesce(_active,true), sort_order = coalesce(_sort_order,0)
     where id = _id returning * into _row;
    if _row.id is null then raise exception 'Package not found'; end if;
  end if;
  return _row;
end; $$;

create or replace function public.delete_credit_package(_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can manage credit packages';
  end if;
  if exists (select 1 from public.credit_purchase_orders where package_id = _id) then
    update public.credit_packages set active = false where id = _id;
  else
    delete from public.credit_packages where id = _id;
  end if;
end; $$;

create or replace function public.update_credit_purchase_settings(
  _admin_credit_discount_percent integer,
  _credit_gcash_number text,
  _credit_gcash_account_name text,
  _credit_payment_instructions text,
  _credit_release_mode text,
  _default_admin_sale_commission_percent integer)
returns public.platform_settings
language plpgsql security definer set search_path to 'public' as $$
declare _row public.platform_settings;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can change platform settings';
  end if;
  if _credit_release_mode not in ('manual','auto') then
    raise exception 'Unsupported release mode';
  end if;
  update public.platform_settings
     set admin_credit_discount_percent = greatest(0, least(100, coalesce(_admin_credit_discount_percent,100))),
         credit_gcash_number = coalesce(btrim(_credit_gcash_number),''),
         credit_gcash_account_name = coalesce(btrim(_credit_gcash_account_name),''),
         credit_payment_instructions = coalesce(btrim(_credit_payment_instructions),''),
         credit_release_mode = _credit_release_mode,
         default_admin_sale_commission_percent =
           greatest(0, least(100, coalesce(_default_admin_sale_commission_percent,0))),
         updated_by = auth.uid()
   where id = 1 returning * into _row;
  return _row;
end; $$;

create or replace function public.set_admin_sale_commission(_ecosystem_id uuid, _percent integer)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare _name text; _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can set shop commission';
  end if;
  if _percent is null or _percent < 0 or _percent > 100 then
    raise exception 'Commission must be between 0 and 100 percent';
  end if;
  update public.ecosystems set admin_sale_commission_percent = _percent, updated_at = now()
   where id = _ecosystem_id returning name into _name;
  if _name is null then raise exception 'Shop not found'; end if;
  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Platform owner'),
          'Set shop sale commission', _name, jsonb_build_object('percent', _percent));
  return _percent;
end; $$;

-- ============================================================
-- 5. Purchase order workflow
-- ============================================================
create or replace function public.create_credit_purchase_order(
  _package_id uuid, _quantity integer, _payment_reference text, _note text default null)
returns public.credit_purchase_orders
language plpgsql security definer set search_path to 'public' as $$
declare _pkg public.credit_packages; _set public.platform_settings; _eco uuid;
        _me text; _qty integer; _ref text; _row public.credit_purchase_orders;
        _list numeric(12,2); _due numeric(12,2); _disc integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select ecosystem_id, full_name into _eco, _me from public.profiles
   where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;
  if not public.is_ecosystem_admin(auth.uid(), _eco) then
    raise exception 'Only shop admins can buy platform credits';
  end if;

  select * into _pkg from public.credit_packages where id = _package_id;
  if _pkg.id is null or not _pkg.active then raise exception 'That credit package is not available'; end if;

  _qty := coalesce(_quantity, 1);
  if _qty < 1 or _qty > 100 then raise exception 'Choose between 1 and 100 packages'; end if;

  _ref := btrim(coalesce(_payment_reference, ''));
  if _ref = '' then raise exception 'Enter the GCash reference number'; end if;
  if exists (
    select 1 from public.credit_purchase_orders o
     where lower(btrim(o.payment_reference)) = lower(_ref)
       and o.status in ('pending','approved','frozen')
  ) then
    raise exception 'That payment reference has already been submitted';
  end if;

  select * into _set from public.platform_settings where id = 1;
  _disc := greatest(0, least(100, coalesce(_set.admin_credit_discount_percent, 100)));
  _list := round(_pkg.price_php * _qty, 2);
  _due := round(_list * (100 - _disc) / 100.0, 2);

  insert into public.credit_purchase_orders
    (ecosystem_id, buyer_id, buyer_name, package_id, package_name, quantity, credits,
     list_php, discount_percent, amount_due, payment_reference, note, status)
  values (_eco, auth.uid(), coalesce(_me,'Admin'), _pkg.id, _pkg.name, _qty,
          round(_pkg.credits * _qty, 2), _list, _disc, _due, _ref, nullif(btrim(_note),''), 'pending')
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Admin'), 'Submitted credit purchase', _pkg.name,
          jsonb_build_object('order_id', _row.id, 'credits', _row.credits,
                             'amount_due', _due, 'reference', _ref));
  return _row;
end; $$;

create or replace function public.review_credit_purchase_order(
  _order_id uuid, _approve boolean, _reason text default null)
returns public.credit_purchase_orders
language plpgsql security definer set search_path to 'public' as $$
declare _o public.credit_purchase_orders; _acct uuid; _tx text; _ledger uuid; _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can review credit purchases';
  end if;
  select * into _o from public.credit_purchase_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.status <> 'pending' then raise exception 'This order was already reviewed'; end if;
  if _o.credit_ledger_id is not null then raise exception 'Credits were already released for this order'; end if;

  select full_name into _actor from public.profiles where id = auth.uid();

  if _approve then
    select id into _acct from public.credit_accounts where user_id = _o.buyer_id;
    if _acct is null then raise exception 'The buyer has no credit wallet'; end if;
    _tx := public.new_tx_id();
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind,
                                      base_amount, commission_percent, commission_amount)
    values (_acct, _o.buyer_id, _o.ecosystem_id, 'credit', _o.credits, 0,
            'Platform credit purchase — ' || _o.package_name,
            _o.payment_reference, auth.uid(), _tx, 'credit_issue', _o.credits, 0, 0)
    returning id into _ledger;

    update public.credit_purchase_orders
       set status = 'approved', reviewed_by = auth.uid(),
           reviewer_name = coalesce(_actor,'Platform owner'), reviewed_at = now(),
           decision_reason = nullif(btrim(_reason),''), credit_ledger_id = _ledger
     where id = _order_id returning * into _o;
  else
    if coalesce(btrim(_reason),'') = '' then raise exception 'A reason is required to reject'; end if;
    update public.credit_purchase_orders
       set status = 'rejected', reviewed_by = auth.uid(),
           reviewer_name = coalesce(_actor,'Platform owner'), reviewed_at = now(),
           decision_reason = btrim(_reason)
     where id = _order_id returning * into _o;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, auth.uid(), coalesce(_actor,'Platform owner'),
          case when _approve then 'Approved credit purchase' else 'Rejected credit purchase' end,
          _o.buyer_name,
          jsonb_build_object('order_id', _o.id, 'credits', _o.credits,
                             'reference', _o.payment_reference, 'reason', _reason));
  return _o;
end; $$;

create or replace function public.freeze_credit_purchase_order(_order_id uuid, _reason text)
returns public.credit_purchase_orders
language plpgsql security definer set search_path to 'public' as $$
declare _o public.credit_purchase_orders; _acct uuid; _tx text; _ledger uuid; _actor text; _bal numeric;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can freeze released credits';
  end if;
  if coalesce(btrim(_reason),'') = '' then raise exception 'A reason is required'; end if;
  select * into _o from public.credit_purchase_orders where id = _order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.status <> 'approved' then raise exception 'Only approved purchases can be frozen'; end if;

  select id, balance into _acct, _bal from public.credit_accounts where user_id = _o.buyer_id;
  if _acct is null then raise exception 'The buyer has no credit wallet'; end if;
  if _bal < _o.credits then
    raise exception 'Cannot freeze: the buyer has already spent part of these credits (balance %)', _bal;
  end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _o.buyer_id, _o.ecosystem_id, 'debit', _o.credits, 0,
          'Credit purchase frozen — ' || btrim(_reason),
          _o.payment_reference, auth.uid(), _tx, 'credit_revocation', _o.credits, 0, 0)
  returning id into _ledger;

  select full_name into _actor from public.profiles where id = auth.uid();
  update public.credit_purchase_orders
     set status = 'frozen', freeze_ledger_id = _ledger, decision_reason = btrim(_reason),
         reviewed_by = auth.uid(), reviewer_name = coalesce(_actor,'Platform owner'), reviewed_at = now()
   where id = _order_id returning * into _o;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, auth.uid(), coalesce(_actor,'Platform owner'),
          'Froze released credits', _o.buyer_name,
          jsonb_build_object('order_id', _o.id, 'credits', _o.credits, 'reason', btrim(_reason)));
  return _o;
end; $$;

-- ============================================================
-- 6. Credit creation authority
-- ============================================================
create or replace function public.admin_adjust_credits(_user_id uuid, _amount numeric, _reason text, _reference text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _acct uuid; _tx text; _actor text; _target text; _dir text;
begin
  perform public.require_operational();
  select p.ecosystem_id, p.full_name || ' — ' || p.email into _eco, _target
  from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _amount is null or _amount = 0 then raise exception 'Enter an amount'; end if;
  -- Credit creation is a platform-owner power: shop admins may only deduct.
  if _amount > 0 and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can create credits. Buy platform credits, then load them from your own wallet.';
  end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;

  select id into _acct from public.credit_accounts where user_id = _user_id;
  if _acct is null then raise exception 'This member has no credit wallet yet'; end if;

  _tx := public.new_tx_id();
  _dir := case when _amount > 0 then 'credit' else 'debit' end;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, _dir, abs(_amount), 0, trim(_reason),
          nullif(trim(_reference),''), auth.uid(), _tx,
          case when _amount > 0 then 'credit_issue' else 'credit_revocation' end,
          abs(_amount), 0, 0);

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'),
          case when _amount > 0 then 'Created credits' else 'Deducted credits' end,
          coalesce(_target,''),
          jsonb_build_object('amount', abs(_amount), 'reason', trim(_reason), 'reference', _reference,
                             'commission_percent', 0, 'commission_amount', 0,
                             'total_received', abs(_amount), 'tx_id', _tx));
  return _tx;
end; $$;

-- Admins now hand out credits from their own wallet: supply never grows.
create or replace function public.admin_load_credits(
  _user_id uuid, _amount numeric, _reason text default null, _reference text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text;
begin
  perform public.require_operational();
  perform public.assert_actor_active();
  select p.ecosystem_id, p.full_name || ' — ' || p.email into _eco, _target
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _eco is null then raise exception 'Member not found'; end if;
  if not public.is_ecosystem_admin(auth.uid(), _eco) then
    raise exception 'Only the shop admin can load credits to shop members';
  end if;
  if _user_id = auth.uid() then raise exception 'Choose another member'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _user_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _eco, 'debit', _amount, 0,
          coalesce(nullif(trim(_reason),''), 'Credit load to shop member'),
          nullif(trim(_reference),''), auth.uid(), _tx, _amount, 0, 0);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_to, _user_id, _eco, 'credit', _amount, 0,
          coalesce(nullif(trim(_reason),''), 'Credit load from shop admin'),
          nullif(trim(_reference),''), auth.uid(), _tx || '-R', _amount, 0, 0);

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Admin'), 'Loaded credits to shop member', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'tx_id', _tx, 'recipient_id', _user_id,
                             'reason', nullif(trim(_reason),''), 'reference', nullif(trim(_reference),'')));
  return _tx;
end; $$;

-- ============================================================
-- 7. Shop-admin commission on member purchases
-- ============================================================
alter table public.sale_commissions drop constraint if exists sale_commissions_kind_chk;
alter table public.sale_commissions add constraint sale_commissions_kind_chk
  check (kind in ('sale_cashback','upline','admin'));

create or replace function public.admin_sale_commission_rate_for(_eco uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce((select admin_sale_commission_percent from public.ecosystems where id = _eco), 0)
$$;
