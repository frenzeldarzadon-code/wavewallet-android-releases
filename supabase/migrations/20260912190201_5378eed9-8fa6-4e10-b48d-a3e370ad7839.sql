
-- 1. Settings ---------------------------------------------------------------
alter table public.platform_settings
  add column if not exists loans_enabled boolean not null default true,
  add column if not exists loan_auto_base_credits numeric(14,2) not null default 1000,
  add column if not exists loan_free_balance_multiplier numeric(6,2) not null default 3,
  add column if not exists loan_monthly_interest_percent numeric(6,2) not null default 2,
  add column if not exists loan_first_month_upfront boolean not null default true;

-- 2. Restricted (loaned) portion of the existing wallet ----------------------
alter table public.credit_accounts
  add column if not exists restricted_balance numeric(14,2) not null default 0;

do $$ begin
  alter table public.credit_accounts
    add constraint credit_accounts_restricted_range
    check (restricted_balance >= 0 and restricted_balance <= balance);
exception when duplicate_object then null; end $$;

-- 3. Loan records ------------------------------------------------------------
create table if not exists public.coin_loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  principal numeric(14,2) not null check (principal > 0),
  interest_percent numeric(6,2) not null,
  auto_limit_snapshot numeric(14,2) not null,
  base_snapshot numeric(14,2) not null,
  multiplier_snapshot numeric(6,2) not null,
  free_balance_snapshot numeric(14,2) not null,
  first_month_interest numeric(14,2) not null default 0,
  released_amount numeric(14,2) not null default 0,
  total_owed numeric(14,2) not null default 0,
  outstanding numeric(14,2) not null default 0,
  accrued_interest numeric(14,2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending','active','settled','rejected','cancelled')),
  approval_mode text not null check (approval_mode in ('automatic','manual')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  released_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coin_loans_user_idx on public.coin_loans (user_id, status);
create unique index if not exists coin_loans_one_open
  on public.coin_loans (user_id) where status in ('pending','active');

create table if not exists public.coin_loan_entries (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.coin_loans(id) on delete cascade,
  kind text not null check (kind in ('release','upfront_interest','interest','repayment','writeoff')),
  amount numeric(14,2) not null,
  outstanding_after numeric(14,2) not null,
  ledger_id uuid references public.credit_ledger(id) on delete set null,
  period_index integer,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists coin_loan_entries_loan_idx on public.coin_loan_entries (loan_id, created_at);
create unique index if not exists coin_loan_entries_period_unique
  on public.coin_loan_entries (loan_id, kind, period_index) where period_index is not null;

grant select on public.coin_loans to authenticated;
grant select on public.coin_loan_entries to authenticated;
grant all on public.coin_loans to service_role;
grant all on public.coin_loan_entries to service_role;

alter table public.coin_loans enable row level security;
alter table public.coin_loan_entries enable row level security;

create policy "Members read their own loans" on public.coin_loans
  for select to authenticated
  using (user_id = public.effective_uid() or user_id = auth.uid() or public.is_super_admin(auth.uid()));

create policy "Members read their own loan events" on public.coin_loan_entries
  for select to authenticated
  using (exists (select 1 from public.coin_loans l
                  where l.id = loan_id
                    and (l.user_id = public.effective_uid() or l.user_id = auth.uid()
                         or public.is_super_admin(auth.uid()))));

create trigger coin_loans_updated_at before update on public.coin_loans
  for each row execute function public.set_updated_at();

-- 4. Helpers -----------------------------------------------------------------
create or replace function public.coin_loan_settings()
returns table(enabled boolean, base_credits numeric, multiplier numeric,
              monthly_interest_percent numeric, first_month_upfront boolean)
language sql stable security definer set search_path = public as $$
  select loans_enabled, loan_auto_base_credits, loan_free_balance_multiplier,
         loan_monthly_interest_percent, loan_first_month_upfront
    from public.platform_settings where id = 1;
$$;

revoke all on function public.coin_loan_settings() from public, anon;
grant execute on function public.coin_loan_settings() to authenticated, service_role;

-- Does this member hold a position (admin / reseller / subreseller) anywhere?
create or replace function public.has_loan_position(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _user_id
       and m.membership_state = 'active'
       and coalesce(m.status::text, 'active') = 'active'
       and m.role in ('admin','reseller','subreseller')
  );
$$;

-- May loaned coins be spent in this shop? Only where the borrower holds a position.
create or replace function public.loan_spend_allowed_in(_user_id uuid, _ecosystem_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _ecosystem_id is not null and exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _user_id
       and m.ecosystem_id = _ecosystem_id
       and m.membership_state = 'active'
       and coalesce(m.status::text, 'active') = 'active'
       and m.role in ('admin','reseller','subreseller')
  );
$$;

revoke all on function public.has_loan_position(uuid) from public, anon;
revoke all on function public.loan_spend_allowed_in(uuid, uuid) from public, anon;
grant execute on function public.has_loan_position(uuid) to authenticated, service_role;
grant execute on function public.loan_spend_allowed_in(uuid, uuid) to authenticated, service_role;

-- Free (unloaned) balance of the member's global Universe wallet.
create or replace function public.free_coin_balance(_user_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(max(ca.balance - ca.restricted_balance), 0)
    from public.credit_accounts ca
   where ca.user_id = _user_id and ca.ecosystem_id is null;
$$;

revoke all on function public.free_coin_balance(uuid) from public, anon;
grant execute on function public.free_coin_balance(uuid) to authenticated, service_role;

-- Automatic approval ceiling: greater of the configured base and multiplier x free balance.
create or replace function public.coin_loan_auto_limit(_user_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(s.loan_auto_base_credits,
                  round(s.loan_free_balance_multiplier * public.free_coin_balance(_user_id), 2))
    from public.platform_settings s where s.id = 1;
$$;

revoke all on function public.coin_loan_auto_limit(uuid) from public, anon;
grant execute on function public.coin_loan_auto_limit(uuid) to authenticated, service_role;

-- 5. Server-side restriction guard on every coin movement --------------------
create or replace function public.guard_restricted_coins()
returns trigger language plpgsql security definer set search_path = public as $$
declare _bal numeric(14,2); _restricted numeric(14,2); _projected numeric(14,2);
        _owner uuid; _may_consume boolean;
begin
  if new.direction <> 'debit' then return new; end if;

  select balance, restricted_balance, user_id
    into _bal, _restricted, _owner
    from public.credit_accounts where id = new.account_id for update;
  if _restricted is null or _restricted <= 0 then return new; end if;

  _projected := _bal - new.amount;
  if _projected >= _restricted then return new; end if;

  _may_consume := coalesce(new.entry_kind, 'general') = 'loan_repayment'
    or (coalesce(new.entry_kind, 'general') = 'purchase'
        and public.loan_spend_allowed_in(_owner, new.ecosystem_id));

  if not _may_consume then
    raise exception 'Loaned coins can only be spent buying from shops where you are an admin, reseller or subreseller. Free balance: %', round(_bal - _restricted, 2)
      using errcode = 'check_violation';
  end if;

  update public.credit_accounts
     set restricted_balance = greatest(0, least(_restricted, _projected)),
         updated_at = now()
   where id = new.account_id;
  return new;
end $$;

create trigger aaa_credit_ledger_restricted_guard
  before insert on public.credit_ledger
  for each row execute function public.guard_restricted_coins();

-- 6. Repayment ---------------------------------------------------------------
create or replace function public.apply_loan_repayment(_user_id uuid, _amount numeric, _reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare _loan public.coin_loans; _acct uuid; _bal numeric(14,2); _pay numeric(14,2); _ledger uuid;
begin
  select * into _loan from public.coin_loans
   where user_id = _user_id and status = 'active' for update;
  if _loan.id is null then return 0; end if;

  select id, balance into _acct, _bal from public.credit_accounts
   where user_id = _user_id and ecosystem_id is null for update;
  if _acct is null then return 0; end if;

  _pay := round(least(coalesce(_amount, 0), _loan.outstanding, _bal), 2);
  if _pay <= 0 then return 0; end if;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    reason, entry_kind, actor_id)
  values (_acct, _user_id, null, 'debit', _pay,
          coalesce(_reason, 'Coin loan repayment'), 'loan_repayment', _user_id)
  returning id into _ledger;

  update public.coin_loans
     set outstanding = round(outstanding - _pay, 2),
         status = case when round(outstanding - _pay, 2) <= 0 then 'settled' else status end,
         settled_at = case when round(outstanding - _pay, 2) <= 0 then now() else settled_at end
   where id = _loan.id;

  insert into public.coin_loan_entries (loan_id, kind, amount, outstanding_after, ledger_id, note)
  values (_loan.id, 'repayment', _pay, round(_loan.outstanding - _pay, 2), _ledger, _reason);

  return _pay;
end $$;

revoke all on function public.apply_loan_repayment(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_loan_repayment(uuid, numeric, text) to service_role;

-- Top-ups repay first, the excess stays as spendable coins.
create or replace function public.tg_loan_repayment_on_topup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'credit'
     and coalesce(new.entry_kind, 'general') in ('cash_in', 'admin_cash_in')
     and exists (select 1 from public.credit_accounts ca
                  where ca.id = new.account_id and ca.ecosystem_id is null)
     and exists (select 1 from public.coin_loans l
                  where l.user_id = new.user_id and l.status = 'active') then
    perform public.apply_loan_repayment(new.user_id, new.amount,
      'Loan repayment from top up');
  end if;
  return null;
end $$;

create trigger zzz_credit_ledger_loan_repayment
  after insert on public.credit_ledger
  for each row execute function public.tg_loan_repayment_on_topup();
