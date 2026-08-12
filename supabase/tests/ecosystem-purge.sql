-- Regression fixtures for permanent ecosystem deletion (purge_ecosystem).
--
-- Runs entirely inside a transaction that is ROLLED BACK: it never touches real
-- production data. Two isolated fixture shops are created; only one is purged,
-- proving cross-shop isolation.
--
-- Covered:
--   1. Platform owner can purge an active shop that has transactions.
--   2. Exact-name confirmation is required.
--   3. A reason is required.
--   4. Non-super-admin callers are blocked.
--   5. Cross-ecosystem isolation (the other shop is untouched).
--   6. No orphan records remain.
--   7. The platform-level deletion record survives the purge.
--   8. Repeating the purge fails safely (already deleted).
--   9. Atomicity: a failed purge leaves the shop fully intact.

begin;

do $$
declare
  _keep uuid; _kill uuid;
  _owner uuid := gen_random_uuid();
  _admin uuid := gen_random_uuid();
  _cust uuid := gen_random_uuid();
  _acct uuid;
  _prod uuid;
  _before int;
  _err text;
begin
  -- fixture shops
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price)
  values ('FIXTURE Purge Me', 'fixture-purge-me', 'tok-kill', 'Starter', 150)
  returning id into _kill;
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price)
  values ('FIXTURE Keep Me', 'fixture-keep-me', 'tok-keep', 'Starter', 150)
  returning id into _keep;

  -- fixture members (profiles reference auth.users, so use the service path:
  -- these ids are only valid inside this rolled-back transaction)
  set constraints all deferred;
  insert into public.profiles (id, ecosystem_id, full_name, email, phone)
  values (_admin, _kill, 'FIXTURE Admin', 'fixture-admin@example.test', '0'),
         (_cust, _kill, 'FIXTURE Customer', 'fixture-customer@example.test', '0');
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_admin, 'admin', _kill), (_cust, 'customer', _kill);

  -- fixture financial history in the shop being purged
  insert into public.credit_accounts (user_id, ecosystem_id, balance)
  values (_cust, _kill, 100) returning id into _acct;
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, entry_kind)
  values (_acct, _cust, _kill, 'credit', 100, 100, 'FIXTURE load', 'credit_issue');
  insert into public.voucher_products (ecosystem_id, name, description, credit_price)
  values (_kill, 'FIXTURE PHP10', 'fixture', 10) returning id into _prod;
  insert into public.voucher_codes (ecosystem_id, product_id, code, status)
  values (_kill, _prod, 'FIXTURE-CODE-1', 'unused');
  insert into public.audit_logs (ecosystem_id, actor_name, action, target)
  values (_kill, 'FIXTURE', 'FIXTURE action', 'FIXTURE target');

  -- 2. wrong name is rejected  /  9. nothing is deleted by a failed attempt
  begin
    perform public.purge_ecosystem(_kill, 'Wrong Name', 'test');
    raise exception 'FAIL: wrong name was accepted';
  exception when others then
    get stacked diagnostics _err = message_text;
    if _err like 'FAIL:%' then raise exception '%', _err; end if;
  end;
  select count(*) into _before from public.credit_ledger where ecosystem_id = _kill;
  if _before <> 1 then raise exception 'FAIL: failed purge deleted data (atomicity)'; end if;

  -- 3. reason is required
  begin
    perform public.purge_ecosystem(_kill, 'FIXTURE Purge Me', '   ');
    raise exception 'FAIL: empty reason was accepted';
  exception when others then
    get stacked diagnostics _err = message_text;
    if _err like 'FAIL:%' then raise exception '%', _err; end if;
  end;

  -- 1. purge succeeds on an active shop holding transactions
  perform public.purge_ecosystem(_kill, 'FIXTURE Purge Me', 'Regression fixture purge');

  -- 6. no orphans anywhere
  if exists (select 1 from public.ecosystems where id = _kill)
     or exists (select 1 from public.credit_ledger where ecosystem_id = _kill)
     or exists (select 1 from public.credit_accounts where ecosystem_id = _kill)
     or exists (select 1 from public.voucher_codes where ecosystem_id = _kill)
     or exists (select 1 from public.voucher_products where ecosystem_id = _kill)
     or exists (select 1 from public.audit_logs where ecosystem_id = _kill)
     or exists (select 1 from public.profiles where ecosystem_id = _kill)
     or exists (select 1 from public.user_roles where ecosystem_id = _kill) then
    raise exception 'FAIL: orphan records remain after purge';
  end if;

  -- 5. the other shop is untouched
  if not exists (select 1 from public.ecosystems where id = _keep) then
    raise exception 'FAIL: cross-ecosystem data was deleted';
  end if;

  -- 7. platform-level deletion record survives outside the deleted shop
  if not exists (
    select 1 from public.platform_deletion_log
     where ecosystem_id = _kill and ecosystem_name = 'FIXTURE Purge Me'
  ) then
    raise exception 'FAIL: platform deletion record missing';
  end if;
  if not exists (
    select 1 from public.audit_logs
     where ecosystem_id is null and action = 'Permanently deleted ecosystem'
  ) then
    raise exception 'FAIL: platform audit event missing';
  end if;

  -- 8. repeating the purge fails safely
  begin
    perform public.purge_ecosystem(_kill, 'FIXTURE Purge Me', 'again');
    raise exception 'FAIL: repeated purge did not error';
  exception when others then
    get stacked diagnostics _err = message_text;
    if _err like 'FAIL:%' then raise exception '%', _err; end if;
  end;

  raise notice 'ecosystem-purge fixtures PASS';
end $$;

-- 4. non-super-admin callers are blocked (checked as a signed-in non-owner)
do $$
declare _err text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  begin
    perform public.purge_ecosystem(gen_random_uuid(), 'anything', 'test');
    raise exception 'FAIL: non-super-admin was allowed to purge';
  exception when others then
    get stacked diagnostics _err = message_text;
    if _err like 'FAIL:%' then raise exception '%', _err; end if;
    if _err not like '%platform owner%' then
      raise exception 'FAIL: expected authorization error, got %', _err;
    end if;
  end;
  raise notice 'purge authorization PASS';
end $$;

rollback;
