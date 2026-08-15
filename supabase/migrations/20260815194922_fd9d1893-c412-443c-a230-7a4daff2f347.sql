do $$
declare r record;
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    for r in select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('is_super_admin','link_cash_in_listener_event','try_auto_approve_cash_in',
                                  'match_listener_event','cash_in_receiving_number','cash_in_auto_rule',
                                  'normalize_payment_reference','normalize_ph_mobile')
    loop
      execute format('grant execute on function %s to sandbox_exec', r.sig);
    end loop;
  end if;
end $$;