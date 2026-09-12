create or replace function public.loan_spend_allowed_in(_user_id uuid, _ecosystem_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select _ecosystem_id is not null and exists (
    select 1
      from public.ecosystem_memberships m
      join public.ecosystems e on e.id = m.ecosystem_id
     where m.user_id = _user_id
       and m.ecosystem_id = _ecosystem_id
       and m.membership_state = 'active'
       and coalesce(m.status::text, 'active') = 'active'
       and m.role in ('admin','reseller','subreseller')
       and coalesce(e.operations_frozen, false) = false
       and e.archived_at is null
  );
$$;

create or replace function public.wallet_integrity_check()
returns table(kind text, account_id uuid, user_id uuid, ecosystem_id uuid, member_name text, balance numeric, ledger_sum numeric, difference numeric, oldest_entry timestamp with time zone, purge_explained boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare _last_purge timestamptz;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can run the wallet integrity check';
  end if;
  select max(cutoff) into _last_purge from public.retention_runs where dry_run = false and status = 'success';
  return query
  with c as (
    select a.id, a.user_id, a.ecosystem_id, a.balance,
           coalesce(sum(case when l.direction = 'credit' then l.amount else -l.amount end), 0) as summed,
           min(l.created_at) as oldest
      from public.credit_accounts a
      left join public.credit_ledger l on l.account_id = a.id
     group by a.id, a.user_id, a.ecosystem_id, a.balance
  ), p as (
    select a.id, a.user_id, a.ecosystem_id, a.balance::numeric as balance,
           coalesce(sum(case when l.entry_type in ('hold','release') then 0
                             when l.direction = 'credit' then l.amount else -l.amount end), 0)::numeric as summed,
           min(l.created_at) as oldest
      from public.points_accounts a
      left join public.points_ledger l on l.account_id = a.id
     group by a.id, a.user_id, a.ecosystem_id, a.balance
  ), r as (
    select a.id, a.user_id, a.ecosystem_id, a.balance, a.restricted_balance,
           coalesce((select sum(cl.outstanding) from public.coin_loans cl
                      where cl.user_id = a.user_id and cl.status = 'active'), 0) as outstanding
      from public.credit_accounts a
     where a.ecosystem_id is null
  )
  select 'credits'::text, c.id, c.user_id, c.ecosystem_id, pr.full_name, c.balance, c.summed,
         c.balance - c.summed, c.oldest,
         (_last_purge is not null and (c.oldest is null or c.oldest >= _last_purge))
    from c join public.profiles pr on pr.id = c.user_id
   where c.balance <> c.summed
  union all
  select 'points'::text, p.id, p.user_id, p.ecosystem_id, pr.full_name, p.balance, p.summed,
         p.balance - p.summed, p.oldest,
         (_last_purge is not null and (p.oldest is null or p.oldest >= _last_purge))
    from p join public.profiles pr on pr.id = p.user_id
   where p.balance <> p.summed
  union all
  select 'loaned coins'::text, r.id, r.user_id, r.ecosystem_id, pr.full_name,
         r.balance, r.outstanding, r.restricted_balance - least(r.outstanding, r.balance), null::timestamptz, false
    from r join public.profiles pr on pr.id = r.user_id
   where r.restricted_balance > r.balance
      or r.restricted_balance > r.outstanding;
end;
$$;