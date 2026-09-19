-- Universe Loan read models for the Loan Pool and loan screens.

create or replace function public.my_universe_loans()
returns table (
  id uuid, amount numeric, term_months integer, status text,
  interest_percent numeric, platform_fee_percent numeric, platform_fee numeric,
  owner_share_percent numeric, contributor_share_percent numeric,
  funded_amount numeric, released_amount numeric,
  principal_outstanding numeric, principal_paid numeric,
  interest_accrued numeric, interest_paid numeric, interest_refunded numeric,
  monthly_payment numeric, id_document_path text,
  released_at timestamptz, settled_at timestamptz, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select l.id, l.amount, l.term_months, l.status,
         l.interest_percent::numeric, l.platform_fee_percent::numeric, l.platform_fee,
         l.owner_share_percent::numeric, l.contributor_share_percent::numeric,
         l.funded_amount, l.released_amount,
         l.principal_outstanding, l.principal_paid,
         l.interest_accrued, l.interest_paid, l.interest_refunded,
         public.universe_loan_monthly_payment(l.amount, l.interest_percent, l.term_months),
         l.id_document_path, l.released_at, l.settled_at, l.created_at
    from public.universe_loans l
   where l.borrower_id = public.effective_uid()
   order by l.created_at desc;
$$;

create or replace function public.universe_loan_schedule_rows(_loan_id uuid)
returns table (period_index integer, due_date date, principal_due numeric,
               interest_due numeric, total_due numeric)
language sql stable security definer set search_path = public as $$
  select s.period_index, s.due_date, s.principal_due, s.interest_due, s.total_due
    from public.universe_loan_schedule s
    join public.universe_loans l on l.id = s.loan_id
   where s.loan_id = _loan_id
     and (l.borrower_id = public.effective_uid()
          or public.is_super_admin(public.effective_uid())
          or exists (select 1 from public.universe_loan_fundings f
                      where f.loan_id = l.id and f.funder_id = public.effective_uid()))
   order by s.period_index;
$$;

create or replace function public.universe_loan_payment_rows(_loan_id uuid)
returns table (id uuid, kind text, amount numeric, principal_part numeric,
               interest_part numeric, principal_after numeric, note text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.kind, p.amount, p.principal_part, p.interest_part,
         p.principal_after, p.note, p.created_at
    from public.universe_loan_payments p
    join public.universe_loans l on l.id = p.loan_id
   where p.loan_id = _loan_id
     and (l.borrower_id = public.effective_uid()
          or public.is_super_admin(public.effective_uid())
          or exists (select 1 from public.universe_loan_fundings f
                      where f.loan_id = l.id and f.funder_id = public.effective_uid()))
   order by p.created_at;
$$;

create or replace function public.open_universe_loan_applications()
returns table (
  id uuid, borrower_name text, borrower_handle text,
  amount numeric, funded_amount numeric, remaining numeric,
  term_months integer, interest_percent numeric, status text,
  my_funded numeric, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select l.id,
         coalesce(p.full_name, 'Member'),
         p.handle,
         l.amount, l.funded_amount, round(l.amount - l.funded_amount, 2),
         l.term_months, l.interest_percent::numeric, l.status,
         coalesce((select f.amount from public.universe_loan_fundings f
                    where f.loan_id = l.id and f.funder_id = public.effective_uid()), 0),
         l.created_at
    from public.universe_loans l
    left join public.profiles p on p.id = l.borrower_id
   where l.status in ('pending_funding','partially_funded')
     and l.borrower_id <> public.effective_uid()
   order by l.created_at;
$$;

create or replace function public.my_funded_universe_loans()
returns table (
  loan_id uuid, borrower_name text, borrower_handle text,
  loan_amount numeric, term_months integer, status text,
  my_funded numeric, my_released_principal numeric, my_principal_repaid numeric,
  my_interest_earned numeric,
  principal_outstanding numeric, interest_paid numeric,
  released_at timestamptz, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select l.id, coalesce(p.full_name, 'Member'), p.handle,
         l.amount, l.term_months, l.status,
         f.amount, f.released_principal, f.principal_repaid, f.interest_earned,
         l.principal_outstanding, l.interest_paid,
         l.released_at, l.created_at
    from public.universe_loan_fundings f
    join public.universe_loans l on l.id = f.loan_id
    left join public.profiles p on p.id = l.borrower_id
   where f.funder_id = public.effective_uid()
   order by l.created_at desc;
$$;

create or replace function public.super_universe_loans(_status text default null)
returns table (
  id uuid, borrower_id uuid, borrower_name text, borrower_handle text,
  amount numeric, term_months integer, status text,
  interest_percent numeric, platform_fee_percent numeric, platform_fee numeric,
  owner_share_percent numeric, contributor_share_percent numeric,
  funded_amount numeric, released_amount numeric,
  principal_outstanding numeric, principal_paid numeric,
  interest_accrued numeric, interest_paid numeric, interest_refunded numeric,
  owner_interest numeric, funder_count integer,
  id_document_path text, released_at timestamptz, settled_at timestamptz, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select l.id, l.borrower_id, coalesce(p.full_name, 'Member'), p.handle,
         l.amount, l.term_months, l.status,
         l.interest_percent::numeric, l.platform_fee_percent::numeric, l.platform_fee,
         l.owner_share_percent::numeric, l.contributor_share_percent::numeric,
         l.funded_amount, l.released_amount,
         l.principal_outstanding, l.principal_paid,
         l.interest_accrued, l.interest_paid, l.interest_refunded,
         coalesce((select sum(e.amount) from public.universe_loan_earnings e
                    where e.loan_id = l.id and e.kind like 'owner_interest%'), 0),
         (select count(*)::int from public.universe_loan_fundings f where f.loan_id = l.id),
         l.id_document_path, l.released_at, l.settled_at, l.created_at
    from public.universe_loans l
    left join public.profiles p on p.id = l.borrower_id
   where public.is_super_admin(public.effective_uid())
     and (_status is null or l.status = _status)
   order by l.created_at desc;
$$;

create or replace function public.super_universe_loan_funders(_loan_id uuid)
returns table (funder_id uuid, funder_name text, funder_handle text,
               amount numeric, released_principal numeric,
               principal_repaid numeric, interest_earned numeric)
language sql stable security definer set search_path = public as $$
  select f.funder_id, coalesce(p.full_name, 'Member'), p.handle,
         f.amount, f.released_principal, f.principal_repaid, f.interest_earned
    from public.universe_loan_fundings f
    left join public.profiles p on p.id = f.funder_id
   where f.loan_id = _loan_id
     and (public.is_super_admin(public.effective_uid())
          or exists (select 1 from public.universe_loans l
                      where l.id = f.loan_id and l.borrower_id = public.effective_uid()))
   order by f.created_at;
$$;

create or replace function public.super_loan_pool_overview()
returns table (pool_total numeric, pool_available numeric, pool_allocated numeric,
               contributors integer, outstanding_principal numeric,
               owner_interest_collected numeric, platform_fees_collected numeric)
language sql stable security definer set search_path = public as $$
  select (select coalesce(sum(available + allocated),0) from public.loan_pool_accounts),
         (select coalesce(sum(available),0) from public.loan_pool_accounts),
         (select coalesce(sum(allocated),0) from public.loan_pool_accounts),
         (select count(*)::int from public.loan_pool_accounts where contributed > 0),
         (select coalesce(sum(principal_outstanding),0) from public.universe_loans where status = 'active'),
         (select coalesce(sum(amount),0) from public.universe_loan_earnings where kind like 'owner_interest%'),
         (select coalesce(sum(amount),0) from public.universe_loan_earnings where kind = 'platform_fee')
   where public.is_super_admin(public.effective_uid());
$$;