-- Universe Loan Pool: peer funded Universe loans, separate from Shop Loans.

alter table public.platform_settings
  add column if not exists universe_loan_enabled boolean not null default true,
  add column if not exists universe_loan_interest_percent numeric(6,3) not null default 2,
  add column if not exists universe_loan_owner_share_percent numeric(6,2) not null default 50,
  add column if not exists universe_loan_contributor_share_percent numeric(6,2) not null default 50,
  add column if not exists universe_loan_platform_fee_percent numeric(6,3) not null default 2;

create table if not exists public.loan_pool_accounts (
  user_id uuid primary key,
  contributed numeric(14,2) not null default 0,
  available numeric(14,2) not null default 0,
  allocated numeric(14,2) not null default 0,
  interest_earned numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.universe_loans (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null,
  amount numeric(14,2) not null,
  term_months integer not null,
  status text not null default 'pending_funding',
  interest_percent numeric(6,3) not null,
  platform_fee_percent numeric(6,3) not null,
  owner_share_percent numeric(6,2) not null,
  contributor_share_percent numeric(6,2) not null,
  funded_amount numeric(14,2) not null default 0,
  platform_fee numeric(14,2) not null default 0,
  released_amount numeric(14,2) not null default 0,
  principal_outstanding numeric(14,2) not null default 0,
  principal_paid numeric(14,2) not null default 0,
  interest_accrued numeric(14,2) not null default 0,
  interest_paid numeric(14,2) not null default 0,
  interest_refunded numeric(14,2) not null default 0,
  id_document_path text,
  id_document_uploaded_at timestamptz,
  last_accrual_at timestamptz,
  released_at timestamptz,
  settled_at timestamptz,
  cancelled_at timestamptz,
  client_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists universe_loans_borrower_idx on public.universe_loans (borrower_id, created_at desc);
create index if not exists universe_loans_status_idx on public.universe_loans (status);
create unique index if not exists universe_loans_client_token_idx
  on public.universe_loans (borrower_id, client_token) where client_token is not null;

create table if not exists public.universe_loan_fundings (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.universe_loans(id) on delete cascade,
  funder_id uuid not null,
  amount numeric(14,2) not null default 0,
  released_principal numeric(14,2) not null default 0,
  principal_repaid numeric(14,2) not null default 0,
  interest_earned numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loan_id, funder_id)
);

create table if not exists public.universe_loan_schedule (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.universe_loans(id) on delete cascade,
  period_index integer not null,
  due_date date not null,
  principal_due numeric(14,2) not null,
  interest_due numeric(14,2) not null,
  total_due numeric(14,2) not null,
  unique (loan_id, period_index)
);

create table if not exists public.universe_loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.universe_loans(id) on delete cascade,
  user_id uuid not null,
  kind text not null,
  amount numeric(14,2) not null,
  principal_part numeric(14,2) not null default 0,
  interest_part numeric(14,2) not null default 0,
  principal_after numeric(14,2) not null default 0,
  ledger_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists universe_loan_payments_loan_idx on public.universe_loan_payments (loan_id, created_at);

create table if not exists public.universe_loan_earnings (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.universe_loans(id) on delete cascade,
  kind text not null,
  amount numeric(14,2) not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.loan_pool_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  loan_id uuid references public.universe_loans(id) on delete set null,
  kind text not null,
  amount numeric(14,2) not null,
  available_after numeric(14,2) not null,
  allocated_after numeric(14,2) not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists loan_pool_ledger_user_idx on public.loan_pool_ledger (user_id, created_at desc);

grant select on public.loan_pool_accounts to authenticated;
grant select on public.loan_pool_ledger to authenticated;
grant select on public.universe_loans to authenticated;
grant select on public.universe_loan_fundings to authenticated;
grant select on public.universe_loan_schedule to authenticated;
grant select on public.universe_loan_payments to authenticated;
grant select on public.universe_loan_earnings to authenticated;
grant all on public.loan_pool_accounts to service_role;
grant all on public.loan_pool_ledger to service_role;
grant all on public.universe_loans to service_role;
grant all on public.universe_loan_fundings to service_role;
grant all on public.universe_loan_schedule to service_role;
grant all on public.universe_loan_payments to service_role;
grant all on public.universe_loan_earnings to service_role;

alter table public.loan_pool_accounts enable row level security;
alter table public.loan_pool_ledger enable row level security;
alter table public.universe_loans enable row level security;
alter table public.universe_loan_fundings enable row level security;
alter table public.universe_loan_schedule enable row level security;
alter table public.universe_loan_payments enable row level security;
alter table public.universe_loan_earnings enable row level security;

drop policy if exists "Own pool account" on public.loan_pool_accounts;
create policy "Own pool account" on public.loan_pool_accounts for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin(auth.uid()));
drop policy if exists "Own pool ledger" on public.loan_pool_ledger;
create policy "Own pool ledger" on public.loan_pool_ledger for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin(auth.uid()));
drop policy if exists "Loan visible to borrower funders owner" on public.universe_loans;
create policy "Loan visible to borrower funders owner" on public.universe_loans for select to authenticated
  using (
    borrower_id = auth.uid()
    or public.is_super_admin(auth.uid())
    or exists (select 1 from public.universe_loan_fundings f
                where f.loan_id = universe_loans.id and f.funder_id = auth.uid())
  );
