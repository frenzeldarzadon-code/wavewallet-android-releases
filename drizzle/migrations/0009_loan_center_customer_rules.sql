-- Loan Center: customer borrowing (manual approval only), Universe-wide use of
-- customer loan coins, and Super Admin manual loan creation.

alter table public.coin_loans
  add column if not exists borrower_role text,
  add column if not exists origin text not null default 'member_request',
  add column if not exists created_by uuid,
  add column if not exists reference_note text,
  add column if not exists client_token text,
  add column if not exists universe_spend boolean not null default false;

create unique index if not exists coin_loans_client_token_key
  on public.coin_loans (client_token) where client_token is not null;

-- Informational role snapshot helper: highest shop position, else 'customer'.
create or replace function public.loan_borrower_role(_user_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select m.role::text
      from public.ecosystem_memberships m
     where m.user_id = _user_id
       and m.membership_state = 'active'
       and coalesce(m.status::text, 'active') = 'active'
       and m.role::text in ('admin','reseller','subreseller')
     order by case m.role::text when 'admin' then 1 when 'reseller' then 2 else 3 end
     limit 1), 'customer');
$$;

-- Backfill the informational role only. `universe_spend` deliberately stays
-- false for every existing loan so no current restriction is loosened.
update public.coin_loans
   set borrower_role = public.loan_borrower_role(user_id)
 where borrower_role is null;

