
create or replace function public.accrue_coin_loan_interest()
returns integer language plpgsql security definer set search_path = public as $$
declare _loan public.coin_loans; _periods integer; _p integer;
        _add numeric(14,2); _outstanding numeric(14,2); _count integer := 0;
begin
  for _loan in
    select * from public.coin_loans
     where status = 'active' and released_at is not null
     for update
  loop
    _periods := greatest(floor(extract(epoch from (now() - _loan.released_at)) / (30 * 86400))::int, 0);
    _p := 1;
    while _p <= _periods loop
      if not exists (select 1 from public.coin_loan_entries
                      where loan_id = _loan.id and kind = 'interest' and period_index = _p) then
        select outstanding into _outstanding from public.coin_loans where id = _loan.id;
        _add := round(_outstanding * _loan.interest_percent / 100, 2);
        if _add > 0 then
          update public.coin_loans
             set outstanding = round(outstanding + _add, 2),
                 total_owed = round(total_owed + _add, 2),
                 accrued_interest = round(accrued_interest + _add, 2)
           where id = _loan.id;
          insert into public.coin_loan_entries (loan_id, kind, amount, outstanding_after, period_index, note)
          values (_loan.id, 'interest', _add, round(_outstanding + _add, 2), _p,
                  'Monthly interest on the unpaid balance');
          _count := _count + 1;
        end if;
      end if;
      _p := _p + 1;
    end loop;
  end loop;
  return _count;
end $$;

revoke all on function public.accrue_coin_loan_interest() from public, anon, authenticated;
grant execute on function public.accrue_coin_loan_interest() to service_role;
