-- ============================================================ 1. HANDLES
create or replace function public.handle_candidate(_name text, _email text default null)
returns text language sql immutable set search_path = public as $$
  select coalesce(nullif(substring(
    regexp_replace(
      lower(coalesce(nullif(btrim(_name),''), split_part(coalesce(_email,''),'@',1), 'member')),
      '[^a-z0-9_.]+', '', 'g') from 1 for 20), ''), 'member')
$$;

create or replace function public.unique_handle(_base text, _exclude uuid default null)
returns text language plpgsql stable set search_path = public as $$
declare _b text; _c text; _i int := 0; _suffix text;
begin
  _b := public.handle_candidate(_base);
  while length(_b) < 3 loop _b := _b || 'x'; end loop;
  _b := substring(_b from 1 for 20);
  _c := _b;
  loop
    exit when not exists (
      select 1 from public.profiles p
       where p.deleted_at is null
         and (_exclude is null or p.id <> _exclude)
         and public.normalize_handle(p.handle) = _c);
    _i := _i + 1;
    if _i > 200 then
      _suffix := substr(replace(gen_random_uuid()::text,'-',''), 1, 8);
      _c := substring(_b from 1 for 12) || _suffix;
      exit;
    end if;
    _suffix := _i::text;
    _c := substring(_b from 1 for least(length(_b), 20 - length(_suffix))) || _suffix;
  end loop;
  return _c;
end $$;

-- resolve existing cross-shop duplicates, keeping the oldest profile's handle
alter table public.profiles disable trigger user;
do $$
declare r record; _new text;
begin
  for r in
    select p.id, p.handle, p.full_name, p.email
      from public.profiles p
      join (
        select public.normalize_handle(handle) h, min(created_at) keep_at
          from public.profiles
         where handle is not null and deleted_at is null
         group by 1 having count(*) > 1
      ) d on d.h = public.normalize_handle(p.handle)
     where p.deleted_at is null and p.created_at > d.keep_at
  loop
    _new := public.unique_handle(r.handle, r.id);
    update public.profiles set handle = _new where id = r.id;
  end loop;

  for r in select id, full_name, email from public.profiles
            where deleted_at is null and public.normalize_handle(handle) is null
  loop
    _new := public.unique_handle(public.handle_candidate(r.full_name, r.email), r.id);
    update public.profiles set handle = _new where id = r.id;
  end loop;
end $$;
alter table public.profiles enable trigger user;

drop index if exists public.profiles_handle_unique;
create unique index profiles_handle_unique
  on public.profiles (lower(handle))
  where handle is not null and deleted_at is null;

create or replace function public.assign_profile_handle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.normalize_handle(new.handle) is null then
    new.handle := public.unique_handle(public.handle_candidate(new.full_name, new.email), new.id);
  else
    new.handle := public.normalize_handle(new.handle);
  end if;
  return new;
end $$;

drop trigger if exists profiles_assign_handle on public.profiles;
create trigger profiles_assign_handle
  before insert on public.profiles
  for each row execute function public.assign_profile_handle();

