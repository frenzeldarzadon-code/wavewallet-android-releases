do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    grant execute on function public.record_cash_in_reference_conflict(uuid) to sandbox_exec;
    grant execute on function public.cash_in_conflict_snapshot(uuid) to sandbox_exec;
  end if;
end $$;