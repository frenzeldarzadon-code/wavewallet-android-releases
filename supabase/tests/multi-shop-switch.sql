-- Multi-shop switching regression suite.
--
-- Reproduces the production bug where switching from one shop to another for a
-- member who is Admin in both failed with
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- because shop role rows became unique per (user_id, ecosystem_id, role) while
-- several functions still targeted the old global (user_id, role) key.
--
-- Run inside a transaction and roll back: it mutates real rows.
--   begin;  \i supabase/tests/multi-shop-switch.sql  rollback;

do $$
declare
  _sa      uuid; -- platform owner
  _admin   uuid; -- admin of shop A and shop B
  _shop_a  uuid;
  _shop_b  uuid;
  _outside uuid; -- member of shop A only
  _mem_before int; _wal_before int;
  _mem_after  int; _wal_after  int;
  _bal_a_before numeric; _bal_b_before numeric;
  _bal_a_after  numeric; _bal_b_after  numeric;
  _state text; _denied boolean := false;
begin
  select user_id into _sa from public.user_roles where role = 'super_admin' limit 1;

  -- A member who is an active admin in two different shops.
  select m1.user_id, m1.ecosystem_id, m2.ecosystem_id
    into _admin, _shop_a, _shop_b
  from public.ecosystem_memberships m1
  join public.ecosystem_memberships m2
    on m2.user_id = m1.user_id and m2.ecosystem_id <> m1.ecosystem_id
  where m1.membership_state = 'active' and m2.membership_state = 'active'
    and m1.role = 'admin' and m2.role = 'admin'
  limit 1;
  if _admin is null then raise notice 'skipped: no multi-shop admin present'; return; end if;

  select count(*) into _mem_before from public.ecosystem_memberships where user_id = _admin;
  select count(*) into _wal_before from public.credit_accounts where user_id = _admin;
  select balance into _bal_a_before from public.credit_accounts where user_id = _admin and ecosystem_id = _shop_a;
  select balance into _bal_b_before from public.credit_accounts where user_id = _admin and ecosystem_id = _shop_b;

  -- 1 + 5: A -> B -> A -> B must all succeed and stay idempotent.
  perform set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  perform public.switch_ecosystem(_shop_a);
  perform public.switch_ecosystem(_shop_b);
  perform public.switch_ecosystem(_shop_a);
  perform public.switch_ecosystem(_shop_b);

  select count(*) into _mem_after from public.ecosystem_memberships where user_id = _admin;
  select count(*) into _wal_after from public.credit_accounts where user_id = _admin;
  select balance into _bal_a_after from public.credit_accounts where user_id = _admin and ecosystem_id = _shop_a;
  select balance into _bal_b_after from public.credit_accounts where user_id = _admin and ecosystem_id = _shop_b;

  if _mem_after <> _mem_before then raise exception 'duplicate membership created by switching'; end if;
  if _wal_after <> _wal_before then raise exception 'duplicate wallet created by switching'; end if;
  -- 6: wallets stay strictly per shop, switching never moves credits.
  if _bal_a_after is distinct from _bal_a_before
     or _bal_b_after is distinct from _bal_b_before then
    raise exception 'switching changed a shop wallet balance';
  end if;

  -- 4: assigning an admin is immediate and re-assignment is a no-op.
  perform set_config('request.jwt.claims',
    json_build_object('sub', _sa, 'role', 'authenticated')::text, true);
  perform public.assign_shop_admin(_shop_b, _admin);
  perform public.assign_shop_admin(_shop_b, _admin);
  select role::text || '/' || membership_state || '/' || status into _state
    from public.ecosystem_memberships where user_id = _admin and ecosystem_id = _shop_b;
  if _state <> 'admin/active/active' then
    raise exception 'assigned admin is not immediately active: %', _state;
  end if;
  if (select count(*) from public.ecosystem_memberships
       where user_id = _admin and ecosystem_id = _shop_b) <> 1 then
    raise exception 'assignment created a duplicate membership';
  end if;

  -- 3: no membership in a shop means no entry.
  select m.user_id into _outside
  from public.ecosystem_memberships m
  where m.ecosystem_id = _shop_a and m.membership_state = 'active'
    and not exists (select 1 from public.ecosystem_memberships x
                    where x.user_id = m.user_id and x.ecosystem_id = _shop_b)
    and not public.is_super_admin(m.user_id)
  limit 1;
  if _outside is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', _outside, 'role', 'authenticated')::text, true);
    begin
      perform public.switch_ecosystem(_shop_b);
    exception when others then _denied := true;
    end;
    if not _denied then raise exception 'a non-member was allowed into a shop'; end if;
  end if;

  raise notice 'multi-shop switch suite passed';
end $$;

-- Every upsert target used by the switch / membership / wallet path must be a
-- real unique key, otherwise the ON CONFLICT bug can reappear.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~* 'on conflict \(\s*user_id\s*,\s*role\s*\)'
  ) then
    raise exception 'a function still upserts user_roles on the removed global (user_id, role) key';
  end if;
end $$;