drop policy if exists "Funding visible to funder borrower owner" on public.universe_loan_fundings;
create policy "Funding visible to funder borrower owner" on public.universe_loan_fundings for select to authenticated
  using (
    funder_id = auth.uid()
    or public.is_super_admin(auth.uid())
    or exists (select 1 from public.universe_loans l
                where l.id = universe_loan_fundings.loan_id and l.borrower_id = auth.uid())
  );
drop policy if exists "Schedule visible to loan parties" on public.universe_loan_schedule;
create policy "Schedule visible to loan parties" on public.universe_loan_schedule for select to authenticated
  using (exists (select 1 from public.universe_loans l
                  where l.id = universe_loan_schedule.loan_id
                    and (l.borrower_id = auth.uid() or public.is_super_admin(auth.uid())
                         or exists (select 1 from public.universe_loan_fundings f
                                     where f.loan_id = l.id and f.funder_id = auth.uid()))));
drop policy if exists "Payments visible to loan parties" on public.universe_loan_payments;
create policy "Payments visible to loan parties" on public.universe_loan_payments for select to authenticated
  using (exists (select 1 from public.universe_loans l
                  where l.id = universe_loan_payments.loan_id
                    and (l.borrower_id = auth.uid() or public.is_super_admin(auth.uid())
                         or exists (select 1 from public.universe_loan_fundings f
                                     where f.loan_id = l.id and f.funder_id = auth.uid()))));
drop policy if exists "Earnings visible to owner" on public.universe_loan_earnings;
create policy "Earnings visible to owner" on public.universe_loan_earnings for select to authenticated
  using (public.is_super_admin(auth.uid()));

create or replace function public.universe_loan_settings()
returns table (
  enabled boolean,
  interest_percent numeric,
  owner_share_percent numeric,
  contributor_share_percent numeric,
  platform_fee_percent numeric,
  terms integer[]
)
language sql stable security definer set search_path = public as $$
  select coalesce(s.universe_loan_enabled, true),
         coalesce(s.universe_loan_interest_percent, 2)::numeric,
         coalesce(s.universe_loan_owner_share_percent, 50)::numeric,
         coalesce(s.universe_loan_contributor_share_percent, 50)::numeric,
         coalesce(s.universe_loan_platform_fee_percent, 2)::numeric,
         array[3,6,12]
    from public.platform_settings s where s.id = 1;
$$;

