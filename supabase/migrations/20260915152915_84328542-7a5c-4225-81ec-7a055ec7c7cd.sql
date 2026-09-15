-- 1. Persist which shop (and which admin) a loan is secured against ----------
alter table public.coin_loans
  add column if not exists secured_ecosystem_id uuid references public.ecosystems(id) on delete set null,
  add column if not exists secured_admin_id uuid;

create index if not exists coin_loans_secured_eco_idx on public.coin_loans (secured_ecosystem_id) where status = 'active';
create index if not exists coin_loans_secured_admin_idx on public.coin_loans (secured_admin_id) where status = 'active';

-- The shop a borrower holds their loan position in (earliest active position).
create or replace function public.loan_security_shop(_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.ecosystem_id
    from public.ecosystem_memberships m
    join public.ecosystems e on e.id = m.ecosystem_id
   where m.user_id = _user_id
     and m.membership_state = 'active'
     and coalesce(m.status::text, 'active') = 'active'
     and m.role in ('admin','reseller','subreseller')
     and e.archived_at is null
   order by m.created_at
   limit 1
$$;

create or replace function public.tg_coin_loan_security_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.secured_ecosystem_id is null then
    new.secured_ecosystem_id := public.loan_security_shop(new.user_id);
  end if;
  if new.secured_admin_id is null and new.secured_ecosystem_id is not null then
    new.secured_admin_id := public.shop_primary_admin(new.secured_ecosystem_id);
  end if;
  return new;
end $$;

drop trigger if exists coin_loans_security_snapshot on public.coin_loans;
create trigger coin_loans_security_snapshot
  before insert on public.coin_loans
  for each row execute function public.tg_coin_loan_security_snapshot();

-- Backfill loans that are still in progress (no financial value is changed).
update public.coin_loans l
   set secured_ecosystem_id = public.loan_security_shop(l.user_id)
 where l.secured_ecosystem_id is null and l.status in ('pending','active');
update public.coin_loans l
   set secured_admin_id = public.shop_primary_admin(l.secured_ecosystem_id)
 where l.secured_admin_id is null and l.secured_ecosystem_id is not null
   and l.status in ('pending','active');

-- 2. Which shops an admin secures ---------------------------------------------
create or replace function public.admin_secured_shops(_admin uuid)
returns table (ecosystem_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select m.ecosystem_id
    from public.ecosystem_memberships m
   where m.user_id = _admin
     and m.role = 'admin'
     and m.membership_state = 'active'
     and coalesce(m.status::text, 'active') = 'active'
  union
  -- Shops this admin secured when the loan was taken: the lock survives if the
  -- admin later leaves the shop, until those loans are settled.
  select l.secured_ecosystem_id
    from public.coin_loans l
   where l.secured_admin_id = _admin
     and l.status = 'active'
     and l.secured_ecosystem_id is not null
$$;

-- Is this shop inside the admin's own protected scope?
create or replace function public.admin_security_covers_shop(_admin uuid, _ecosystem_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _ecosystem_id is not null
     and exists (select 1 from public.admin_secured_shops(_admin) s
                  where s.ecosystem_id = _ecosystem_id)
$$;

-- 3. Current secured exposure (total owed today, interest included) ------------
create or replace function public.admin_secured_loan_exposure(_admin uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(round(sum(x.outstanding), 2), 0) from (
    select distinct on (l.id) l.id, l.outstanding
      from public.coin_loans l
     where l.status = 'active'
       and l.outstanding > 0
       and l.user_id <> _admin           -- the admin's own loan is already restricted
       and (
             l.secured_admin_id = _admin
          or l.secured_ecosystem_id in (select s.ecosystem_id from public.admin_secured_shops(_admin) s)
       )
  ) x
$$;

-- How much of the admin's global wallet may leave the protected scope.
create or replace function public.admin_unsecured_balance(_admin uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, round(public.free_coin_balance(_admin)
                           - public.admin_secured_loan_exposure(_admin), 2))
$$;

revoke all on function public.loan_security_shop(uuid) from public, anon;
revoke all on function public.admin_secured_shops(uuid) from public, anon;
revoke all on function public.admin_security_covers_shop(uuid, uuid) from public, anon;
revoke all on function public.admin_secured_loan_exposure(uuid) from public, anon;
revoke all on function public.admin_unsecured_balance(uuid) from public, anon;
grant execute on function public.admin_secured_shops(uuid) to authenticated, service_role;
grant execute on function public.admin_security_covers_shop(uuid, uuid) to authenticated, service_role;
grant execute on function public.admin_secured_loan_exposure(uuid) to authenticated, service_role;
grant execute on function public.admin_unsecured_balance(uuid) to authenticated, service_role;
grant execute on function public.loan_security_shop(uuid) to authenticated, service_role;

-- 4. Enforce at the single authoritative money chokepoint ----------------------
create or replace function public.guard_admin_loan_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare _bal numeric(14,2); _restricted numeric(14,2); _eco uuid; _owner uuid;
        _exposure numeric(14,2); _free_after numeric(14,2); _kind text;
begin
  if new.direction <> 'debit' then return new; end if;

  -- Only the global (Universe) wallet holds the admin's secured coins.
  select ca.balance, ca.restricted_balance, ca.ecosystem_id, ca.user_id
    into _bal, _restricted, _eco, _owner
    from public.credit_accounts ca where ca.id = new.account_id for update;
  if _eco is not null then return new; end if;

  _kind := coalesce(new.entry_kind, 'general');
  -- Settling obligations and platform corrections are never blocked.
  if _kind in ('loan_repayment','credit_revocation','earnings_reconciliation') then
    return new;
  end if;

  _exposure := public.admin_secured_loan_exposure(_owner);
  if _exposure <= 0 then return new; end if;

  -- Inside the admin's own shop(s): purchases and allocations to that shop's
  -- members stay within the protected scope and are allowed.
  if new.ecosystem_id is not null
     and public.admin_security_covers_shop(_owner, new.ecosystem_id)
     and _kind in ('purchase','retail_hold','retail_cod_hold','general','shop_transfer_out') then
    return new;
  end if;

  _free_after := round(_bal - new.amount - coalesce(_restricted, 0), 2);
  if _free_after < _exposure then
    raise exception 'Your coins are reserved to secure % coins still owed on member loans in your shop. Only % coins may be used outside your shop until those loans are settled.',
      round(_exposure, 2), public.admin_unsecured_balance(_owner)
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists aab_credit_ledger_admin_loan_security on public.credit_ledger;
create trigger aab_credit_ledger_admin_loan_security
  before insert on public.credit_ledger
  for each row execute function public.guard_admin_loan_security();