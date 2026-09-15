-- Read-only Super Admin loan monitoring.
-- Every function is STABLE (no writes) and refuses non-super-admins.

CREATE OR REPLACE FUNCTION public.super_coin_loan_stats()
RETURNS TABLE(
  total_outstanding numeric, total_principal numeric, total_released numeric,
  total_repaid numeric, total_interest numeric,
  active_count integer, settled_count integer, pending_count integer, borrower_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  return query
  select
    coalesce(sum(l.outstanding) filter (where l.status in ('active','pending')), 0)::numeric,
    coalesce(sum(l.principal) filter (where l.status in ('active','settled')), 0)::numeric,
    coalesce(sum(l.released_amount) filter (where l.status in ('active','settled')), 0)::numeric,
    coalesce((select sum(e.amount) from public.coin_loan_entries e where e.kind = 'repayment'), 0)::numeric,
    coalesce((select sum(e.amount) from public.coin_loan_entries e where e.kind in ('interest','upfront_interest')), 0)::numeric,
    count(*) filter (where l.status = 'active')::int,
    count(*) filter (where l.status = 'settled')::int,
    count(*) filter (where l.status = 'pending')::int,
    count(distinct l.user_id) filter (where l.status in ('active','pending'))::int
  from public.coin_loans l;
end $$;

CREATE OR REPLACE FUNCTION public.super_coin_loans(_status text DEFAULT NULL, _search text DEFAULT NULL)
RETURNS TABLE(
  id uuid, user_id uuid, full_name text, handle text, role text,
  principal numeric, released_amount numeric, first_month_interest numeric,
  interest_percent numeric, accrued_interest numeric, outstanding numeric,
  total_owed numeric, repaid numeric, auto_limit_snapshot numeric,
  free_balance_snapshot numeric, status text, approval_mode text,
  decided_by uuid, decided_at timestamptz, decision_note text,
  released_at timestamptz, settled_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _q text := nullif(btrim(coalesce(_search, '')), '');
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  return query
  select l.id, l.user_id, p.full_name, p.handle, public.top_role(l.user_id)::text,
         l.principal, l.released_amount, l.first_month_interest, l.interest_percent,
         l.accrued_interest, l.outstanding, l.total_owed,
         coalesce((select sum(e.amount) from public.coin_loan_entries e
                    where e.loan_id = l.id and e.kind = 'repayment'), 0)::numeric,
         l.auto_limit_snapshot, l.free_balance_snapshot, l.status, l.approval_mode,
         l.decided_by, l.decided_at, l.decision_note, l.released_at, l.settled_at, l.created_at
    from public.coin_loans l
    left join public.profiles p on p.id = l.user_id
   where (_status is null or l.status = _status)
     and (_q is null
          or coalesce(p.full_name, '') ilike '%' || _q || '%'
          or coalesce(p.handle, '') ilike '%' || _q || '%'
          or l.id::text ilike _q || '%')
   order by case when l.status = 'pending' then 0 when l.status = 'active' then 1 else 2 end,
            l.created_at desc
   limit 500;
end $$;

CREATE OR REPLACE FUNCTION public.super_coin_loan_entries(_loan_id uuid)
RETURNS TABLE(
  id uuid, loan_id uuid, kind text, amount numeric, outstanding_after numeric,
  period_index integer, note text, ledger_id uuid, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  return query
  select e.id, e.loan_id, e.kind, e.amount, e.outstanding_after, e.period_index,
         e.note, e.ledger_id, e.created_at
    from public.coin_loan_entries e
   where e.loan_id = _loan_id
   order by e.created_at asc, e.id asc;
end $$;

CREATE OR REPLACE FUNCTION public.super_coin_loan_transactions(
  _kind text DEFAULT NULL, _status text DEFAULT NULL, _search text DEFAULT NULL,
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _limit integer DEFAULT 300
)
RETURNS TABLE(
  id uuid, loan_id uuid, user_id uuid, full_name text, handle text, role text,
  loan_status text, kind text, amount numeric, outstanding_after numeric,
  period_index integer, note text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _q text := nullif(btrim(coalesce(_search, '')), '');
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  return query
  select e.id, e.loan_id, l.user_id, p.full_name, p.handle, public.top_role(l.user_id)::text,
         l.status, e.kind, e.amount, e.outstanding_after, e.period_index, e.note, e.created_at
    from public.coin_loan_entries e
    join public.coin_loans l on l.id = e.loan_id
    left join public.profiles p on p.id = l.user_id
   where (_kind is null or e.kind = _kind)
     and (_status is null or l.status = _status)
     and (_from is null or e.created_at >= _from)
     and (_to is null or e.created_at <= _to)
     and (_q is null
          or coalesce(p.full_name, '') ilike '%' || _q || '%'
          or coalesce(p.handle, '') ilike '%' || _q || '%'
          or l.id::text ilike _q || '%')
   order by e.created_at desc
   limit greatest(1, least(coalesce(_limit, 300), 1000));
end $$;

REVOKE ALL ON FUNCTION public.super_coin_loan_stats() FROM public, anon;
REVOKE ALL ON FUNCTION public.super_coin_loans(text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.super_coin_loan_entries(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.super_coin_loan_transactions(text, text, text, timestamptz, timestamptz, integer) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.super_coin_loan_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_coin_loans(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_coin_loan_entries(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_coin_loan_transactions(text, text, text, timestamptz, timestamptz, integer) TO authenticated, service_role;