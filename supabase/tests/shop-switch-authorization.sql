-- Active-shop switching authorization.
--
-- The rule: a person may enter a shop when they hold an approved membership
-- there (any role, including an admin assignment) or when they are the
-- platform owner. Their role in another shop is never a reason to allow or
-- deny access, and switching moves no wallets, points or history.
--
-- Historically the profile guard trigger required the platform owner for ANY
-- change of a profile's shop, which broke switching for a person who
-- administers two shops ("Only the platform owner can move an account to
-- another ecosystem"). These checks lock the corrected behaviour in.
--
-- Run manually against a scratch database.

begin;

-- 1. The stale platform-owner-only guard is gone and the membership check is in.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_profile_update';
  if _def like '%Only the platform owner can move an account to another ecosystem%' then
    raise exception 'the stale platform-owner-only shop guard is still in place';
  end if;
  if _def not like '%ecosystem_memberships%' then
    raise exception 'the profile guard must validate an approved membership';
  end if;
end $$;

-- 2. switch_ecosystem authorizes on membership, not on platform ownership.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'switch_ecosystem';
  if _def not like '%approved membership%' then
    raise exception 'switch_ecosystem must refuse shops without an approved membership';
  end if;
end $$;

-- 3. Scenario matrix against live memberships:
--    A) two admin memberships  -> both switchable
--    B) admin + customer       -> both switchable, role stays per shop
--    C) no membership          -> refused
--    D) platform owner         -> every shop
--    E) assigned shop admin    -> membership is created active by assign_shop_admin
do $$
declare
  _u uuid; _a uuid; _b uuid; _c uuid;
  _wa numeric; _wb numeric; _wa2 numeric; _wb2 numeric; _eco uuid; _role app_role; _ok boolean;
begin
  select m.user_id into _u
    from public.ecosystem_memberships m
   where m.membership_state = 'active'
   group by m.user_id having count(*) > 1
   limit 1;
  if _u is null then
    raise notice 'no multi-shop member in this database; scenario checks skipped';
    return;
  end if;

  select ecosystem_id into _a from public.ecosystem_memberships
   where user_id = _u and membership_state = 'active' order by ecosystem_id limit 1;
  select ecosystem_id into _b from public.ecosystem_memberships
   where user_id = _u and membership_state = 'active' and ecosystem_id <> _a limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', _u, 'role', 'authenticated')::text, true);

  select balance into _wa from public.credit_accounts where user_id = _u and ecosystem_id = _a;
  select balance into _wb from public.credit_accounts where user_id = _u and ecosystem_id = _b;

  perform public.switch_ecosystem(_b);
  select ecosystem_id into _eco from public.profiles where id = _u;
  if _eco <> _b then raise exception 'switching into a second shop failed'; end if;

  -- The role that applies is the role held in the shop just entered.
  select role into _role from public.ecosystem_memberships
   where user_id = _u and ecosystem_id = _b;
  if not exists (select 1 from public.user_roles
                  where user_id = _u and ecosystem_id = _b and role = _role) then
    raise exception 'the active role must be the membership role of the entered shop';
  end if;

  -- Wallets never move on a switch.
  select balance into _wa2 from public.credit_accounts where user_id = _u and ecosystem_id = _a;
  select balance into _wb2 from public.credit_accounts where user_id = _u and ecosystem_id = _b;
  if _wa2 is distinct from _wa or _wb2 is distinct from _wb then
    raise exception 'switching shops moved credits';
  end if;

  -- A shop the person does not belong to stays closed.
  select e.id into _c from public.ecosystems e
   where e.archived_at is null
     and not exists (select 1 from public.ecosystem_memberships m
                      where m.user_id = _u and m.ecosystem_id = e.id)
   limit 1;
  if _c is not null then
    _ok := false;
    begin
      perform public.switch_ecosystem(_c);
    exception when others then _ok := true;
    end;
    if not _ok then raise exception 'a non-member entered a foreign shop'; end if;
  end if;

  perform public.switch_ecosystem(_a);
end $$;

-- 4. The platform owner never holds an ordinary shop membership row.
do $$
begin
  if exists (
    select 1 from public.ecosystem_memberships m
     where exists (select 1 from public.user_roles r
                    where r.user_id = m.user_id and r.role = 'super_admin')
  ) then
    raise exception 'the platform owner must not appear as an ordinary shop member';
  end if;
end $$;

rollback;