create or replace function public.handle_available(_handle text, _ecosystem_id uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare _h text := public.normalize_handle(_handle); _me uuid := auth.uid(); _current text; _has boolean;
begin
  if _me is null or _h is null then return false; end if;
  if _h !~ '^[a-z0-9_.]{3,20}$' then return false; end if;
  select public.normalize_handle(p.handle), true into _current, _has
    from public.profiles p where p.id = _me and p.deleted_at is null;
  if not coalesce(_has,false) then return false; end if;
  if _current is not null and _current = _h then return true; end if;
  return not exists (
    select 1 from public.profiles p
     where p.deleted_at is null and p.id <> _me
       and public.normalize_handle(p.handle) = _h);
end $$;

create or replace function public.update_own_profile(_full_name text default null, _handle text default null, _avatar_path text default null, _clear_avatar boolean default false, _bio text default null, _preferences jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _actor uuid := auth.uid();
  _old public.profiles%rowtype;
  _name text; _h text; _avatar text; _b text; _prefs jsonb; _changes jsonb := '{}'::jsonb;
begin
  if _actor is null then raise exception 'You must be signed in'; end if;
  select * into _old from public.profiles where id = _actor and deleted_at is null;
  if not found then raise exception 'Profile not found'; end if;

  _name := nullif(btrim(coalesce(_full_name, _old.full_name)), '');
  if _name is null then raise exception 'A display name is required'; end if;
  if length(_name) > 60 then raise exception 'That display name is too long'; end if;

  if _handle is null then
    _h := public.normalize_handle(_old.handle);
  else
    _h := public.normalize_handle(_handle);
    if _h is not null and _h !~ '^[a-z0-9_.]{3,20}$' then
      raise exception 'Handles use 3-20 letters, numbers, dots or underscores';
    end if;
  end if;
  -- every member keeps exactly one handle
  if _h is null then
    _h := coalesce(public.normalize_handle(_old.handle),
                   public.unique_handle(public.handle_candidate(_name, _old.email), _actor));
  end if;

  if _h is distinct from public.normalize_handle(_old.handle) and exists (
    select 1 from public.profiles p
     where p.deleted_at is null and p.id <> _actor
       and public.normalize_handle(p.handle) = _h
  ) then
    raise exception 'That handle is already taken';
  end if;

  if _clear_avatar then _avatar := null;
  else _avatar := coalesce(nullif(btrim(coalesce(_avatar_path,'')), ''), _old.avatar_path); end if;
  if _avatar is not null and _old.ecosystem_id is not null
     and split_part(_avatar, '/', 1) <> _old.ecosystem_id::text then
    raise exception 'Invalid avatar location';
  end if;

  if _bio is null then _b := _old.bio;
  else
    _b := nullif(btrim(_bio), '');
    if _b is not null and length(_b) > 280 then raise exception 'That bio is too long (280 characters maximum)'; end if;
  end if;

  if _preferences is null then _prefs := coalesce(_old.preferences, '{}'::jsonb);
  else
    if jsonb_typeof(_preferences) <> 'object' then raise exception 'Preferences must be an object'; end if;
    if length(_preferences::text) > 4000 then raise exception 'Preferences payload is too large'; end if;
    _prefs := coalesce(_old.preferences, '{}'::jsonb) || _preferences;
  end if;

  if _name is distinct from _old.full_name then
    _changes := _changes || jsonb_build_object('full_name', jsonb_build_object('from', _old.full_name, 'to', _name));
  end if;
  if _h is distinct from public.normalize_handle(_old.handle) then
    _changes := _changes || jsonb_build_object('handle', jsonb_build_object('from', _old.handle, 'to', _h));
  end if;
  if _avatar is distinct from _old.avatar_path then
    _changes := _changes || jsonb_build_object('avatar', jsonb_build_object('changed', true));
  end if;
  if _b is distinct from _old.bio then
    _changes := _changes || jsonb_build_object('bio', jsonb_build_object('changed', true));
  end if;
  if _prefs is distinct from coalesce(_old.preferences, '{}'::jsonb) then
    _changes := _changes || jsonb_build_object('preferences', jsonb_build_object('changed', true));
  end if;

  if _changes = '{}'::jsonb then
    return jsonb_build_object('changed', false, 'handle', _old.handle, 'avatar_path', _old.avatar_path);
  end if;

  update public.profiles
     set full_name = _name, handle = _h, avatar_path = _avatar, bio = _b,
         preferences = _prefs, updated_at = now()
   where id = _actor;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_old.ecosystem_id, _actor, _name, 'Updated own profile', _name,
          _changes || jsonb_build_object('user_id', _actor));

  return jsonb_build_object('changed', true, 'handle', _h, 'avatar_path', _avatar);
end $$;

-- ================================================ 2. SHOP VISIBILITY HIDES
create table if not exists public.social_post_shop_hides (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  hidden_by uuid not null,
  hidden_by_name text not null default '',
  reason text,
  created_at timestamptz not null default now(),
  unique (post_id, ecosystem_id)
);

grant select on public.social_post_shop_hides to authenticated;
grant all on public.social_post_shop_hides to service_role;
alter table public.social_post_shop_hides enable row level security;

drop policy if exists "Shop moderators read their hides" on public.social_post_shop_hides;
create policy "Shop moderators read their hides" on public.social_post_shop_hides
  for select to authenticated
  using (public.social_can_moderate(auth.uid(), ecosystem_id));

create or replace function public.social_hide_post_for_shop(_post_id uuid, _hidden boolean, _reason text default null, _eco uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _target uuid; _p public.social_posts; _me text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  _target := coalesce(_eco, public.current_ecosystem(auth.uid()));
  if _target is null then raise exception 'Choose a shop first'; end if;
  if not public.social_can_moderate(auth.uid(), _target) then raise exception 'Not allowed'; end if;
  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null then raise exception 'That post is not available'; end if;
  select full_name into _me from public.profiles where id = auth.uid();

  if coalesce(_hidden, true) then
    insert into public.social_post_shop_hides (post_id, ecosystem_id, hidden_by, hidden_by_name, reason)
    values (_p.id, _target, auth.uid(), coalesce(_me,''), nullif(btrim(coalesce(_reason,'')),''))
    on conflict (post_id, ecosystem_id) do update
      set hidden_by = excluded.hidden_by, hidden_by_name = excluded.hidden_by_name,
          reason = excluded.reason, created_at = now();
  else
    delete from public.social_post_shop_hides where post_id = _p.id and ecosystem_id = _target;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_target, auth.uid(), coalesce(_me,''),
          case when coalesce(_hidden,true) then 'Hid a community post from this shop'
               else 'Restored a community post for this shop' end,
          _p.id::text,
          jsonb_build_object('post_id', _p.id, 'ecosystem_id', _target,
                             'author_id', _p.author_id, 'reason', nullif(btrim(coalesce(_reason,'')),''),
                             'scope', 'shop_visibility'));
  return jsonb_build_object('post_id', _p.id, 'ecosystem_id', _target, 'hidden', coalesce(_hidden,true));
end $$;

create or replace function public.social_hidden_posts(_eco uuid default null)
returns table(post_id uuid, ecosystem_id uuid, hidden_by_name text, reason text, hidden_at timestamptz,
              author_name text, author_handle text, author_avatar text, body text, image_path text,
              post_created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare _target uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  _target := coalesce(_eco, public.current_ecosystem(auth.uid()));
  if _target is null or not public.social_can_moderate(auth.uid(), _target) then raise exception 'Not allowed'; end if;
  return query
  select h.post_id, h.ecosystem_id, h.hidden_by_name, h.reason, h.created_at,
         coalesce(a.full_name,'Member'), a.handle, a.avatar_path, p.body, p.image_path, p.created_at
    from public.social_post_shop_hides h
    join public.social_posts p on p.id = h.post_id
    join public.profiles a on a.id = p.author_id
   where h.ecosystem_id = _target and p.status = 'active'
   order by h.created_at desc
   limit 200;
end $$;

-- ============================================ 3. IMMEDIATE PUBLICATION
create or replace function public.social_post_visible_in(_post_id uuid, _eco uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts p
     where p.id = _post_id
       and p.status = 'active'
       and (
         (p.audience = 'ecosystem' and p.ecosystem_id = _eco)
         or p.audience = 'general'
         or (p.audience = 'shops' and exists (
              select 1 from public.social_post_distributions d
               where d.post_id = p.id and d.ecosystem_id = _eco and d.status = 'approved'))
       )
       and not exists (
         select 1 from public.social_post_shop_hides h
          where h.post_id = p.id and h.ecosystem_id = _eco)
  );
$$;

-- General posts publish everywhere immediately: no pending distributions.
update public.social_post_distributions set status = 'approved', auto_published = true,
       reviewed_at = coalesce(reviewed_at, now()),
       note = coalesce(note, 'Published automatically — shop approval is no longer required')
 where status = 'pending';

create or replace function public.social_create_post(_body text, _image_path text default null, _promote boolean default false, _tier_id uuid default null, _currency text default null, _audience text default 'ecosystem', _shop_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _eco uuid; _s jsonb; _post uuid; _cost integer; _cur text; _tx text; _acct uuid;
        _me text; _after integer; _t record; _reseller boolean; _hours integer; _prio integer;
        _tname text; _expires timestamptz; _aud text; _pending integer := 0; _live integer := 0;
        _targets uuid[];
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  perform public.require_operational();
  select ecosystem_id, full_name into _eco, _me from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;
  if length(btrim(coalesce(_body,''))) = 0 then raise exception 'Write something first'; end if;
  if _image_path is not null and split_part(_image_path, '/', 1) <> _eco::text then
    raise exception 'Invalid image location';
  end if;
  _aud := coalesce(nullif(btrim(coalesce(_audience,'')),''), 'ecosystem');
  if _aud not in ('ecosystem','general','shops') then raise exception 'Choose who can see this post'; end if;

  if _aud = 'shops' then
    select array_agg(distinct s) into _targets from unnest(coalesce(_shop_ids, '{}'::uuid[])) s;
    if _targets is null or array_length(_targets, 1) is null then
      raise exception 'Choose at least one shop to share with';
    end if;
    if exists (
      select 1 from unnest(_targets) s
       where not exists (
         select 1 from public.ecosystem_memberships m
          where m.user_id = auth.uid() and m.ecosystem_id = s and m.membership_state = 'active')
    ) then
      raise exception 'You can only share with shops you are an approved member of';
    end if;
  end if;

  perform public.social_rate_limit(auth.uid(), array['post','promotion'], interval '1 hour', 20);

  _s := public.social_effective_settings(_eco);
  if not (_s ->> 'social_enabled')::boolean then raise exception 'The community is currently disabled'; end if;
  perform public.social_wallet(auth.uid());
  _tx := public.new_tx_id();

  if coalesce(_promote,false) then
    if not (_s ->> 'promotion_enabled')::boolean then raise exception 'Promotion is currently disabled'; end if;
    _reseller := public.has_role(auth.uid(),'reseller') or public.has_role(auth.uid(),'subreseller')
                 or public.has_role(auth.uid(),'admin') or public.is_super_admin(auth.uid());
    if _tier_id is not null then
      select * into _t from public.social_tiers_for(_eco) t where t.id = _tier_id and t.active;
      if _t.id is null then raise exception 'That promotion is not available'; end if;
      if _t.eligibility = 'reseller' and not _reseller then
        raise exception 'That promotion is only available to resellers';
      end if;
      _cur := case when _t.currency = 'both' then coalesce(nullif(_currency,''), 'social') else _t.currency end;
      if _cur not in ('social','points') then raise exception 'Choose how to pay for the promotion'; end if;
      if _t.currency <> 'both' and _currency is not null and _currency <> _t.currency then
        raise exception 'That promotion must be paid in %', _t.currency;
      end if;
      _cost := case when _cur = 'points' then _t.price_points else _t.price_social end;
      _hours := _t.duration_hours; _prio := _t.priority; _tname := _t.name;
    else
      _cur := coalesce(nullif(_currency,''), _s ->> 'promotion_currency');
      _cost := case when _cur = 'points' then (_s ->> 'promotion_cost_points')::integer
                    else (_s ->> 'promotion_cost_social')::integer end;
      _hours := 24; _prio := 1; _tname := 'Promoted';
    end if;
    _expires := now() + make_interval(hours => _hours);
  else
    _cur := 'social';
    _cost := (_s ->> 'post_cost')::integer;
  end if;

  insert into public.social_posts (ecosystem_id, author_id, body, image_path, promoted,
                                   promotion_currency, promotion_cost, promotion_tier_id,
                                   promotion_tier_name, promotion_duration_hours,
                                   promotion_expires_at, promotion_priority, audience)
  values (_eco, auth.uid(), btrim(_body), _image_path, coalesce(_promote,false),
          case when coalesce(_promote,false) then _cur end,
          case when coalesce(_promote,false) then _cost end,
          case when coalesce(_promote,false) then _tier_id end,
          _tname, _hours, _expires, coalesce(_prio,0), _aud)
  returning id into _post;

  if _aud = 'general' then
    -- Published to the whole Universe immediately. Shop admins may later hide
    -- it for their own members; nothing waits for approval.
    insert into public.social_post_distributions (post_id, origin_ecosystem_id, ecosystem_id,
                                                  status, auto_published, reviewed_at, note)
    select _post, _eco, e.id, 'approved', true, now(),
           'Published automatically across the Universe'
      from public.ecosystems e
     where e.archived_at is null;
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Shared a post with all shops', _post::text,
            jsonb_build_object('approval_required', false));
  elsif _aud = 'shops' then
    insert into public.social_post_distributions (post_id, origin_ecosystem_id, ecosystem_id,
                                                  status, auto_published, reviewed_at, note)
    select _post, _eco, s, 'approved', true, now(),
           'Published in a shop the author belongs to'
      from unnest(_targets) s;
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Shared a post with selected shops', _post::text,
            jsonb_build_object('shops', array_length(_targets, 1)));
  end if;

  select count(*) filter (where status = 'pending'), count(*) filter (where status = 'approved')
    into _pending, _live
    from public.social_post_distributions where post_id = _post;

  if _cost > 0 then
    if _cur = 'points' then
      select id into _acct from public.points_accounts where user_id = auth.uid();
      if _acct is null then raise exception 'Points wallet not found'; end if;
      insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                        reason, reference, actor_id, tx_id, entry_type)
      values (_acct, auth.uid(), _eco, 'debit', _cost, 0, 'Promoted a community post', 'SOCIAL',
              auth.uid(), _tx, 'spend');
      _after := (public.social_wallet(auth.uid())).balance;
    else
      _after := public.social_move(auth.uid(), 'debit', _cost,
                 case when coalesce(_promote,false) then 'promotion' else 'post' end,
                 case when coalesce(_promote,false) then 'Promoted a community post' else 'Community post' end,
                 _post::text);
    end if;
  else
    _after := (public.social_wallet(auth.uid())).balance;
  end if;

  if coalesce(_promote,false) then
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Promoted a community post', _post::text,
            jsonb_build_object('cost', _cost, 'currency', _cur, 'tx_id', _tx,
                               'tier', _tname, 'duration_hours', _hours, 'expires_at', _expires));
  end if;

  return jsonb_build_object('post_id', _post, 'charged', _cost, 'currency', _cur,
                            'promoted', coalesce(_promote,false), 'tier', _tname,
                            'expires_at', _expires, 'balance', _after,
                            'audience', _aud, 'pending_shops', _pending, 'live_shops', _live);
