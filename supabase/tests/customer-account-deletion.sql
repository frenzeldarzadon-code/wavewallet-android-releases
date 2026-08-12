-- Customer account cleanup + role counter regression test.
--
-- Run inside a transaction and ROLLBACK — it creates synthetic accounts only:
--   BEGIN; \i supabase/tests/customer-account-deletion.sql ROLLBACK;
--
-- Part 1 verifies the ecosystem role counters (1 reseller, 1 subreseller,
-- 2 customers of which 1 suspended) and that demo profiles are excluded.
-- Part 2 verifies customer deletion eligibility and the anonymisation RPC.

BEGIN;

-- Part 1 — role counters ------------------------------------------------------
DO $$
declare
  _eco uuid := gen_random_uuid();
  _slug text := 'qa-counters-' || left(gen_random_uuid()::text, 8);
  _ids uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
                       gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  _n bigint;
begin
  insert into public.ecosystems (id, name, slug, signup_token, plan_name, plan_price,
                                 subscription_state, current_period_end, signup_enabled)
  values (_eco, 'QA Counters', _slug, 'tok', 'QA', 0, 'active', now() + interval '30 days', true);

  -- The signup trigger creates the profile, wallets and the customer role.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_user_meta_data)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'qa+' || left(u::text,8) || '@example.invalid', 'x', now(), now(),
         jsonb_build_object('full_name','QA','phone','0','ecosystem_slug',_slug)
  from unnest(_ids) u;

  update public.user_roles set role = 'admin'       where user_id = _ids[1];
  update public.user_roles set role = 'reseller'    where user_id = _ids[2];
  update public.user_roles set role = 'subreseller' where user_id = _ids[3];
  update public.profiles set status = 'suspended', joined_at = now() - interval '1 year'
    where id = _ids[4];
  update public.profiles set joined_at = now() - interval '10 days' where id = _ids[5];
  update public.profiles set is_demo = true where id = _ids[6];

  select count(*) into _n from public.countable_members(_eco) m where m.role = 'reseller';
  if _n <> 1 then raise exception 'reseller count = %, expected 1', _n; end if;
  select count(*) into _n from public.countable_members(_eco) m where m.role = 'subreseller';
  if _n <> 1 then raise exception 'subreseller count = %, expected 1', _n; end if;
  select count(*) into _n from public.countable_members(_eco) m where m.role = 'customer';
  if _n <> 2 then raise exception 'customer count = % (demo leaked?), expected 2', _n; end if;
  select count(*) into _n from public.countable_members(_eco) m
    where m.role = 'customer' and m.status = 'suspended';
  if _n <> 1 then raise exception 'suspended customer count = %, expected 1', _n; end if;

  raise notice 'PASS: role counters';
end $$;

-- Part 2 — deletion eligibility and anonymisation ------------------------------
DO $$
declare
  _eco uuid := gen_random_uuid();
  _slug text := 'qa-del-' || left(gen_random_uuid()::text, 8);
  _admin uuid := gen_random_uuid();
  _res uuid := gen_random_uuid();
  _rich uuid := gen_random_uuid();
  _new uuid := gen_random_uuid();
  _ok uuid := gen_random_uuid();
  _chk record;
  _p record;
  _n bigint;
begin
  insert into public.ecosystems (id, name, slug, signup_token, plan_name, plan_price,
                                 subscription_state, current_period_end, signup_enabled)
  values (_eco, 'QA Del', _slug, 'tok', 'QA', 0, 'active', now() + interval '30 days', true);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_user_meta_data)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'qd+' || left(u::text,8) || '@example.invalid', 'x', now(), now(),
         jsonb_build_object('full_name','QA','phone','0','ecosystem_slug',_slug)
  from unnest(array[_admin,_res,_rich,_new,_ok]) u;

  update public.user_roles set role='admin'    where user_id=_admin;
  update public.user_roles set role='reseller' where user_id=_res;
  update public.profiles set joined_at = now() - interval '1 year'
    where id in (_admin,_res,_rich,_ok);
  update public.profiles set joined_at = now() - interval '10 days' where id = _new;
  update public.credit_accounts set balance = 25 where user_id = _rich;

  perform set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  select * into _chk from public.customer_deletion_check(_new);
  if _chk.eligible then raise exception 'young customer wrongly eligible'; end if;
  select * into _chk from public.customer_deletion_check(_rich);
  if _chk.eligible then raise exception 'customer with credits wrongly eligible'; end if;
  select * into _chk from public.customer_deletion_check(_res);
  if _chk.eligible then raise exception 'reseller wrongly eligible'; end if;
  select * into _chk from public.customer_deletion_check(_ok);
  if not _chk.eligible then raise exception 'eligible customer blocked: %', _chk.blockers; end if;

  begin
    perform public.delete_customer_account(_res, 'qa');
    raise exception 'GUARD reseller deletion should have failed';
  exception when others then
    if sqlerrm like 'GUARD%' then raise; end if;
  end;

  perform public.delete_customer_account(_ok, 'qa cleanup');
  select * into _p from public.profiles where id = _ok;
  if _p.deleted_at is null then raise exception 'profile not marked deleted'; end if;
  if _p.full_name <> 'Deleted customer' then raise exception 'not anonymised: %', _p.full_name; end if;
  select count(*) into _n from public.user_roles where user_id = _ok;
  if _n <> 0 then raise exception 'roles not revoked (%)', _n; end if;
  select count(*) into _n from public.audit_logs where ecosystem_id = _eco;
  if _n = 0 then raise exception 'no audit entry written'; end if;
  select count(*) into _n from public.credit_accounts where user_id = _ok;
  if _n <> 1 then raise exception 'wallet history destroyed'; end if;

  -- A reseller must not be able to invoke the cleanup at all.
  perform set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  begin
    perform public.delete_customer_account(_new, 'nope');
    raise exception 'GUARD reseller was allowed to delete';
  exception when others then
    if sqlerrm like 'GUARD%' then raise; end if;
  end;

  raise notice 'PASS: deletion rules';
end $$;

ROLLBACK;