-- Restricted-coin spending scope. Position holders keep the existing
-- own-shop-only rule; loans flagged universe_spend (customer loans) may buy
-- from any live Universe shop. Transfers, gifts and cash out remain blocked
-- for every restricted coin because the ledger guard only ever consults this
-- function for purchase entry kinds.
create or replace function public.loan_spend_allowed_in(_user_id uuid, _ecosystem_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select _ecosystem_id is not null and (
    exists (
      select 1
        from public.ecosystem_memberships m
        join public.ecosystems e on e.id = m.ecosystem_id
       where m.user_id = _user_id
         and m.ecosystem_id = _ecosystem_id
         and m.membership_state = 'active'
         and coalesce(m.status::text, 'active') = 'active'
         and m.role::text in ('admin','reseller','subreseller')
         and coalesce(e.operations_frozen, false) = false
         and e.archived_at is null
    )
    or exists (
      select 1
        from public.coin_loans l
        join public.ecosystems e on e.id = _ecosystem_id
       where l.user_id = _user_id
         and l.status = 'active'
         and l.universe_spend
         and coalesce(e.operations_frozen, false) = false
         and e.archived_at is null
    )
  );
$$;

-- Requesting a loan. Customers may now request, but NEVER automatically:
-- automatic release requires a shop position AND an amount within the limit.
create or replace function public.request_coin_loan(_amount numeric)
returns public.coin_loans language plpgsql security definer set search_path to 'public' as $$
declare _me uuid := public.effective_uid(); _s record; _limit numeric(14,2);
        _free numeric(14,2); _interest numeric(14,2); _loan public.coin_loans;
        _auto boolean; _position boolean; _role text;
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();
  select * into _s from public.platform_settings where id = 1;
  if not coalesce(_s.loans_enabled, false) then raise exception 'Coin loans are not available right now'; end if;
  if exists (select 1 from public.coin_loans where user_id = _me and status in ('pending','active')) then
    raise exception 'You already have a loan in progress. Repay it before requesting another one.';
  end if;
  _amount := round(coalesce(_amount, 0), 2);
  if _amount <= 0 then raise exception 'Enter a loan amount greater than zero'; end if;

  perform public.ensure_global_wallet(_me);
  _free := public.free_coin_balance(_me);
  _limit := public.coin_loan_auto_limit(_me);
  _position := public.has_loan_position(_me);
  _role := public.loan_borrower_role(_me);
  -- Customers are never auto-approved, whatever the amount.
  _auto := _position and _amount <= _limit;
  _interest := case when coalesce(_s.loan_first_month_upfront, true)
                    then round(_amount * coalesce(_s.loan_monthly_interest_percent, 0) / 100, 2)
                    else 0 end;

  begin
    insert into public.coin_loans (user_id, principal, interest_percent, auto_limit_snapshot,
                                   base_snapshot, multiplier_snapshot, free_balance_snapshot,
                                   first_month_interest, total_owed, outstanding,
                                   status, approval_mode, borrower_role, universe_spend,
                                   origin)
    values (_me, _amount, coalesce(_s.loan_monthly_interest_percent, 0),
            case when _position then _limit else 0 end,
            _s.loan_auto_base_credits, _s.loan_free_balance_multiplier, _free,
            _interest, _amount, _amount, 'pending',
            case when _auto then 'automatic' else 'manual' end,
            _role, not _position, 'member_request')
    returning * into _loan;
  exception when unique_violation then
    raise exception 'You already have a loan in progress. Repay it before requesting another one.';
  end;

  if _auto then
    _loan := public.release_coin_loan(_loan.id);
  end if;
  return _loan;
end $$;

-- Deciding a pending request. Customers no longer need a shop position.
create or replace function public.review_coin_loan(_loan_id uuid, _approve boolean, _note text default null)
returns public.coin_loans language plpgsql security definer set search_path to 'public' as $$
declare _loan public.coin_loans; _s record;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Only the platform owner may decide loans'; end if;
  select * into _loan from public.coin_loans where id = _loan_id for update;
  if _loan.id is null then raise exception 'Loan not found'; end if;
  if _loan.status <> 'pending' then raise exception 'This loan was already %', _loan.status; end if;

  if _approve then
    select * into _s from public.platform_settings where id = 1;
    if not coalesce(_s.loans_enabled, false) then
      raise exception 'Coin loans are switched off. Turn them back on before approving.';
    end if;
    if not _loan.universe_spend and not public.has_loan_position(_loan.user_id) then
      raise exception 'This member is no longer an admin, reseller or subreseller of any shop';
    end if;
    if exists (select 1 from public.coin_loans
                where user_id = _loan.user_id and status = 'active' and id <> _loan.id) then
      raise exception 'This member already has an active loan';
    end if;
    update public.coin_loans
       set auto_limit_snapshot = case when public.has_loan_position(_loan.user_id)
                                      then public.coin_loan_auto_limit(_loan.user_id) else 0 end,
           free_balance_snapshot = public.free_coin_balance(_loan.user_id)
     where id = _loan.id;
  end if;

  update public.coin_loans
     set decided_by = auth.uid(), decided_at = now(), decision_note = _note,
         status = case when _approve then status else 'rejected' end
   where id = _loan.id returning * into _loan;

  if _approve then _loan := public.release_coin_loan(_loan.id); end if;
  return _loan;
end $$;

-- Super Admin manual loan: creates a real, released loan record. Idempotent on
-- _client_token so a double submit can never create two loans.
create or replace function public.superadmin_create_manual_loan(
  _user_id uuid, _amount numeric, _note text default null, _client_token text default null)
returns public.coin_loans language plpgsql security definer set search_path to 'public' as $$
declare _loan public.coin_loans; _s record; _interest numeric(14,2);
        _position boolean; _token text := nullif(btrim(coalesce(_client_token, '')), '');
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner may create a manual loan';
  end if;
  if _user_id is null then raise exception 'Choose a member'; end if;

  if _token is not null then
    select * into _loan from public.coin_loans where client_token = _token;
    if _loan.id is not null then return _loan; end if;
  end if;

  _amount := round(coalesce(_amount, 0), 2);
  if _amount <= 0 then raise exception 'Enter a loan amount greater than zero'; end if;
  if exists (select 1 from public.coin_loans where user_id = _user_id and status in ('pending','active')) then
    raise exception 'This member already has a loan in progress. It must be repaid first.';
  end if;

  select * into _s from public.platform_settings where id = 1;
  _position := public.has_loan_position(_user_id);
  _interest := case when coalesce(_s.loan_first_month_upfront, true)
                    then round(_amount * coalesce(_s.loan_monthly_interest_percent, 0) / 100, 2)
                    else 0 end;

  perform public.ensure_global_wallet(_user_id);

  begin
    insert into public.coin_loans (user_id, principal, interest_percent, auto_limit_snapshot,
                                   base_snapshot, multiplier_snapshot, free_balance_snapshot,
                                   first_month_interest, total_owed, outstanding,
                                   status, approval_mode, borrower_role, universe_spend,
                                   origin, created_by, reference_note, client_token,
                                   decided_by, decided_at, decision_note)
    values (_user_id, _amount, coalesce(_s.loan_monthly_interest_percent, 0),
            case when _position then public.coin_loan_auto_limit(_user_id) else 0 end,
            _s.loan_auto_base_credits, _s.loan_free_balance_multiplier,
            public.free_coin_balance(_user_id),
            _interest, _amount, _amount, 'pending', 'manual',
            public.loan_borrower_role(_user_id), not _position,
            'super_admin_manual', auth.uid(), _note, _token,
            auth.uid(), now(), _note)
    returning * into _loan;
  exception when unique_violation then
    select * into _loan from public.coin_loans
     where (_token is not null and client_token = _token)
        or (user_id = _user_id and status in ('pending','active'))
     limit 1;
    if _loan.id is not null then return _loan; end if;
    raise;
  end;

  return public.release_coin_loan(_loan.id);
end $$;

-- Member-facing summary: one authoritative source for app and web.
drop function if exists public.my_coin_loan_summary();
create function public.my_coin_loan_summary()
returns table(loan_id uuid, status text, approval_mode text, principal numeric,
              released_amount numeric, outstanding numeric, total_owed numeric,
              accrued_interest numeric, interest_percent numeric, first_month_interest numeric,
              auto_limit numeric, free_balance numeric, restricted_balance numeric,
              balance numeric, has_position boolean, can_auto boolean, universe_spend boolean,
              borrower_role text, loans_enabled boolean,
              requested_at timestamp with time zone, released_at timestamp with time zone)
language plpgsql stable security definer set search_path to 'public' as $$
declare _me uuid := public.effective_uid();
begin
  if _me is null then raise exception 'Not signed in'; end if;
  return query
  select l.id, l.status, l.approval_mode, l.principal, l.released_amount, l.outstanding,
         l.total_owed, l.accrued_interest, l.interest_percent, l.first_month_interest,
         case when public.has_loan_position(_me) then public.coin_loan_auto_limit(_me) else 0 end,
         public.free_coin_balance(_me),
         coalesce(ca.restricted_balance, 0), coalesce(ca.balance, 0),
         public.has_loan_position(_me), public.has_loan_position(_me),
         coalesce(l.universe_spend, not public.has_loan_position(_me)),
         coalesce(l.borrower_role, public.loan_borrower_role(_me)),
         coalesce(s.loans_enabled, false),
         l.created_at, l.released_at
    from (select 1) x
    left join public.coin_loans l
      on l.user_id = _me and l.status in ('pending','active')
    left join public.credit_accounts ca on ca.user_id = _me and ca.ecosystem_id is null
    left join public.platform_settings s on s.id = 1;
end $$;

-- Every loan this member has ever had (Loan Center history).
create or replace function public.my_coin_loans()
returns setof public.coin_loans language sql stable security definer set search_path to 'public' as $$
  select * from public.coin_loans
   where user_id = public.effective_uid()
   order by created_at desc limit 100;
$$;

-- Super Admin listing now carries origin and audit information.
drop function if exists public.super_coin_loans(text, text);
create function public.super_coin_loans(_status text default null, _search text default null)
returns table(id uuid, user_id uuid, full_name text, handle text, role text, principal numeric,
              released_amount numeric, first_month_interest numeric, interest_percent numeric,
              accrued_interest numeric, outstanding numeric, total_owed numeric, repaid numeric,
              auto_limit_snapshot numeric, free_balance_snapshot numeric, status text,
              approval_mode text, origin text, created_by uuid, created_by_name text,
              reference_note text, borrower_role text, universe_spend boolean,
              decided_by uuid, decided_at timestamp with time zone, decision_note text,
              released_at timestamp with time zone, settled_at timestamp with time zone,
              created_at timestamp with time zone)
language plpgsql stable security definer set search_path to 'public' as $$
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
         coalesce(l.origin, 'member_request'), l.created_by, c.full_name,
         l.reference_note, l.borrower_role, coalesce(l.universe_spend, false),
         l.decided_by, l.decided_at, l.decision_note, l.released_at, l.settled_at, l.created_at
    from public.coin_loans l
    left join public.profiles p on p.id = l.user_id
    left join public.profiles c on c.id = l.created_by
   where (_status is null or l.status = _status)
     and (_q is null
          or coalesce(p.full_name, '') ilike '%' || _q || '%'
          or coalesce(p.handle, '') ilike '%' || _q || '%'
          or coalesce(l.reference_note, '') ilike '%' || _q || '%'
          or l.id::text ilike _q || '%')
   order by case when l.status = 'pending' then 0 when l.status = 'active' then 1 else 2 end,
            l.created_at desc
   limit 500;
end $$;

grant execute on function public.loan_borrower_role(uuid) to authenticated;
grant execute on function public.my_coin_loan_summary() to authenticated;
grant execute on function public.my_coin_loans() to authenticated;
grant execute on function public.super_coin_loans(text, text) to authenticated;
grant execute on function public.superadmin_create_manual_loan(uuid, numeric, text, text) to authenticated;
grant execute on function public.request_coin_loan(numeric) to authenticated;
grant execute on function public.review_coin_loan(uuid, boolean, text) to authenticated;
grant execute on function public.loan_spend_allowed_in(uuid, uuid) to authenticated;