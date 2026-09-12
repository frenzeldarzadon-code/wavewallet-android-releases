-- Universe shops require no membership approval; New Generation shops still do.
-- Run inside a transaction and roll back.
begin;

-- Shop type decides the rule.
do $$
declare _uni uuid; _ng uuid;
begin
  select id into _uni from public.ecosystems
   where shop_kind <> 'subscription' and archived_at is null limit 1;
  select id into _ng from public.ecosystems
   where shop_kind = 'subscription' and archived_at is null limit 1;

  if _uni is not null then
    if public.shop_requires_membership_approval(_uni) then
      raise exception 'Universe shop % must not require approval', _uni;
    end if;
  end if;

  if _ng is not null then
    if not public.shop_requires_membership_approval(_ng) then
      raise exception 'New Generation shop % must require approval', _ng;
    end if;
  end if;
end $$;

-- No Universe join is left sitting in an approval queue.
do $$
declare _stuck int;
begin
  select count(*) into _stuck
    from public.membership_applications a
   where a.status = 'pending'
     and not public.shop_requires_membership_approval(a.ecosystem_id);
  if _stuck > 0 then
    raise exception '% Universe applications are still pending approval', _stuck;
  end if;
end $$;

-- Universe memberships are never left inactive/pending by the join path.
do $$
declare _blocked int;
begin
  select count(*) into _blocked
    from public.ecosystem_memberships m
   where m.membership_state <> 'active'
     and m.status <> 'suspended'
     and not public.shop_requires_membership_approval(m.ecosystem_id);
  if _blocked > 0 then
    raise exception '% Universe memberships are blocked by an approval gate', _blocked;
  end if;
end $$;

-- ensure_universe_membership is idempotent and never duplicates a profile.
do $$
declare _uni uuid; _uid uuid; _n int; _profiles int;
begin
  select id into _uni from public.ecosystems
   where shop_kind <> 'subscription' and archived_at is null limit 1;
  select id into _uid from public.profiles where deleted_at is null limit 1;
  if _uni is null or _uid is null then return; end if;

  perform public.ensure_universe_membership(_uid, _uni);
  perform public.ensure_universe_membership(_uid, _uni);

  select count(*) into _n from public.ecosystem_memberships
   where user_id = _uid and ecosystem_id = _uni;
  if _n <> 1 then raise exception 'expected exactly one membership, got %', _n; end if;

  select count(*) into _profiles from public.profiles where id = _uid;
  if _profiles <> 1 then raise exception 'profile duplicated'; end if;
end $$;

rollback;
