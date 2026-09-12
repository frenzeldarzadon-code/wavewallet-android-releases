
-- Release an approved/automatic loan into the borrower's global wallet.
create or replace function public.release_coin_loan(_loan_id uuid)
returns public.coin_loans language plpgsql security definer set search_path = public as $$
declare _loan public.coin_loans; _acct uuid; _ledger uuid; _net numeric(14,2);
begin
  select * into _loan from public.coin_loans where id = _loan_id for update;
  if _loan.id is null then raise exception 'Loan not found'; end if;
  if _loan.status <> 'pending' then raise exception 'This loan was already %', _loan.status; end if;
  if _loan.released_at is not null then raise exception 'This loan was already released'; end if;

  _net := round(_loan.principal - _loan.first_month_interest, 2);
  if _net <= 0 then raise exception 'The interest would consume the whole loan'; end if;

  _acct := public.ensure_global_wallet(_loan.user_id);
  perform 1 from public.credit_accounts where id = _acct for update;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    reason, entry_kind, actor_id)
  values (_acct, _loan.user_id, null, 'credit', _net,
          'Coin loan released', 'loan_release', _loan.user_id)
  returning id into _ledger;

  update public.credit_accounts
     set restricted_balance = round(restricted_balance + _net, 2), updated_at = now()
   where id = _acct;

  update public.coin_loans
     set status = 'active', released_amount = _net, total_owed = principal,
         outstanding = principal, released_at = now()
   where id = _loan.id
  returning * into _loan;

  insert into public.coin_loan_entries (loan_id, kind, amount, outstanding_after, ledger_id, note)
  values (_loan.id, 'release', _net, _loan.outstanding, _ledger, 'Coins released to wallet');
  if _loan.first_month_interest > 0 then
    insert into public.coin_loan_entries (loan_id, kind, amount, outstanding_after, period_index, note)
    values (_loan.id, 'upfront_interest', _loan.first_month_interest, _loan.outstanding, 0,
            'First month interest deducted on release');
  end if;

  return _loan;
end $$;

revoke all on function public.release_coin_loan(uuid) from public, anon, authenticated;
grant execute on function public.release_coin_loan(uuid) to service_role;

-- Request a loan.
create or replace function public.request_coin_loan(_amount numeric)
returns public.coin_loans language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _s record; _limit numeric(14,2);
        _free numeric(14,2); _interest numeric(14,2); _loan public.coin_loans; _auto boolean;
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();
  select * into _s from public.platform_settings where id = 1;
  if not coalesce(_s.loans_enabled, false) then raise exception 'Coin loans are not available right now'; end if;
  if not public.has_loan_position(_me) then
    raise exception 'Coin loans are only for members who are an admin, reseller or subreseller of a shop';
  end if;
  if exists (select 1 from public.coin_loans where user_id = _me and status in ('pending','active')) then
    raise exception 'You already have a loan in progress. Repay it before requesting another one.';
  end if;
  _amount := round(coalesce(_amount, 0), 2);
  if _amount <= 0 then raise exception 'Enter a loan amount greater than zero'; end if;

  perform public.ensure_global_wallet(_me);
  _free := public.free_coin_balance(_me);
  _limit := public.coin_loan_auto_limit(_me);
  _auto := _amount <= _limit;
  _interest := case when coalesce(_s.loan_first_month_upfront, true)
                    then round(_amount * coalesce(_s.loan_monthly_interest_percent, 0) / 100, 2)
                    else 0 end;

  insert into public.coin_loans (user_id, principal, interest_percent, auto_limit_snapshot,
                                 base_snapshot, multiplier_snapshot, free_balance_snapshot,
                                 first_month_interest, total_owed, outstanding,
                                 status, approval_mode)
  values (_me, _amount, coalesce(_s.loan_monthly_interest_percent, 0), _limit,
          _s.loan_auto_base_credits, _s.loan_free_balance_multiplier, _free,
          _interest, _amount, _amount, 'pending',
          case when _auto then 'automatic' else 'manual' end)
  returning * into _loan;

  if _auto then
    _loan := public.release_coin_loan(_loan.id);
  end if;
  return _loan;
