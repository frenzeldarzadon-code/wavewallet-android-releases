-- ============================================================
-- PART E: Super Admin-authoritative money settings
-- ============================================================
alter table public.platform_settings
  add column if not exists cashback_reseller_percent integer not null default 10,
  add column if not exists cashback_subreseller_percent integer not null default 20,
  add column if not exists cash_out_credits_per_unit numeric(14,2) not null default 1000,
  add column if not exists cash_out_php_per_unit numeric(14,2) not null default 1000,
  add column if not exists withdrawal_fee_percent numeric(5,2) not null default 1;

create or replace function public.set_platform_money_settings(
  _cashback_reseller integer,
  _cashback_subreseller integer,
  _credits_per_unit numeric,
  _php_per_unit numeric,
  _withdrawal_fee numeric)
returns public.platform_settings
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.platform_settings; _prev public.platform_settings; _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can change money settings';
  end if;
  if _cashback_reseller is null or _cashback_subreseller is null
     or _cashback_reseller < 0 or _cashback_subreseller < 0 then
    raise exception 'Cashback percentages must be zero or more';
  end if;
  if _cashback_reseller + _cashback_subreseller > 100 then
    raise exception 'Reseller + subreseller cashback cannot exceed 100%%';
  end if;
  if coalesce(_credits_per_unit,0) <= 0 or coalesce(_php_per_unit,0) <= 0 then
    raise exception 'The credit valuation must use positive amounts';
  end if;
  if _withdrawal_fee is null or _withdrawal_fee < 0 or _withdrawal_fee > 100 then
    raise exception 'The withdrawal fee must be between 0%% and 100%%';
  end if;

  select * into _prev from public.platform_settings where id = 1;
  update public.platform_settings
     set cashback_reseller_percent = _cashback_reseller,
         cashback_subreseller_percent = _cashback_subreseller,
         cash_out_credits_per_unit = _credits_per_unit,
         cash_out_php_per_unit = _php_per_unit,
         withdrawal_fee_percent = _withdrawal_fee,
         updated_at = now(), updated_by = auth.uid()
   where id = 1
   returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce(_actor,'Super Admin'), 'Updated platform money settings', 'Platform settings',
          jsonb_build_object(
            'previous', jsonb_build_object(
              'cashback_reseller_percent', _prev.cashback_reseller_percent,
              'cashback_subreseller_percent', _prev.cashback_subreseller_percent,
              'cash_out_credits_per_unit', _prev.cash_out_credits_per_unit,
              'cash_out_php_per_unit', _prev.cash_out_php_per_unit,
              'withdrawal_fee_percent', _prev.withdrawal_fee_percent),
            'new', jsonb_build_object(
              'cashback_reseller_percent', _cashback_reseller,
              'cashback_subreseller_percent', _cashback_subreseller,
              'cash_out_credits_per_unit', _credits_per_unit,
              'cash_out_php_per_unit', _php_per_unit,
              'withdrawal_fee_percent', _withdrawal_fee),
            'applies_to', 'future transactions only'));
  return _row;
end $$;

create or replace function public.sale_commission_rate_for(_recipient uuid)
returns integer language plpgsql stable security definer set search_path to 'public'
as $$
declare _eco uuid; _status public.account_status; _pct integer;
begin
  if _recipient is null then return 0; end if;
  select p.ecosystem_id, p.status into _eco, _status from public.profiles p where p.id = _recipient;
  if _eco is null or _status <> 'active' then return 0; end if;
  if public.is_super_admin(_recipient) or public.is_ecosystem_admin(_recipient, _eco) then return 0; end if;

  if exists (select 1 from public.user_roles ur
              where ur.user_id = _recipient and ur.role = 'subreseller' and ur.ecosystem_id = _eco) then
    select cashback_subreseller_percent into _pct from public.platform_settings where id = 1;
  elsif exists (select 1 from public.user_roles ur
                 where ur.user_id = _recipient and ur.role = 'reseller' and ur.ecosystem_id = _eco) then
    select cashback_reseller_percent into _pct from public.platform_settings where id = 1;
  else
    return 0;
  end if;
  return least(greatest(coalesce(_pct,0),0),100);
