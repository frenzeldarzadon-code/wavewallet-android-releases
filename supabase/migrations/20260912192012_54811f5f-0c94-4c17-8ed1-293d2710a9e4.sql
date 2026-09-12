
-- 1. Purchase paths that may consume loaned coins ------------------------------
create or replace function public.guard_restricted_coins()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _bal numeric(14,2); _restricted numeric(14,2); _projected numeric(14,2);
        _owner uuid; _kind text; _may_consume boolean;
begin
  if new.direction <> 'debit' then return new; end if;

  select balance, restricted_balance, user_id
    into _bal, _restricted, _owner
    from public.credit_accounts where id = new.account_id for update;
  if _restricted is null or _restricted <= 0 then return new; end if;

  _projected := _bal - new.amount;
  if _projected >= _restricted then return new; end if;

  _kind := coalesce(new.entry_kind, 'general');
  _may_consume :=
       _kind in ('loan_repayment', 'credit_revocation')
    or (_kind in ('purchase', 'retail_hold', 'retail_cod_hold')
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
end $function$;

-- 2. Refunds of loan-funded spending stay restricted ---------------------------
create or replace function public.tg_restore_restricted_on_refund()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _bal numeric(14,2); _restricted numeric(14,2);
        _outstanding numeric(14,2); _target numeric(14,2);
begin
  if new.direction <> 'credit' then return null; end if;
  if coalesce(new.entry_kind, 'general') not in
     ('refund', 'retail_refund', 'retail_cod_release', 'transfer_reversal',
      'sale_commission_reversal') then
    return null;
  end if;

  select coalesce(sum(outstanding), 0) into _outstanding
    from public.coin_loans where user_id = new.user_id and status = 'active';
  if _outstanding <= 0 then return null; end if;

  select balance, restricted_balance into _bal, _restricted
    from public.credit_accounts
   where id = new.account_id and ecosystem_id is null for update;
  if _bal is null then return null; end if;

  _target := least(_bal, round(_restricted + new.amount, 2), _outstanding);
  if _target > _restricted then
    update public.credit_accounts
       set restricted_balance = _target, updated_at = now()
     where id = new.account_id;
  end if;
  return null;
end $function$;

drop trigger if exists zzy_credit_ledger_restrict_restore on public.credit_ledger;
create trigger zzy_credit_ledger_restrict_restore
after insert on public.credit_ledger
for each row execute function public.tg_restore_restricted_on_refund();

-- 3. Top-up paths that repay the loan first ------------------------------------
create or replace function public.tg_loan_repayment_on_topup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.direction = 'credit'
     and coalesce(new.entry_kind, 'general') in
         ('cash_in', 'admin_cash_in', 'credit_issue',
          'superadmin_credit_issuance', 'universe_consolidation_in')
     and exists (select 1 from public.credit_accounts ca
                  where ca.id = new.account_id and ca.ecosystem_id is null)
     and exists (select 1 from public.coin_loans l
                  where l.user_id = new.user_id and l.status = 'active') then
    perform public.apply_loan_repayment(new.user_id, new.amount,
      'Loan repayment from top up');
  end if;
  return null;
end $function$;

-- 4. Concurrency-safe monthly accrual ------------------------------------------
create or replace function public.accrue_coin_loan_interest()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _loan public.coin_loans; _periods integer; _p integer;
        _add numeric(14,2); _outstanding numeric(14,2); _count integer := 0;
begin
  for _loan in
    select * from public.coin_loans
     where status = 'active' and released_at is not null
     for update skip locked
  loop
    _periods := greatest(floor(extract(epoch from (now() - _loan.released_at)) / (30 * 86400))::int, 0);
    _p := 1;
    while _p <= _periods loop
      if not exists (select 1 from public.coin_loan_entries
                      where loan_id = _loan.id and kind = 'interest' and period_index = _p) then
        select outstanding into _outstanding from public.coin_loans where id = _loan.id;
        _add := round(_outstanding * _loan.interest_percent / 100, 2);
        if _add > 0 then
          begin
            insert into public.coin_loan_entries (loan_id, kind, amount, outstanding_after, period_index, note)
            values (_loan.id, 'interest', _add, round(_outstanding + _add, 2), _p,
                    'Monthly interest on the unpaid balance');
            update public.coin_loans
               set outstanding = round(outstanding + _add, 2),
                   total_owed = round(total_owed + _add, 2),
                   accrued_interest = round(accrued_interest + _add, 2)
             where id = _loan.id;
            _count := _count + 1;
          exception when unique_violation then null;
          end;
        end if;
      end if;
      _p := _p + 1;
    end loop;
  end loop;
  return _count;
end $function$;

-- 5. Friendly message when two requests race -----------------------------------
create or replace function public.request_coin_loan(_amount numeric)
returns coin_loans
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  begin
    insert into public.coin_loans (user_id, principal, interest_percent, auto_limit_snapshot,
                                   base_snapshot, multiplier_snapshot, free_balance_snapshot,
                                   first_month_interest, total_owed, outstanding,
                                   status, approval_mode)
    values (_me, _amount, coalesce(_s.loan_monthly_interest_percent, 0), _limit,
            _s.loan_auto_base_credits, _s.loan_free_balance_multiplier, _free,
            _interest, _amount, _amount, 'pending',
            case when _auto then 'automatic' else 'manual' end)
    returning * into _loan;
  exception when unique_violation then
    raise exception 'You already have a loan in progress. Repay it before requesting another one.';
  end;

  if _auto then
    _loan := public.release_coin_loan(_loan.id);
  end if;
  return _loan;
end $function$;

-- 6. Internal-only helpers stay internal ---------------------------------------
revoke all on function public.guard_restricted_coins() from public, anon, authenticated;
revoke all on function public.tg_loan_repayment_on_topup() from public, anon, authenticated;
revoke all on function public.tg_restore_restricted_on_refund() from public, anon, authenticated;