end $$;

revoke all on function public.request_coin_loan(numeric) from public, anon;
grant execute on function public.request_coin_loan(numeric) to authenticated, service_role;

-- Platform owner decision on a loan above the automatic limit.
create or replace function public.review_coin_loan(_loan_id uuid, _approve boolean, _note text default null)
returns public.coin_loans language plpgsql security definer set search_path = public as $$
declare _loan public.coin_loans;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Only the platform owner may decide loans'; end if;
  select * into _loan from public.coin_loans where id = _loan_id for update;
  if _loan.id is null then raise exception 'Loan not found'; end if;
  if _loan.status <> 'pending' then raise exception 'This loan was already %', _loan.status; end if;

  update public.coin_loans
     set decided_by = auth.uid(), decided_at = now(), decision_note = _note,
         status = case when _approve then status else 'rejected' end
   where id = _loan.id returning * into _loan;

  if _approve then _loan := public.release_coin_loan(_loan.id); end if;
  return _loan;
end $$;

revoke all on function public.review_coin_loan(uuid, boolean, text) from public, anon;
grant execute on function public.review_coin_loan(uuid, boolean, text) to authenticated, service_role;

-- Cancel an own request that has not been released.
create or replace function public.cancel_coin_loan(_loan_id uuid)
returns public.coin_loans language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _loan public.coin_loans;
begin
  select * into _loan from public.coin_loans where id = _loan_id for update;
  if _loan.id is null then raise exception 'Loan not found'; end if;
  if _loan.user_id <> _me and not public.is_super_admin(auth.uid()) then
    raise exception 'Not allowed'; end if;
  if _loan.status <> 'pending' then raise exception 'Only a request still waiting can be cancelled'; end if;
  update public.coin_loans set status = 'cancelled', decided_at = now() where id = _loan.id
  returning * into _loan;
  return _loan;
end $$;

revoke all on function public.cancel_coin_loan(uuid) from public, anon;
grant execute on function public.cancel_coin_loan(uuid) to authenticated, service_role;

