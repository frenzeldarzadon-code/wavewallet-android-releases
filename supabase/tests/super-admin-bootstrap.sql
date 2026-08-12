-- Security tests for the one-time platform-owner (Super Admin) bootstrap.
-- Run in a transaction and roll back; assertions raise on failure.
begin;

do $$
declare
  _ok boolean;
  _err text;
begin
  -- The demo super admin must NOT count as a real production owner.
  if exists (select 1 from public.profiles where is_demo and email like '%@wavewallet.demo') then
    if not public.super_admin_bootstrap_available()
       and not public.real_super_admin_exists() then
      raise exception 'FAIL: demo owner blocked bootstrap availability';
    end if;
  end if;

  -- Clean slate for the test.
  delete from public.platform_bootstrap;

  if public.real_super_admin_exists() then
    raise notice 'SKIP: a real super admin already exists in this database';
    return;
  end if;

  -- 1. First bootstrap claim succeeds.
  perform public.claim_super_admin_bootstrap('owner@example.com', 'test');
  raise notice 'PASS: first bootstrap claim accepted';

  -- 2. Second (concurrent) claim fails — single-row primary key.
  begin
    perform public.claim_super_admin_bootstrap('attacker@example.com', 'test');
    raise exception 'FAIL: second bootstrap claim was accepted';
  exception
    when others then
      get stacked diagnostics _err = message_text;
      if _err like 'FAIL:%' then raise; end if;
      raise notice 'PASS: second bootstrap claim rejected (%)', _err;
  end;

  -- 3. Availability closes once a claim is completed.
  update public.platform_bootstrap set completed_at = now();
  select public.super_admin_bootstrap_available() into _ok;
  if _ok then raise exception 'FAIL: bootstrap still available after completion'; end if;
  raise notice 'PASS: bootstrap closes after completion';

  delete from public.platform_bootstrap;
end $$;

-- 4. Anonymous and signed-in users cannot claim the bootstrap or assign roles.
do $$
declare _c int;
begin
  select count(*) into _c
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name in ('claim_super_admin_bootstrap', 'release_super_admin_bootstrap')
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if _c > 0 then
    raise exception 'FAIL: bootstrap claim function is callable by anon/authenticated';
  end if;
  raise notice 'PASS: bootstrap claim is service-role only';
end $$;

-- 5. Normal signup cannot request super_admin: the role comes from the trigger,
--    which only grants super_admin for a matching pending bootstrap claim.
do $$
declare _src text;
begin
  select prosrc into _src from pg_proc where proname = 'handle_new_user';
  if _src not like '%platform_bootstrap%' then
    raise exception 'FAIL: signup trigger does not consult the bootstrap claim';
  end if;
  if _src like '%raw_user_meta_data->>''role''%' then
    raise exception 'FAIL: signup trigger trusts a client-supplied role';
  end if;
  raise notice 'PASS: signup trigger never accepts a client-chosen role';
end $$;

-- 6. Bootstrap table is RLS-protected with no anon access.
do $$
declare _rls boolean; _c int;
begin
  select relrowsecurity into _rls from pg_class where relname = 'platform_bootstrap';
  if not _rls then raise exception 'FAIL: platform_bootstrap has RLS disabled'; end if;
  select count(*) into _c from information_schema.role_table_grants
   where table_name = 'platform_bootstrap' and grantee = 'anon';
  if _c > 0 then raise exception 'FAIL: anon has grants on platform_bootstrap'; end if;
  raise notice 'PASS: platform_bootstrap locked down';
end $$;

rollback;