end $$;

-- ================================================= 4. FEED + MODERATION
drop function if exists public.social_feed(integer, timestamptz);
create or replace function public.social_feed(_limit integer default 30, _before timestamptz default null)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text,
              body text, image_path text, promoted boolean, promotion_tier_name text,
              promotion_expires_at timestamptz, like_count integer, comment_count integer,
              liked_by_me boolean, created_at timestamptz, can_delete boolean, audience text,
              origin_ecosystem_name text, author_role text, can_hide boolean)
language plpgsql stable security definer set search_path = public as $$
declare _eco uuid; _mod boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select pr.ecosystem_id into _eco from public.profiles pr
   where pr.id = auth.uid() and pr.deleted_at is null;
  if _eco is null then return; end if;
  _mod := public.social_can_moderate(auth.uid(), _eco);
  return query
  select p.id, p.author_id, coalesce(a.full_name,'Member'), a.handle, a.avatar_path,
         p.body, p.image_path,
         (p.promoted and p.promotion_refunded_at is null
          and (p.promotion_expires_at is null or p.promotion_expires_at > now())),
         p.promotion_tier_name, p.promotion_expires_at,
         (select count(*)::integer from public.social_likes l
           where l.post_id = p.id and l.ecosystem_id = _eco),
         (select count(*)::integer from public.social_comments c
           where c.post_id = p.id and c.ecosystem_id = _eco and c.status = 'active'),
         exists (select 1 from public.social_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         (p.author_id = auth.uid() or public.is_super_admin(auth.uid())),
         p.audience,
         case when p.audience <> 'ecosystem' then eo.name end,
         case when public.is_super_admin(p.author_id) then 'super_admin'
              else coalesce(public.membership_role(p.author_id, p.ecosystem_id)::text, 'customer') end,
         (_mod and p.author_id <> auth.uid())
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
    join public.ecosystems eo on eo.id = p.ecosystem_id
   where p.status = 'active'
     and ((p.audience = 'ecosystem' and p.ecosystem_id = _eco)
          or p.audience = 'general'
          or (p.audience = 'shops' and exists (
                select 1 from public.social_post_distributions d
                 where d.post_id = p.id and d.ecosystem_id = _eco and d.status = 'approved')))
     and not exists (select 1 from public.social_post_shop_hides h
                      where h.post_id = p.id and h.ecosystem_id = _eco)
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
                         or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
     and (_before is null or p.created_at < _before)
   order by case when p.promoted and p.promotion_refunded_at is null
                  and (p.promotion_expires_at is null or p.promotion_expires_at > now())
                 then p.promotion_priority else -1 end desc,
            p.created_at desc
   limit least(coalesce(_limit,30), 50);
end $$;

-- Global deletion: author or platform owner only. Shop admins hide instead.
create or replace function public.social_delete_post(_post_id uuid, _reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare _p public.social_posts; _me text;
begin
  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null then raise exception 'That post is not available'; end if;
  if _p.author_id <> auth.uid() and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the author or the platform owner can delete this post';
  end if;
  update public.social_posts set status = 'removed', removed_by = auth.uid(),
         removed_reason = nullif(btrim(coalesce(_reason,'')),''), removed_at = now(), updated_at = now()
   where id = _p.id;
  select full_name into _me from public.profiles where id = auth.uid();
  if _p.author_id <> auth.uid() then
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_p.ecosystem_id, auth.uid(), coalesce(_me,''), 'Deleted a community post platform-wide', _p.id::text,
            jsonb_build_object('post_id', _p.id, 'author_id', _p.author_id,
                               'reason', nullif(btrim(coalesce(_reason,'')),''),
                               'scope', 'platform', 'deleted_at', now()));
  end if;
end $$;

-- ================================================= 5. THREADED REPLIES
alter table public.social_comments
  add column if not exists parent_id uuid references public.social_comments(id) on delete cascade,
  add column if not exists depth integer not null default 1;

do $$ begin
  alter table public.social_comments add constraint social_comments_depth_check check (depth between 1 and 3);
exception when duplicate_object then null; end $$;

create index if not exists social_comments_parent_idx on public.social_comments (parent_id);

create or replace function public.social_create_comment(_post_id uuid, _body text, _parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _eco uuid; _p public.social_posts; _s jsonb; _cid uuid; _after integer;
        _parent public.social_comments; _depth integer := 1;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  perform public.require_operational();
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;
  if length(btrim(coalesce(_body,''))) = 0 then raise exception 'Write something first'; end if;
  perform public.social_rate_limit(auth.uid(), array['comment'], interval '1 hour', 60);

  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null or not public.social_post_visible_in(_p.id, _eco) then
    raise exception 'That post is not available';
  end if;
  if exists (select 1 from public.social_blocks
              where (blocker_id = _p.author_id and blocked_id = auth.uid())
                 or (blocker_id = auth.uid() and blocked_id = _p.author_id)) then
    raise exception 'You cannot reply to this member';
  end if;

  if _parent_id is not null then
    select * into _parent from public.social_comments
     where id = _parent_id and post_id = _p.id and status = 'active';
    if _parent.id is null then raise exception 'That reply is no longer available'; end if;
    _depth := coalesce(_parent.depth, 1) + 1;
    if _depth > 3 then
      raise exception 'Replies can only go three levels deep';
    end if;
  end if;

  _s := public.social_effective_settings(_eco);
  if not (_s ->> 'social_enabled')::boolean then raise exception 'The community is currently disabled'; end if;

  insert into public.social_comments (post_id, ecosystem_id, author_id, body, charged, parent_id, depth)
  values (_p.id, _eco, auth.uid(), btrim(_body), false, _parent_id, _depth)
  returning id into _cid;
  update public.social_posts set comment_count = comment_count + 1 where id = _p.id;

  _after := (public.social_wallet(auth.uid())).free_balance + (public.social_wallet(auth.uid())).balance;
  return jsonb_build_object('comment_id', _cid, 'charged', 0, 'balance', _after, 'depth', _depth);
end $$;

drop function if exists public.social_post_comments(uuid);
create or replace function public.social_post_comments(_post_id uuid)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text,
              body text, created_at timestamptz, can_delete boolean, parent_id uuid, depth integer)
language plpgsql stable security definer set search_path = public as $$
declare _eco uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  return query
  select c.id, c.author_id, coalesce(a.full_name,'Member'), a.handle, a.avatar_path, c.body, c.created_at,
         (c.author_id = auth.uid() or public.social_can_moderate(auth.uid(), c.ecosystem_id)),
         c.parent_id, c.depth
    from public.social_comments c
    join public.profiles a on a.id = c.author_id
   where c.post_id = _post_id and c.ecosystem_id = _eco and c.status = 'active'
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = c.author_id)
                         or (b.blocker_id = c.author_id and b.blocked_id = auth.uid()))
   order by c.created_at;
