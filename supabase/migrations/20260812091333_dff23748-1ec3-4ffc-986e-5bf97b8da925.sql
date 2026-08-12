-- Anonymous callers must not reach privileged shop actions.
DO $do$
declare _oid oid;
begin
  for _oid in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname <> 'get_signup_ecosystem'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke all on function %s from public, anon', _oid::regprocedure);
    execute format('grant execute on function %s to authenticated', _oid::regprocedure);
  end loop;
end;
$do$;

-- Retire the legacy single-step payment path (superseded by subscription_requests).
DROP FUNCTION IF EXISTS public.submit_subscription_payment(uuid, text);