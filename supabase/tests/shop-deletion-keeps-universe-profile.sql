-- Permanent shop deletion must never delete a member's Universe identity.
--
-- Run inside a transaction and ROLLBACK — it creates synthetic shops/accounts:
--   BEGIN; \i supabase/tests/shop-deletion-keeps-universe-profile.sql ROLLBACK;
--
-- Covers:
--   (a) member only in Shop A survives as a Universe-only member (profile,
--       handle, name kept; shop pointers cleared),
--   (b) member in Shop A + Shop B keeps their profile and the Shop B
--       membership, and their pointers move to Shop B,
--   (c) a member of unrelated Shop C is untouched,
--   plus: Shop A itself and its shop-scoped rows are gone, and the platform
--   deletion record is written.

DO $$
declare
  _a uuid := gen_random_uuid();
  _b uuid := gen_random_uuid();
  _c uuid := gen_random_uuid();
  _slugA text := 'qa-keep-a-' || left(gen_random_uuid()::text, 8);
  _slugB text := 'qa-keep-b-' || left(gen_random_uuid()::text, 8);
  _slugC text := 'qa-keep-c-' || left(gen_random_uuid()::text, 8);
  _owner uuid := gen_random_uuid();
  _only uuid := gen_random_uuid();
  _both uuid := gen_random_uuid();
  _other uuid := gen_random_uuid();
  _p record;
  _n bigint;
  _handle text;
begin
  insert into public.ecosystems (id, name, slug, signup_token, plan_name, plan_price,
                                 subscription_state, current_period_end, signup_enabled)
  values (_a, 'QA Keep A', _slugA, 'tokA-' || _slugA, 'QA', 0, 'active', now() + interval '30 days', true),
         (_b, 'QA Keep B', _slugB, 'tokB-' || _slugB, 'QA', 0, 'active', now() + interval '30 days', true),
         (_c, 'QA Keep C', _slugC, 'tokC-' || _slugC, 'QA', 0, 'active', now() + interval '30 days', true);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_user_meta_data)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'kp+' || left(u.id::text,8) || '@example.invalid', 'x', now(), now(),
         jsonb_build_object('full_name','QA Member','phone','0','ecosystem_slug', u.slug)
  from (values (_owner, _slugA), (_only, _slugA), (_both, _slugA), (_other, _slugC)) as u(id, slug);

  update public.user_roles set role = 'super_admin' where user_id = _owner;
  update public.profiles set ecosystem_id = null, active_ecosystem_id = null where id = _owner;

  -- _both also belongs to surviving Shop B.
  insert into public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
  values (_both, _b, 'customer', 'active', 'active')
  on conflict do nothing;

  select handle into _handle from public.profiles where id = _only;
  if _handle is null then raise exception 'fixture: member has no handle'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  perform public.delete_own_shop(_a, 'QA Keep A', 'regression: universe identity must survive');

  if exists (select 1 from public.ecosystems where id = _a) then
    raise exception 'FAIL: shop A still exists';
  end if;

  -- (a) member only in Shop A: profile survives, no shop.
  select * into _p from public.profiles where id = _only;
  if _p.id is null then raise exception 'FAIL: Universe profile was deleted (shop-only member)'; end if;
  if _p.handle is distinct from _handle then raise exception 'FAIL: handle changed'; end if;
  if _p.full_name is null or _p.deleted_at is not null then
    raise exception 'FAIL: identity was anonymised or soft-deleted';
  end if;
  if _p.ecosystem_id is not null or _p.active_ecosystem_id is not null then
    raise exception 'FAIL: shop pointers not cleared (%, %)', _p.ecosystem_id, _p.active_ecosystem_id;
  end if;
  select count(*) into _n from public.ecosystem_memberships where user_id = _only;
  if _n <> 0 then raise exception 'FAIL: deleted-shop membership survived (%)', _n; end if;

  -- (b) member in Shop A + Shop B: profile and Shop B membership intact.
  select * into _p from public.profiles where id = _both;
  if _p.id is null then raise exception 'FAIL: multi-shop member profile was deleted'; end if;
  if _p.ecosystem_id <> _b or _p.active_ecosystem_id <> _b then
    raise exception 'FAIL: pointers not moved to surviving shop (%, %)', _p.ecosystem_id, _p.active_ecosystem_id;
  end if;
  select count(*) into _n from public.ecosystem_memberships
   where user_id = _both and ecosystem_id = _b;
  if _n <> 1 then raise exception 'FAIL: surviving shop membership lost (%)', _n; end if;
  select count(*) into _n from public.ecosystem_memberships
   where user_id = _both and ecosystem_id = _a;
  if _n <> 0 then raise exception 'FAIL: deleted shop membership survived'; end if;

  -- (c) unrelated Shop C member untouched.
  select * into _p from public.profiles where id = _other;
  if _p.id is null or _p.ecosystem_id <> _c then
    raise exception 'FAIL: unrelated shop member was affected';
  end if;
  if not exists (select 1 from public.ecosystems where id = _c)
     or not exists (select 1 from public.ecosystems where id = _b) then
    raise exception 'FAIL: other shops were deleted';
  end if;

  -- shop-scoped teardown and the platform deletion record still happen.
  if exists (select 1 from public.user_roles where ecosystem_id = _a)
     or exists (select 1 from public.credit_accounts where ecosystem_id = _a)
     or exists (select 1 from public.spending_categories where ecosystem_id = _a) then
    raise exception 'FAIL: shop-scoped rows survived';
  end if;
  if not exists (select 1 from public.platform_deletion_log where ecosystem_id = _a) then
    raise exception 'FAIL: platform deletion record missing';
  end if;

  raise notice 'PASS: shop deletion keeps Universe identities';
end $$;
