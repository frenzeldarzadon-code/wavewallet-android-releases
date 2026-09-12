create or replace function public.apply_loan_repayment(_user_id uuid, _amount numeric, _reason text)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare _loan public.coin_loans; _acct uuid; _bal numeric(14,2); _pay numeric(14,2);
        _ledger uuid; _left numeric(14,2);
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

  _left := round(_loan.outstanding - _pay, 2);

  update public.coin_loans
     set outstanding = _left,
         status = case when _left <= 0 then 'settled' else status end,
         settled_at = case when _left <= 0 then now() else settled_at end
   where id = _loan.id;

  -- Release the repaid coins. The insert trigger only lowers the restricted
  -- amount when the balance drops below it, so a repayment funded by a fresh
  -- top up would otherwise leave coins locked after the loan is settled.
  update public.credit_accounts
     set restricted_balance = greatest(0, least(restricted_balance, balance, _left)),
         updated_at = now()
   where id = _acct;

  insert into public.coin_loan_entries (loan_id, kind, amount, outstanding_after, ledger_id, note)
  values (_loan.id, 'repayment', _pay, _left, _ledger, _reason);

  return _pay;
end $$;

revoke all on function public.apply_loan_repayment(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_loan_repayment(uuid, numeric, text) to service_role;