end $$;

-- ============================================ 6. MENTIONS + PUBLIC PROFILE
create or replace function public.social_handle_search(_q text, _limit integer default 8)
returns table(user_id uuid, full_name text, handle text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.handle, p.avatar_path
    from public.profiles p
   where auth.uid() is not null
     and p.deleted_at is null
     and p.handle is not null
     and (public.normalize_handle(p.handle) like public.normalize_handle(_q) || '%'
          or lower(p.full_name) like '%' || lower(btrim(coalesce(_q,''))) || '%')
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
                         or (b.blocker_id = p.id and b.blocked_id = auth.uid()))
   order by length(p.handle), p.handle
   limit least(coalesce(_limit,8), 20)
$$;

-- Public Universe profile: identity only. Never wallets, balances, earnings,
-- transactions or messages.
create or replace function public.universe_profile(_handle text)
returns table(user_id uuid, full_name text, handle text, avatar_path text, bio text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.handle, p.avatar_path, p.bio, p.joined_at
    from public.profiles p
   where auth.uid() is not null
     and p.deleted_at is null
     and public.normalize_handle(p.handle) = public.normalize_handle(_handle)
   limit 1
$$;

revoke all on function public.social_handle_search(text, integer) from anon;
revoke all on function public.universe_profile(text) from anon;
grant execute on function public.social_handle_search(text, integer) to authenticated;
grant execute on function public.universe_profile(text) to authenticated;
grant execute on function public.social_hide_post_for_shop(uuid, boolean, text, uuid) to authenticated;
grant execute on function public.social_hidden_posts(uuid) to authenticated;
grant execute on function public.social_create_comment(uuid, text, uuid) to authenticated;