end $$;

create or replace function public.upline_commission_rate_for(_ecosystem_id uuid)
returns integer language sql stable security definer set search_path to 'public'
as $$
  select least(greatest(coalesce((select cashback_reseller_percent from public.platform_settings where id = 1),0),0),100);
$$;

create or replace function public.set_ecosystem_rates(_ecosystem_id uuid, _reseller_sale_percent integer,
  _subreseller_sale_percent integer, _upline_percent integer,
  _reseller_discount_percent integer, _subreseller_discount_percent integer)
returns public.ecosystems language plpgsql security definer set search_path to 'public'
as $$
declare _row public.ecosystems; _prev public.ecosystems; _actor text;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this shop';
  end if;
  select * into _prev from public.ecosystems where id = _ecosystem_id;
  if _prev.id is null then raise exception 'Shop not found'; end if;
  if _reseller_discount_percent not between 0 and 100
     or _subreseller_discount_percent not between 0 and 100 then
    raise exception 'Every percentage must be between 0 and 100';
  end if;

  update public.ecosystems e
     set default_reseller_discount_percent = _reseller_discount_percent,
         default_subreseller_discount_percent = _subreseller_discount_percent,
         updated_at = now()
   where e.id = _ecosystem_id
   returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Updated wholesale discounts', _row.name,
          jsonb_build_object(
            'previous', jsonb_build_object('reseller_discount_percent', _prev.default_reseller_discount_percent,
                                           'subreseller_discount_percent', _prev.default_subreseller_discount_percent),
            'new', jsonb_build_object('reseller_discount_percent', _reseller_discount_percent,
                                      'subreseller_discount_percent', _subreseller_discount_percent),
            'note', 'cashback percentages are controlled by the platform owner',
            'applies_to', 'future transactions only'));
  return _row;
end $$;

create or replace function public.set_ecosystem_sale_commission(_ecosystem_id uuid, _reseller_percent integer, _subreseller_percent integer)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  raise exception 'Cashback percentages are set by the platform owner in Platform settings';
end $$;

create or replace function public.set_sale_commission(_user_id uuid, _percent integer)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  raise exception 'Cashback percentages are set by the platform owner in Platform settings';
end $$;

-- ============================================================
-- PART B: real-money withdrawals
-- ============================================================
create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_key text unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  ecosystem_id uuid references public.ecosystems(id) on delete set null,
  requester_name text not null,
  requester_role text not null,
  credits numeric(14,2) not null,
  rate_credits numeric(14,2) not null,
  rate_php numeric(14,2) not null,
  gross_php numeric(14,2) not null,
  fee_percent numeric(5,2) not null,
  fee_php numeric(14,2) not null,
  net_php numeric(14,2) not null,
  payment_mode text not null check (payment_mode in ('physical_cash','ewallet','bank')),
  account_name text,
  account_number text,
  notes text,
  status text not null default 'pending'
    check (status in ('pending','approved','released','rejected','cancelled')),
  reserve_ledger_id uuid references public.credit_ledger(id),
  refund_ledger_id uuid references public.credit_ledger(id),
  reviewed_by uuid references auth.users(id),
  reviewer_name text,
  decision_reason text,
  reviewed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.withdrawal_requests to authenticated;
grant all on public.withdrawal_requests to service_role;
alter table public.withdrawal_requests enable row level security;

drop policy if exists "Members read own withdrawals" on public.withdrawal_requests;
create policy "Members read own withdrawals" on public.withdrawal_requests
  for select to authenticated
  using (user_id = public.effective_uid() or public.is_super_admin(auth.uid()));

create index if not exists withdrawal_requests_status_idx on public.withdrawal_requests (status, created_at desc);
create index if not exists withdrawal_requests_user_idx on public.withdrawal_requests (user_id, created_at desc);

-- ============================================================
-- PART C: cash-in payment methods + requests
-- ============================================================
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  method_type text not null check (method_type in ('physical_cash','ewallet','bank')),
  instructions text not null default '',
  account_name text,
  account_number text,
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.payment_methods to authenticated;
grant all on public.payment_methods to service_role;
alter table public.payment_methods enable row level security;