-- Early / manual repayment by the borrower.
create or replace function public.repay_coin_loan(_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _paid numeric(14,2);
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();
  if round(coalesce(_amount,0),2) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  _paid := public.apply_loan_repayment(_me, round(_amount, 2), 'Loan repayment');
  if _paid <= 0 then raise exception 'Nothing to repay, or your wallet balance is too low'; end if;
  return _paid;
end $$;

revoke all on function public.repay_coin_loan(numeric) from public, anon;
grant execute on function public.repay_coin_loan(numeric) to authenticated, service_role;

-- Idempotent monthly interest accrual for loans still unpaid after a month.
create or replace function public.accrue_coin_loan_interest()
returns integer language plpgsql security definer set search_path = public as $$
declare _loan public.coin_loans; _periods integer; _p integer; _add numeric(14,2); _count integer := 0;
begin
  for _loan in select * from public.coin_loans where status = 'active' and released_at is not null
                for update loop
    _periods := floor(extract(epoch from (now() - _loan.released_at)) / (30 * 86400))::int;
    for _p in 1.._greatest(_periods, 0) loop
      exit when _periods < 1;
      if exists (select 1 from public.coin_loan_entries
                  where loan_id = _loan.id and kind = 'interest' and period_index = _p) then
        continue;
      end if;
      select outstanding into _loan.outstanding from public.coin_loans where id = _loan.id;
      _add := round(_loan.outstanding * _loan.interest_percent / 100, 2);
      if _add <= 0 then continue; end if;
      update public.coin_loans
         set outstanding = round(outstanding + _add, 2),
             total_owed = round(total_owed + _add, 2),
             accrued_interest = round(accrued_interest + _add, 2)
       where id = _loan.id;
      insert into public.coin_loan_entries (loan_id, kind, amount, outstanding_after, period_index, note)
      values (_loan.id, 'interest', _add, round(_loan.outstanding + _add, 2), _p,
              'Monthly interest on the unpaid balance');
      _count := _count + 1;
    end loop;
  end loop;
  return _count;
end $$;

revoke all on function public.accrue_coin_loan_interest() from public, anon, authenticated;
grant execute on function public.accrue_coin_loan_interest() to service_role;

-- Reads ---------------------------------------------------------------------
create or replace function public.my_coin_loan_summary()
returns table(loan_id uuid, status text, approval_mode text, principal numeric,
              released_amount numeric, outstanding numeric, total_owed numeric,
              accrued_interest numeric, interest_percent numeric, first_month_interest numeric,
              auto_limit numeric, free_balance numeric, restricted_balance numeric,
              balance numeric, has_position boolean, loans_enabled boolean,
              requested_at timestamptz, released_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare _me uuid := public.effective_uid();
begin
  if _me is null then raise exception 'Not signed in'; end if;
  return query
  select l.id, l.status, l.approval_mode, l.principal, l.released_amount, l.outstanding,
         l.total_owed, l.accrued_interest, l.interest_percent, l.first_month_interest,
         public.coin_loan_auto_limit(_me), public.free_coin_balance(_me),
         coalesce(ca.restricted_balance, 0), coalesce(ca.balance, 0),
         public.has_loan_position(_me), coalesce(s.loans_enabled, false),
         l.created_at, l.released_at
    from (select 1) x
    left join public.coin_loans l
      on l.user_id = _me and l.status in ('pending','active')
    left join public.credit_accounts ca on ca.user_id = _me and ca.ecosystem_id is null
    left join public.platform_settings s on s.id = 1;
end $$;

revoke all on function public.my_coin_loan_summary() from public, anon;
grant execute on function public.my_coin_loan_summary() to authenticated, service_role;

create or replace function public.my_coin_loan_history()
returns setof public.coin_loan_entries
language sql stable security definer set search_path = public as $$
  select e.* from public.coin_loan_entries e
    join public.coin_loans l on l.id = e.loan_id
   where l.user_id = public.effective_uid()
   order by e.created_at desc limit 200;
$$;

revoke all on function public.my_coin_loan_history() from public, anon;
grant execute on function public.my_coin_loan_history() to authenticated, service_role;

create or replace function public.admin_coin_loans(_status text default null)
returns table(id uuid, user_id uuid, full_name text, handle text, principal numeric,
              interest_percent numeric, first_month_interest numeric, auto_limit_snapshot numeric,
              free_balance_snapshot numeric, outstanding numeric, released_amount numeric,
              status text, approval_mode text, decided_by uuid, decided_at timestamptz,
              decision_note text, released_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  return query
  select l.id, l.user_id, p.full_name, p.handle, l.principal, l.interest_percent,
         l.first_month_interest, l.auto_limit_snapshot, l.free_balance_snapshot,
         l.outstanding, l.released_amount, l.status, l.approval_mode, l.decided_by,
         l.decided_at, l.decision_note, l.released_at, l.created_at
    from public.coin_loans l
    left join public.profiles p on p.id = l.user_id
   where _status is null or l.status = _status
   order by case when l.status = 'pending' then 0 else 1 end, l.created_at desc
   limit 300;
end $$;

revoke all on function public.admin_coin_loans(text) from public, anon;
grant execute on function public.admin_coin_loans(text) to authenticated, service_role;

-- Super Admin loan configuration -------------------------------------------
create or replace function public.set_coin_loan_settings(
  _enabled boolean, _base numeric, _multiplier numeric,
  _monthly_interest numeric, _first_month_upfront boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Only the platform owner may change loan settings'; end if;
  if _base < 0 or _multiplier < 0 or _monthly_interest < 0 or _monthly_interest > 100 then
    raise exception 'Loan settings are out of range';
  end if;
  update public.platform_settings
     set loans_enabled = _enabled,
         loan_auto_base_credits = round(_base, 2),
         loan_free_balance_multiplier = round(_multiplier, 2),
         loan_monthly_interest_percent = round(_monthly_interest, 2),
         loan_first_month_upfront = _first_month_upfront,
         updated_by = auth.uid(), updated_at = now()
   where id = 1;
end $$;

revoke all on function public.set_coin_loan_settings(boolean, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.set_coin_loan_settings(boolean, numeric, numeric, numeric, boolean) to authenticated, service_role;