create or replace function public.set_universe_loan_settings(
  _enabled boolean,
  _interest numeric,
  _owner_share numeric,
  _contributor_share numeric,
  _platform_fee numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin(public.effective_uid()) then
    raise exception 'Only the platform owner can change Universe loan settings';
  end if;
  if coalesce(_interest,0) < 0 or coalesce(_interest,0) > 20 then
    raise exception 'Interest rate must be between 0 and 20 percent per month';
  end if;
  if coalesce(_platform_fee,0) < 0 or coalesce(_platform_fee,0) > 50 then
    raise exception 'Platform fee must be between 0 and 50 percent';
  end if;
  if round(coalesce(_owner_share,0) + coalesce(_contributor_share,0), 2) <> 100 then
    raise exception 'The owner and contributor interest shares must add up to 100 percent';
  end if;
  update public.platform_settings
     set universe_loan_enabled = coalesce(_enabled, true),
         universe_loan_interest_percent = round(_interest, 3),
         universe_loan_owner_share_percent = round(_owner_share, 2),
         universe_loan_contributor_share_percent = round(_contributor_share, 2),
         universe_loan_platform_fee_percent = round(_platform_fee, 3),
         updated_at = now(),
         updated_by = public.effective_uid()
   where id = 1;
end $$;

create or replace function public.ensure_loan_pool_account(_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.loan_pool_accounts (user_id) values (_user)
  on conflict (user_id) do nothing;
end $$;

create or replace function public.loan_pool_note(
  _user uuid, _loan uuid, _kind text, _amount numeric, _note text
) returns void language plpgsql security definer set search_path = public as $$
declare _a numeric(14,2); _b numeric(14,2);
begin
  select available, allocated into _a, _b from public.loan_pool_accounts where user_id = _user;
  insert into public.loan_pool_ledger (user_id, loan_id, kind, amount, available_after, allocated_after, note)
  values (_user, _loan, _kind, round(_amount,2), coalesce(_a,0), coalesce(_b,0), _note);
end $$;

create or replace function public.loan_pool_contribute(_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _acct uuid; _bal numeric(14,2); _amt numeric(14,2);
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();
  _amt := round(coalesce(_amount,0), 2);
  if _amt <= 0 then raise exception 'Enter an amount greater than zero'; end if;

  perform public.ensure_loan_pool_account(_me);
  perform public.ensure_global_wallet(_me);

  select id, balance into _acct, _bal from public.credit_accounts
   where user_id = _me and ecosystem_id is null for update;
  if _acct is null then raise exception 'Universe wallet not found'; end if;
  if _bal < _amt then raise exception 'Not enough coins in your Universe wallet'; end if;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    reason, entry_kind, actor_id)
  values (_acct, _me, null, 'debit', _amt, 'Loan Pool contribution', 'loan_pool_contribution', _me);

  update public.loan_pool_accounts
     set contributed = contributed + _amt, available = available + _amt, updated_at = now()
   where user_id = _me;
  perform public.loan_pool_note(_me, null, 'contribution', _amt, null);
  return _amt;
end $$;

create or replace function public.loan_pool_withdraw(_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _acct uuid; _avail numeric(14,2); _amt numeric(14,2);
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();
  _amt := round(coalesce(_amount,0), 2);
  if _amt <= 0 then raise exception 'Enter an amount greater than zero'; end if;

  select available into _avail from public.loan_pool_accounts where user_id = _me for update;
  if coalesce(_avail,0) < _amt then
    raise exception 'Only % coins are available to take back right now', coalesce(_avail,0);
  end if;

  perform public.ensure_global_wallet(_me);
  select id into _acct from public.credit_accounts where user_id = _me and ecosystem_id is null for update;

  update public.loan_pool_accounts
     set available = available - _amt,
         contributed = greatest(0, contributed - _amt),
         updated_at = now()
   where user_id = _me;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    reason, entry_kind, actor_id)
  values (_acct, _me, null, 'credit', _amt, 'Loan Pool withdrawal', 'loan_pool_withdrawal', _me);

  perform public.loan_pool_note(_me, null, 'withdrawal', _amt, null);
  return _amt;
end $$;

create or replace function public.my_loan_pool()
returns table (
  contributed numeric, available numeric, allocated numeric, interest_earned numeric,
  pool_total numeric, pool_available numeric, pool_allocated numeric, wallet_balance numeric
) language sql stable security definer set search_path = public as $$
  select coalesce(a.contributed,0)::numeric, coalesce(a.available,0)::numeric,
         coalesce(a.allocated,0)::numeric, coalesce(a.interest_earned,0)::numeric,
         (select coalesce(sum(available + allocated),0) from public.loan_pool_accounts),
         (select coalesce(sum(available),0) from public.loan_pool_accounts),
         (select coalesce(sum(allocated),0) from public.loan_pool_accounts),
         (select coalesce(balance,0) from public.credit_accounts
           where user_id = public.effective_uid() and ecosystem_id is null)
    from (select public.effective_uid() as uid) me
    left join public.loan_pool_accounts a on a.user_id = me.uid;
$$;

create or replace function public.my_loan_pool_history()
returns setof public.loan_pool_ledger
language sql stable security definer set search_path = public as $$
  select * from public.loan_pool_ledger
   where user_id = public.effective_uid()
   order by created_at desc limit 200;
$$;