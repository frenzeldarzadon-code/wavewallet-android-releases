
do $$
begin
  perform cron.unschedule('coin-loan-interest');
exception when others then null;
end $$;

select cron.schedule('coin-loan-interest', '20 2 * * *',
  $$select public.accrue_coin_loan_interest();$$);