drop policy if exists "Members read active payment methods" on public.payment_methods;
create policy "Members read active payment methods" on public.payment_methods
  for select to authenticated using (active or public.is_super_admin(auth.uid()));
drop policy if exists "Platform owner manages payment methods" on public.payment_methods;
create policy "Platform owner manages payment methods" on public.payment_methods
  for all to authenticated
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

create table if not exists public.cash_in_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_key text unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  ecosystem_id uuid references public.ecosystems(id) on delete set null,
  requester_name text not null,
  requester_role text not null,
  amount_php numeric(14,2) not null,
  rate_credits numeric(14,2) not null,
  rate_php numeric(14,2) not null,
  credits numeric(14,2) not null,
  method_id uuid references public.payment_methods(id),
  method_name text not null,
  method_type text not null,
  method_details jsonb not null default '{}'::jsonb,
  payer_reference text,
  notes text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  ledger_id uuid references public.credit_ledger(id),
  reviewed_by uuid references auth.users(id),
  reviewer_name text,
  decision_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.cash_in_requests to authenticated;
grant all on public.cash_in_requests to service_role;
alter table public.cash_in_requests enable row level security;

drop policy if exists "Members read own cash-in requests" on public.cash_in_requests;
create policy "Members read own cash-in requests" on public.cash_in_requests
  for select to authenticated
  using (user_id = public.effective_uid() or public.is_super_admin(auth.uid()));

create index if not exists cash_in_requests_status_idx on public.cash_in_requests (status, created_at desc);
create index if not exists cash_in_requests_user_idx on public.cash_in_requests (user_id, created_at desc);

-- ============================================================
-- PART D: immutability guards
-- ============================================================
create or replace function public.guard_money_request_update()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if old.status in ('released','rejected','cancelled') then
    raise exception 'This request is already closed and cannot be changed';
  end if;
  if new.id <> old.id or new.reference <> old.reference or new.user_id <> old.user_id
     or new.created_at <> old.created_at then
    raise exception 'Request identity is immutable';
  end if;
  return new;
end $$;

create or replace function public.guard_withdrawal_update()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.credits <> old.credits or new.rate_credits <> old.rate_credits
     or new.rate_php <> old.rate_php or new.gross_php <> old.gross_php
     or new.fee_percent <> old.fee_percent or new.fee_php <> old.fee_php
     or new.net_php <> old.net_php then
    raise exception 'The amounts on a withdrawal request are immutable';
  end if;
  return new;
end $$;

create or replace function public.guard_cash_in_update()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.amount_php <> old.amount_php or new.credits <> old.credits
     or new.rate_credits <> old.rate_credits or new.rate_php <> old.rate_php then
    raise exception 'The amounts on a cash-in request are immutable';
  end if;
  return new;
end $$;

drop trigger if exists withdrawal_requests_guard on public.withdrawal_requests;
create trigger withdrawal_requests_guard before update on public.withdrawal_requests
  for each row execute function public.guard_money_request_update();
drop trigger if exists withdrawal_requests_amount_guard on public.withdrawal_requests;
create trigger withdrawal_requests_amount_guard before update on public.withdrawal_requests
  for each row execute function public.guard_withdrawal_update();
drop trigger if exists cash_in_requests_guard on public.cash_in_requests;
create trigger cash_in_requests_guard before update on public.cash_in_requests
  for each row execute function public.guard_money_request_update();
drop trigger if exists cash_in_requests_amount_guard on public.cash_in_requests;
create trigger cash_in_requests_amount_guard before update on public.cash_in_requests
  for each row execute function public.guard_cash_in_update();

drop trigger if exists withdrawal_requests_touch on public.withdrawal_requests;
create trigger withdrawal_requests_touch before update on public.withdrawal_requests
  for each row execute function public.set_updated_at();
drop trigger if exists cash_in_requests_touch on public.cash_in_requests;
create trigger cash_in_requests_touch before update on public.cash_in_requests
  for each row execute function public.set_updated_at();
drop trigger if exists payment_methods_touch on public.payment_methods;
create trigger payment_methods_touch before update on public.payment_methods
  for each row execute function public.set_updated_at();
