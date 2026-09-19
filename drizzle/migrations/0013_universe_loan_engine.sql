-- Universe Loan: application, funding, release, accrual, repayment, reporting.

create or replace function public.universe_loan_monthly_payment(
  _principal numeric, _monthly_percent numeric, _months integer
) returns numeric language plpgsql immutable set search_path = public as $$
declare r numeric; f numeric;
begin
  if coalesce(_months,0) <= 0 then return 0; end if;
  r := coalesce(_monthly_percent,0) / 100.0;
  if r <= 0 then return round(coalesce(_principal,0) / _months, 2); end if;
  f := power(1 + r, _months);
  return round(coalesce(_principal,0) * r * f / (f - 1), 2);
end $$;

create or replace function public.accrue_universe_loan(_loan_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _l public.universe_loans; _days numeric; _add numeric(14,2);
begin
  select * into _l from public.universe_loans where id = _loan_id for update;
  if _l.id is null or _l.status <> 'active' then return; end if;
  if _l.last_accrual_at is null then return; end if;
  _days := extract(epoch from (now() - _l.last_accrual_at)) / 86400.0;
  if _days <= 0 then return; end if;
  _add := round(_l.principal_outstanding * (_l.interest_percent / 100.0) * (_days / 30.0), 2);
  update public.universe_loans
     set interest_accrued = interest_accrued + greatest(_add, 0),
         last_accrual_at = now(),
         updated_at = now()
   where id = _loan_id;
end $$;

create or replace function public.accrue_all_universe_loans()
returns integer language plpgsql security definer set search_path = public as $$
declare _id uuid; _n integer := 0;
begin
  for _id in select id from public.universe_loans where status = 'active' loop
    perform public.accrue_universe_loan(_id);
    _n := _n + 1;
  end loop;
  return _n;
end $$;

create or replace function public.apply_universe_loan(
  _amount numeric, _term_months integer, _id_path text, _client_token text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _s record; _amt numeric(14,2); _id uuid;
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();
  select * into _s from public.universe_loan_settings();
  if not _s.enabled then raise exception 'Universe loans are not available right now'; end if;

  _amt := round(coalesce(_amount,0), 2);
  if _amt <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  if _term_months is null or _term_months <> all (_s.terms) then
    raise exception 'Choose a term of 3, 6 or 12 months';
  end if;
  if _id_path is null or btrim(_id_path) = '' then
    raise exception 'A valid ID is required for this loan request';
  end if;
  if split_part(_id_path, '/', 1) <> _me::text then
    raise exception 'That ID file does not belong to you';
  end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'loan-ids' and o.name = _id_path) then
    raise exception 'Upload your valid ID again';
  end if;
  if exists (select 1 from public.universe_loans where id_document_path = _id_path) then
    raise exception 'That ID file is already attached to another loan request';
  end if;
  if exists (select 1 from public.universe_loans
              where borrower_id = _me
                and status in ('pending_funding','partially_funded','fully_funded','active')) then
    raise exception 'You already have a Universe loan in progress';
  end if;

  if _client_token is not null then
    select id into _id from public.universe_loans
     where borrower_id = _me and client_token = _client_token;
    if _id is not null then return _id; end if;
  end if;

  insert into public.universe_loans (
    borrower_id, amount, term_months, status,
    interest_percent, platform_fee_percent, owner_share_percent, contributor_share_percent,
    id_document_path, id_document_uploaded_at, client_token
  ) values (
    _me, _amt, _term_months, 'pending_funding',
    _s.interest_percent, _s.platform_fee_percent, _s.owner_share_percent, _s.contributor_share_percent,
    _id_path, now(), _client_token
  ) returning id into _id;

  return _id;
end $$;

create or replace function public.cancel_universe_loan(_loan_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _l public.universe_loans; _f record;
begin
  select * into _l from public.universe_loans where id = _loan_id for update;
  if _l.id is null then raise exception 'Loan not found'; end if;
  if _l.borrower_id <> _me and not public.is_super_admin(_me) then
    raise exception 'You cannot cancel this loan';
  end if;
  if _l.status not in ('pending_funding','partially_funded') then
    raise exception 'Only a loan that has not been released can be cancelled';
  end if;

  for _f in select * from public.universe_loan_fundings where loan_id = _loan_id loop
    update public.loan_pool_accounts
       set allocated = greatest(0, allocated - _f.amount),
           available = available + _f.amount,
           updated_at = now()
     where user_id = _f.funder_id;
    perform public.loan_pool_note(_f.funder_id, _loan_id, 'allocation_returned', _f.amount, 'Loan cancelled');
  end loop;
  delete from public.universe_loan_fundings where loan_id = _loan_id;

  update public.universe_loans
     set status = 'cancelled', funded_amount = 0, cancelled_at = now(), updated_at = now()
   where id = _loan_id;
end $$;

create or replace function public.release_universe_loan(_loan_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _l public.universe_loans; _f record; _acct uuid; _fee numeric(14,2); _net numeric(14,2);
        _pmt numeric(14,2); _i integer; _bal numeric(14,2); _int numeric(14,2); _prin numeric(14,2);
        _r numeric;
begin
  select * into _l from public.universe_loans where id = _loan_id for update;
  if _l.id is null or _l.status = 'active' then return; end if;
  if round(_l.funded_amount,2) < round(_l.amount,2) then return; end if;

  _fee := round(_l.amount * _l.platform_fee_percent / 100.0, 2);
  _net := round(_l.amount - _fee, 2);

  perform public.ensure_global_wallet(_l.borrower_id);
  select id into _acct from public.credit_accounts
   where user_id = _l.borrower_id and ecosystem_id is null for update;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    reason, entry_kind, actor_id)
  values (_acct, _l.borrower_id, null, 'credit', _net,
          'Universe loan released', 'universe_loan_release', _l.borrower_id);

  for _f in select * from public.universe_loan_fundings where loan_id = _loan_id loop
    update public.universe_loan_fundings
       set released_principal = _f.amount, updated_at = now() where id = _f.id;
    update public.loan_pool_accounts
       set allocated = greatest(0, allocated - _f.amount), updated_at = now()
     where user_id = _f.funder_id;
    perform public.loan_pool_note(_f.funder_id, _loan_id, 'principal_released', _f.amount, null);
  end loop;

  insert into public.universe_loan_earnings (loan_id, kind, amount, note)
  values (_loan_id, 'platform_fee', _fee, 'Loan platform fee');

  update public.universe_loans
     set status = 'active', platform_fee = _fee, released_amount = _net,
         principal_outstanding = _l.amount, released_at = now(), last_accrual_at = now(),
         updated_at = now()
   where id = _loan_id;

  _r := _l.interest_percent / 100.0;
  _pmt := public.universe_loan_monthly_payment(_l.amount, _l.interest_percent, _l.term_months);
  _bal := _l.amount;
  for _i in 1.._l.term_months loop
    _int := round(_bal * _r, 2);
    _prin := case when _i = _l.term_months then _bal else round(_pmt - _int, 2) end;
    if _prin > _bal then _prin := _bal; end if;
    insert into public.universe_loan_schedule (loan_id, period_index, due_date, principal_due, interest_due, total_due)
    values (_loan_id, _i, (now() + (_i || ' months')::interval)::date, _prin, _int, round(_prin + _int, 2));
    _bal := round(_bal - _prin, 2);
  end loop;
end $$;

create or replace function public.fund_universe_loan(_loan_id uuid, _amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _l public.universe_loans;
        _avail numeric(14,2); _amt numeric(14,2); _need numeric(14,2);
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();

  select * into _l from public.universe_loans where id = _loan_id for update;
  if _l.id is null then raise exception 'Loan not found'; end if;
  if _l.status not in ('pending_funding','partially_funded') then
    raise exception 'This loan is no longer open for funding';
  end if;
  if _l.borrower_id = _me then raise exception 'You cannot fund your own loan'; end if;

  _need := round(_l.amount - _l.funded_amount, 2);
  if _need <= 0 then raise exception 'This loan is already fully funded'; end if;

  _amt := round(coalesce(_amount,0), 2);
  if _amt <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  if _amt > _need then _amt := _need; end if;

  perform public.ensure_loan_pool_account(_me);
  select available into _avail from public.loan_pool_accounts where user_id = _me for update;
  if coalesce(_avail,0) < _amt then
    raise exception 'Only % coins are available in your Loan Pool funds', coalesce(_avail,0);
  end if;

  update public.loan_pool_accounts
     set available = available - _amt, allocated = allocated + _amt, updated_at = now()
   where user_id = _me;

  insert into public.universe_loan_fundings (loan_id, funder_id, amount)
  values (_loan_id, _me, _amt)
  on conflict (loan_id, funder_id)
  do update set amount = public.universe_loan_fundings.amount + excluded.amount, updated_at = now();

  perform public.loan_pool_note(_me, _loan_id, 'allocation', _amt, null);

  update public.universe_loans
     set funded_amount = funded_amount + _amt,
         status = case when round(funded_amount + _amt, 2) >= round(amount, 2)
                       then 'fully_funded' else 'partially_funded' end,
         updated_at = now()
   where id = _loan_id;

  if round(_l.funded_amount + _amt, 2) >= round(_l.amount, 2) then
    perform public.release_universe_loan(_loan_id);
  end if;

  return _amt;
end $$;

create or replace function public.distribute_universe_loan_interest(_loan_id uuid, _interest numeric)
returns void language plpgsql security definer set search_path = public as $$
declare _l public.universe_loans; _f record; _owner numeric(14,2); _contrib numeric(14,2);
        _share numeric(14,2); _total numeric(14,2);
begin
  if round(coalesce(_interest,0),2) = 0 then return; end if;
  select * into _l from public.universe_loans where id = _loan_id;
  _owner := round(_interest * _l.owner_share_percent / 100.0, 2);
  _contrib := round(_interest - _owner, 2);

  insert into public.universe_loan_earnings (loan_id, kind, amount, note)
  values (_loan_id, case when _interest > 0 then 'owner_interest' else 'owner_interest_reversal' end,
          _owner, null);

  select coalesce(sum(released_principal),0) into _total
    from public.universe_loan_fundings where loan_id = _loan_id;
  if _total <= 0 then return; end if;

  for _f in select * from public.universe_loan_fundings where loan_id = _loan_id order by created_at loop
    _share := round(_contrib * _f.released_principal / _total, 2);
    if _share = 0 then continue; end if;
    update public.universe_loan_fundings
       set interest_earned = interest_earned + _share, updated_at = now() where id = _f.id;
    update public.loan_pool_accounts
       set available = available + _share,
           interest_earned = interest_earned + _share,
           updated_at = now()
     where user_id = _f.funder_id;
    perform public.loan_pool_note(_f.funder_id, _loan_id,
      case when _share > 0 then 'interest_earned' else 'interest_reversed' end, _share, null);
  end loop;
end $$;

create or replace function public.return_universe_loan_principal(_loan_id uuid, _principal numeric)
returns void language plpgsql security definer set search_path = public as $$
declare _f record; _total numeric(14,2); _share numeric(14,2); _left numeric(14,2);
        _n integer := 0; _i integer := 0;
begin
  if round(coalesce(_principal,0),2) <= 0 then return; end if;
  select coalesce(sum(released_principal),0), count(*) into _total, _n
    from public.universe_loan_fundings where loan_id = _loan_id;
  if _total <= 0 then return; end if;
  _left := round(_principal, 2);
  for _f in select * from public.universe_loan_fundings where loan_id = _loan_id order by created_at loop
    _i := _i + 1;
    _share := case when _i = _n then _left else round(_principal * _f.released_principal / _total, 2) end;
    if _share <= 0 then continue; end if;
    _left := round(_left - _share, 2);
    update public.universe_loan_fundings
       set principal_repaid = principal_repaid + _share, updated_at = now() where id = _f.id;
    update public.loan_pool_accounts
       set available = available + _share, updated_at = now() where user_id = _f.funder_id;
    perform public.loan_pool_note(_f.funder_id, _loan_id, 'principal_returned', _share, null);
  end loop;
end $$;

create or replace function public.settle_universe_loan(_loan_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _l public.universe_loans; _excess numeric(14,2); _acct uuid; _ledger uuid; _early boolean;
begin
  select * into _l from public.universe_loans where id = _loan_id for update;
  if _l.id is null or _l.status <> 'active' then return; end if;
  if round(_l.principal_outstanding,2) > 0 then return; end if;

  _excess := round(_l.interest_paid - _l.interest_accrued, 2);
  if _excess > 0 then
    select id into _acct from public.credit_accounts
     where user_id = _l.borrower_id and ecosystem_id is null for update;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                      reason, entry_kind, actor_id)
    values (_acct, _l.borrower_id, null, 'credit', _excess,
            'Universe loan interest refund', 'universe_loan_interest_refund', _l.borrower_id)
    returning id into _ledger;

    perform public.distribute_universe_loan_interest(_loan_id, -_excess);

    insert into public.universe_loan_payments (loan_id, user_id, kind, amount, principal_part,
                                               interest_part, principal_after, ledger_id, note)
    values (_loan_id, _l.borrower_id, 'interest_refund', _excess, 0, -_excess, 0, _ledger,
            'Interest no longer applicable after early repayment');

    update public.universe_loans
       set interest_refunded = interest_refunded + _excess,
           interest_paid = interest_paid - _excess
     where id = _loan_id;
  end if;

  _early := _l.released_at is not null
        and now() < _l.released_at + (_l.term_months || ' months')::interval;

  update public.universe_loans
     set status = case when _early then 'early_paid' else 'paid' end,
         settled_at = now(), updated_at = now()
   where id = _loan_id;

  delete from public.universe_loan_schedule
   where loan_id = _loan_id and due_date > current_date;
end $$;

create or replace function public.pay_universe_loan(_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _l public.universe_loans; _lid uuid;
        _acct uuid; _bal numeric(14,2);
        _amt numeric(14,2); _due_int numeric(14,2); _int_part numeric(14,2); _prin_part numeric(14,2);
        _ledger uuid; _payoff numeric(14,2);
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();

  select id into _lid from public.universe_loans
   where borrower_id = _me and status = 'active' limit 1;
  if _lid is null then raise exception 'You have no active Universe loan'; end if;

  perform public.accrue_universe_loan(_lid);
  select * into _l from public.universe_loans where id = _lid for update;

  _due_int := round(_l.interest_accrued - _l.interest_paid, 2);
  if _due_int < 0 then _due_int := 0; end if;
  _payoff := round(_l.principal_outstanding + _due_int, 2);

  _amt := round(coalesce(_amount,0), 2);
  if _amt <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  if _amt > _payoff then _amt := _payoff; end if;

  select id, balance into _acct, _bal from public.credit_accounts
   where user_id = _me and ecosystem_id is null for update;
  if _acct is null then raise exception 'Universe wallet not found'; end if;
  if _bal < _amt then raise exception 'Not enough coins in your Universe wallet'; end if;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    reason, entry_kind, actor_id)
  values (_acct, _me, null, 'debit', _amt, 'Universe loan payment', 'universe_loan_payment', _me)
  returning id into _ledger;

  _int_part := least(_amt, _due_int);
  _prin_part := round(_amt - _int_part, 2);

  update public.universe_loans
     set interest_paid = interest_paid + _int_part,
         principal_paid = principal_paid + _prin_part,
         principal_outstanding = round(principal_outstanding - _prin_part, 2),
         updated_at = now()
   where id = _lid;

  perform public.distribute_universe_loan_interest(_lid, _int_part);
  perform public.return_universe_loan_principal(_lid, _prin_part);

  insert into public.universe_loan_payments (loan_id, user_id, kind, amount, principal_part,
                                             interest_part, principal_after, ledger_id)
  values (_lid, _me, 'payment', _amt, _prin_part, _int_part,
          round(_l.principal_outstanding - _prin_part, 2), _ledger);

  perform public.settle_universe_loan(_lid);

  return _amt;
end $$;