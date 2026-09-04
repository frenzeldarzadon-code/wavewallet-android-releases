-- ============================================================================
-- Universe social access model: shop membership never gates Universe social.
-- ============================================================================

-- 1. Schema: shop columns become optional on global social records ----------
alter table public.social_posts               alter column ecosystem_id drop not null;
alter table public.social_comments            alter column ecosystem_id drop not null;
alter table public.social_likes               alter column ecosystem_id drop not null;
alter table public.social_blocks              alter column ecosystem_id drop not null;
alter table public.social_reports             alter column ecosystem_id drop not null;
alter table public.social_post_distributions  alter column origin_ecosystem_id drop not null;
alter table public.dm_threads                 alter column ecosystem_id drop not null;
alter table public.dm_messages                alter column ecosystem_id drop not null;

-- One direct conversation per pair of members, Universe-wide.
alter table public.dm_threads drop constraint if exists dm_threads_ecosystem_id_user_a_user_b_key;
create unique index if not exists dm_threads_direct_pair_key
  on public.dm_threads (user_a, user_b) where kind = 'direct';

alter table public.social_posts alter column audience set default 'general';

-- 2. Predicates --------------------------------------------------------------
create or replace function public.is_universe_member(_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _user is not null and exists (
    select 1 from public.profiles p
     where p.id = _user and p.deleted_at is null and p.status = 'active');
$$;
revoke all on function public.is_universe_member(uuid) from public, anon;
grant execute on function public.is_universe_member(uuid) to authenticated, service_role;

-- Shops a member belongs to (active memberships + current profile shop).
create or replace function public.social_member_shops(_user uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
    select m.ecosystem_id as x from public.ecosystem_memberships m
     where m.user_id = _user and m.membership_state = 'active'
    union
    select p.ecosystem_id from public.profiles p where p.id = _user and p.ecosystem_id is not null
  ) s;
$$;
revoke all on function public.social_member_shops(uuid) from public, anon;
grant execute on function public.social_member_shops(uuid) to authenticated, service_role;

-- Can this Universe member see this post? General posts: every member.
-- Shop-only / selected-shop posts: members of those shops. Own posts: always.
-- Per-shop hides apply to members of the hiding shop. Blocks apply both ways.
create or replace function public.social_post_visible_to(_post_id uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _user is not null and exists (
    select 1 from public.social_posts p
     where p.id = _post_id and p.status = 'active'
       and (
         p.author_id = _user
         or public.is_super_admin(_user)
         or (
           (p.audience = 'general'
            or (p.audience = 'ecosystem' and p.ecosystem_id = any(public.social_member_shops(_user)))
            or (p.audience = 'shops' and exists (
                  select 1 from public.social_post_distributions d
                   where d.post_id = p.id and d.status = 'approved'
                     and d.ecosystem_id = any(public.social_member_shops(_user)))))
           and not exists (select 1 from public.social_post_shop_hides h
                            where h.post_id = p.id and h.ecosystem_id = any(public.social_member_shops(_user)))
           and not exists (select 1 from public.social_blocks b
                            where (b.blocker_id = _user and b.blocked_id = p.author_id)
                               or (b.blocker_id = p.author_id and b.blocked_id = _user))
         )));
$$;
revoke all on function public.social_post_visible_to(uuid, uuid) from public, anon;
grant execute on function public.social_post_visible_to(uuid, uuid) to authenticated, service_role;

-- 3. RLS: readable by whoever can see the post ------------------------------
drop policy if exists "Shop members read posts" on public.social_posts;
create policy "Universe members read visible posts" on public.social_posts
  for select to authenticated
  using (public.is_super_admin(auth.uid()) or public.social_post_visible_to(id, auth.uid())
         or exists (select 1 from public.social_post_distributions d
                     where d.post_id = social_posts.id and public.is_ecosystem_admin(auth.uid(), d.ecosystem_id)));

drop policy if exists "Shop members read comments" on public.social_comments;
create policy "Universe members read visible replies" on public.social_comments
  for select to authenticated
  using (public.is_super_admin(auth.uid()) or author_id = auth.uid()
         or public.social_post_visible_to(post_id, auth.uid()));

drop policy if exists "Shop members read likes" on public.social_likes;
create policy "Universe members read visible likes" on public.social_likes
  for select to authenticated
  using (public.is_super_admin(auth.uid()) or user_id = auth.uid()
         or public.social_post_visible_to(post_id, auth.uid()));

-- Storage: zero-shop members upload under universe/<user>/...; deletes stay
-- owner / admin / platform owner (uuid cast guarded).
drop policy if exists "Members upload social images" on storage.objects;
create policy "Members upload social images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'social-images'
    and (storage.foldername(name))[2] = auth.uid()::text
    and ((storage.foldername(name))[1] = 'universe'
         or (storage.foldername(name))[1] = public.current_ecosystem(auth.uid())::text
         or ((storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
             and ((storage.foldername(name))[1])::uuid = any(public.social_member_shops(auth.uid())))));

drop policy if exists "Members or admins delete social images" on storage.objects;
create policy "Members or admins delete social images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'social-images'
    and ((storage.foldername(name))[2] = auth.uid()::text
         or public.is_super_admin(auth.uid())
         or ((storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
             and public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid))));

create or replace function public.social_media_visible(_name text, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _user is not null and (
    public.is_super_admin(_user)
    or (storage.foldername(_name))[2] = _user::text
    or ((storage.foldername(_name))[1] ~ '^[0-9a-fA-F-]{36}$'
        and public.is_ecosystem_admin(_user, ((storage.foldername(_name))[1])::uuid))
    or exists (select 1 from public.social_posts p
                where (p.image_path = _name or p.video_path = _name)
                  and public.social_post_visible_to(p.id, _user))
    or exists (select 1 from public.dm_messages dm
                where dm.image_path = _name
                  and (dm.sender_id = _user or dm.recipient_id = _user
                       or public.dm_is_active_member(dm.thread_id, _user)))
  );
$$;

-- 4. Post / reply / like -----------------------------------------------------
create or replace function public.social_create_post(_body text, _image_path text default null, _promote boolean default false, _tier_id uuid default null, _currency text default null, _audience text default 'general', _shop_ids uuid[] default null, _video_path text default null, _meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _eco uuid; _s jsonb; _post uuid; _tx text;
        _me text; _after integer; _t record; _reseller boolean; _hours integer; _prio integer;
        _tname text; _expires timestamptz; _aud text; _pending integer := 0; _live integer := 0;
        _targets uuid[]; _clean jsonb; _tags text[]; _folder text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  if not public.is_universe_member(auth.uid()) then raise exception 'Your account is not active'; end if;
  -- Universe is the customer portal: no shop membership and no shop
  -- operational state is required to post. _eco is only the optional origin.
  select ecosystem_id, full_name into _eco, _me from public.profiles where id = auth.uid() and deleted_at is null;
  if length(btrim(coalesce(_body,''))) = 0 and _image_path is null and _video_path is null then
    raise exception 'Write something or attach a photo or video first';
  end if;
  if length(btrim(coalesce(_body,''))) > 2000 then raise exception 'Posts can be at most 2000 characters'; end if;
  if _image_path is not null then
    _folder := split_part(_image_path, '/', 1);
    if split_part(_image_path, '/', 2) <> auth.uid()::text
       or not (_folder = 'universe' or (_folder ~ '^[0-9a-fA-F-]{36}$' and _folder::uuid = any(public.social_member_shops(auth.uid())))) then
      raise exception 'Invalid image location';
    end if;
  end if;
  if _video_path is not null then
    _folder := split_part(_video_path, '/', 1);
    if split_part(_video_path, '/', 2) <> auth.uid()::text
       or not (_folder = 'universe' or (_folder ~ '^[0-9a-fA-F-]{36}$' and _folder::uuid = any(public.social_member_shops(auth.uid())))) then
      raise exception 'Invalid video location';
    end if;
  end if;
  _clean := public.social_clean_post_meta(_meta);
  _tags := public.social_extract_hashtags(_body);
  _aud := coalesce(nullif(btrim(coalesce(_audience,'')),''), 'general');
  if _aud not in ('ecosystem','general','shops') then raise exception 'Choose who can see this post'; end if;
  if _aud = 'ecosystem' and _eco is null then
    raise exception 'You are not part of a shop — share with the whole Universe instead';
  end if;

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

  -- Platform-wide settings only: a shop's own toggle never silences a member's Universe voice.
  _s := public.social_effective_settings(null);
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
      _hours := _t.duration_hours; _prio := _t.priority; _tname := _t.name;
    else
      _hours := 24; _prio := 1; _tname := 'Promoted';
    end if;
    _expires := now() + make_interval(hours => _hours);
  end if;

  insert into public.social_posts (ecosystem_id, author_id, body, image_path, video_path, meta, hashtags, promoted,
                                   promotion_currency, promotion_cost, promotion_tier_id,
                                   promotion_tier_name, promotion_duration_hours,
                                   promotion_expires_at, promotion_priority, audience, used_free_post)
  values (_eco, auth.uid(), btrim(coalesce(_body,'')), _image_path, _video_path, _clean, _tags, coalesce(_promote,false),
          case when coalesce(_promote,false) then 'social' end,
          case when coalesce(_promote,false) then 0 end,
          case when coalesce(_promote,false) then _tier_id end,
          _tname, _hours, _expires, coalesce(_prio,0), _aud, true)
  returning id into _post;

  if _aud = 'general' then
    insert into public.social_post_distributions (post_id, origin_ecosystem_id, ecosystem_id,
                                                  status, auto_published, reviewed_at, note)
    select _post, _eco, e.id, 'approved', true, now(),
           'Published automatically across the Universe'
      from public.ecosystems e
     where e.archived_at is null;
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Shared a post with the whole Universe', _post::text,
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

  _after := (public.social_wallet(auth.uid())).balance;

  if coalesce(_promote,false) then
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Promoted a community post', _post::text,
            jsonb_build_object('cost', 0, 'currency', 'social', 'tx_id', _tx,
                               'tier', _tname, 'duration_hours', _hours, 'expires_at', _expires));
  end if;

  return jsonb_build_object('post_id', _post, 'charged', 0, 'currency', 'social',
                            'promoted', coalesce(_promote,false), 'tier', _tname,
                            'expires_at', _expires, 'balance', _after,
                            'free_post', true, 'free_posts_left', 0,
                            'audience', _aud, 'pending_shops', _pending, 'live_shops', _live);
end $$;

create or replace function public.social_create_comment(_post_id uuid, _body text, _parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _eco uuid; _p public.social_posts; _s jsonb; _cid uuid; _after integer;
        _parent public.social_comments; _depth integer := 1;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  if not public.is_universe_member(auth.uid()) then raise exception 'Your account is not active'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if length(btrim(coalesce(_body,''))) = 0 then raise exception 'Write something first'; end if;
  perform public.social_rate_limit(auth.uid(), array['comment'], interval '1 hour', 60);

  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null or not public.social_post_visible_to(_p.id, auth.uid()) then
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
    if _depth > 3 then raise exception 'Replies can only go three levels deep'; end if;
  end if;

  _s := public.social_effective_settings(null);
  if not (_s ->> 'social_enabled')::boolean then raise exception 'The community is currently disabled'; end if;

  -- Replies live with the post's shop context (moderation), never the replier's.
  insert into public.social_comments (post_id, ecosystem_id, author_id, body, charged, parent_id, depth)
  values (_p.id, _p.ecosystem_id, auth.uid(), btrim(_body), false, _parent_id, _depth)
  returning id into _cid;
  update public.social_posts set comment_count = comment_count + 1 where id = _p.id;

  _after := (public.social_wallet(auth.uid())).free_balance + (public.social_wallet(auth.uid())).balance;
  return jsonb_build_object('comment_id', _cid, 'charged', 0, 'balance', _after, 'depth', _depth);
end $$;

create or replace function public.social_toggle_like(_post_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _p public.social_posts; _liked boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null or not public.social_post_visible_to(_p.id, auth.uid()) then
    raise exception 'That post is not available';
  end if;
  if exists (select 1 from public.social_likes where post_id = _p.id and user_id = auth.uid()) then
    delete from public.social_likes where post_id = _p.id and user_id = auth.uid();
    update public.social_posts set like_count = greatest(like_count - 1, 0) where id = _p.id;
    _liked := false;
  else
    if (select count(*) from public.social_likes
         where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 200 then
      raise exception 'You are doing that too often — please try again later';
    end if;
    insert into public.social_likes (post_id, user_id, ecosystem_id) values (_p.id, auth.uid(), _p.ecosystem_id);
    update public.social_posts set like_count = like_count + 1 where id = _p.id;
    _liked := true;
  end if;
  return jsonb_build_object('liked', _liked,
    'likes', (select count(*)::integer from public.social_likes l where l.post_id = _p.id));
end; $$;

-- 5. Feed / replies ----------------------------------------------------------
create or replace function public.social_feed(_limit integer default 30, _before timestamptz default null, _hashtag text default null)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, image_path text, promoted boolean, promotion_tier_name text, promotion_expires_at timestamptz, like_count integer, comment_count integer, liked_by_me boolean, created_at timestamptz, can_delete boolean, audience text, origin_ecosystem_name text, author_role text, can_hide boolean, video_path text, meta jsonb, hashtags text[])
language plpgsql stable security definer set search_path = public as $$
declare _eco uuid; _mod boolean; _vs boolean; _ecos uuid[]; _tag text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select pr.ecosystem_id into _eco from public.profiles pr where pr.id = auth.uid() and pr.deleted_at is null;
  _ecos := public.social_member_shops(auth.uid());
  _tag := nullif(lower(regexp_replace(coalesce(_hashtag,''), '^#', '')), '');
  _mod := _eco is not null and public.social_can_moderate(auth.uid(), _eco);
  _vs := public.is_super_admin(auth.uid());
  return query
  select p.id,
         case when public.is_super_admin(p.author_id) and not _vs then null::uuid else p.author_id end,
         case when public.is_super_admin(p.author_id) and not _vs then 'WaveWallet Super Admin' else coalesce(a.full_name,'Member') end,
         case when public.is_super_admin(p.author_id) and not _vs then null else a.handle end,
         case when public.is_super_admin(p.author_id) and not _vs then null else a.avatar_path end,
         p.body, p.image_path,
         (p.promoted and p.promotion_refunded_at is null
          and (p.promotion_expires_at is null or p.promotion_expires_at > now())),
         p.promotion_tier_name, p.promotion_expires_at,
         (select count(*)::integer from public.social_likes l where l.post_id = p.id),
         (select count(*)::integer from public.social_comments c where c.post_id = p.id and c.status = 'active'),
         exists (select 1 from public.social_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         (p.author_id = auth.uid() or public.is_super_admin(auth.uid())),
         p.audience,
         case when p.audience <> 'ecosystem' then eo.name end,
         case
           when public.is_super_admin(p.author_id) then case when _vs then 'super_admin' else null end
           when p.ecosystem_id is not null and public.can_view_role(auth.uid(), p.author_id)
             then coalesce(public.membership_role(p.author_id, p.ecosystem_id)::text, 'customer')
           else null
         end,
         (_mod and p.author_id <> auth.uid()),
         p.video_path, p.meta, p.hashtags
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
    left join public.ecosystems eo on eo.id = p.ecosystem_id
   where p.status = 'active'
     and ((p.audience = 'ecosystem' and p.ecosystem_id = any(_ecos))
          or p.audience = 'general'
          or (p.audience = 'shops' and exists (
                select 1 from public.social_post_distributions d
                 where d.post_id = p.id and d.ecosystem_id = any(_ecos) and d.status = 'approved'))
          or p.author_id = auth.uid())
     and not exists (select 1 from public.social_post_shop_hides h
                      where h.post_id = p.id and h.ecosystem_id = any(_ecos))
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
                         or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
     and (_before is null or p.created_at < _before)
     and (_tag is null or _tag = any(p.hashtags))
   order by case when p.promoted and p.promotion_refunded_at is null
                  and (p.promotion_expires_at is null or p.promotion_expires_at > now())
                 then p.promotion_priority else -1 end desc,
            p.created_at desc
   limit least(coalesce(_limit,30), 50);
end $$;

create or replace function public.social_post_comments(_post_id uuid)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, created_at timestamptz, can_delete boolean, parent_id uuid, depth integer)
language plpgsql stable security definer set search_path = public as $$
declare _vs boolean; _me uuid := auth.uid();
begin
  if _me is null then raise exception 'You must be signed in'; end if;
  _vs := public.is_super_admin(_me);
  if not public.social_post_visible_to(_post_id, _me) then return; end if;
  return query
  select c.id,
         case when public.is_super_admin(c.author_id) and not _vs then null::uuid else c.author_id end,
         case when public.is_super_admin(c.author_id) and not _vs then 'WaveWallet Super Admin' else coalesce(a.full_name,'Member') end,
         case when public.is_super_admin(c.author_id) and not _vs then null else a.handle end,
         case when public.is_super_admin(c.author_id) and not _vs then null else a.avatar_path end,
         c.body, c.created_at,
         (c.author_id = _me or (c.ecosystem_id is not null and public.social_can_moderate(_me, c.ecosystem_id))),
         c.parent_id, c.depth
    from public.social_comments c
    join public.profiles a on a.id = c.author_id
   where c.post_id = _post_id and c.status = 'active'
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = _me and b.blocked_id = c.author_id)
                         or (b.blocker_id = c.author_id and b.blocked_id = _me))
   order by c.created_at;
end $$;

-- Shop moderation queue tolerates zero-shop authors.
create or replace function public.social_general_queue(_eco uuid default null, _status text default 'pending')
returns table(id uuid, post_id uuid, status text, note text, created_at timestamptz, reviewed_at timestamptz, reviewed_by_name text, ecosystem_id uuid, origin_ecosystem_name text, author_name text, author_handle text, author_avatar text, body text, image_path text, post_created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare _target uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  _target := coalesce(_eco, public.current_ecosystem(auth.uid()));
  if _target is null or not public.social_can_moderate(auth.uid(), _target) then
    raise exception 'Not allowed';
  end if;
  return query
  select d.id, d.post_id, d.status, d.note, d.created_at, d.reviewed_at, d.reviewed_by_name,
         d.ecosystem_id, coalesce(eo.name, 'Universe'), coalesce(a.full_name,'Member'), a.handle, a.avatar_path,
         p.body, p.image_path, p.created_at
    from public.social_post_distributions d
    join public.social_posts p on p.id = d.post_id
    join public.profiles a on a.id = p.author_id
    left join public.ecosystems eo on eo.id = d.origin_ecosystem_id
   where d.ecosystem_id = _target
     and p.status = 'active'
     and (coalesce(_status,'pending') = 'all' or d.status = coalesce(_status,'pending'))
   order by d.created_at desc
   limit 200;
end; $$;

-- 6. Report / block / private messages: Universe-wide ------------------------
create or replace function public.social_report(_target_type text, _target_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare _eco uuid; _target_user uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_universe_member(auth.uid()) then raise exception 'Your account is not active'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if length(btrim(coalesce(_reason,''))) < 3 then raise exception 'Tell us briefly what is wrong'; end if;
  if (select count(*) from public.social_reports
       where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have reported too many items today';
  end if;

  if _target_type = 'post' then
    select author_id into _target_user from public.social_posts
     where id = _target_id and public.social_post_visible_to(id, auth.uid());
  elsif _target_type = 'comment' then
    select c.author_id into _target_user from public.social_comments c
     where c.id = _target_id and public.social_post_visible_to(c.post_id, auth.uid());
  elsif _target_type = 'message' then
    select sender_id into _target_user from public.dm_messages
     where id = _target_id and recipient_id = auth.uid();
  elsif _target_type = 'member' then
    select id into _target_user from public.profiles
     where id = _target_id and deleted_at is null and not public.is_super_admin(id);
  else
    raise exception 'Unknown report target';
  end if;
  if _target_user is null then raise exception 'That item is not available'; end if;

  insert into public.social_reports (ecosystem_id, reporter_id, target_type, target_id, target_user_id, reason)
  values (_eco, auth.uid(), _target_type, _target_id, _target_user, btrim(_reason));
end; $$;

create or replace function public.social_set_block(_member_id uuid, _blocked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare _eco uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if _member_id = auth.uid() then raise exception 'You cannot block yourself'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if not exists (select 1 from public.profiles where id = _member_id and deleted_at is null) then
    raise exception 'That member is not available';
  end if;
  if _blocked then
    insert into public.social_blocks (ecosystem_id, blocker_id, blocked_id)
    values (_eco, auth.uid(), _member_id) on conflict (blocker_id, blocked_id) do nothing;
  else
    delete from public.social_blocks where blocker_id = auth.uid() and blocked_id = _member_id;
  end if;
end; $$;

create or replace function public.dm_open_thread(_member_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare _a uuid; _b uuid; _id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  if _member_id = auth.uid() then raise exception 'Pick another member'; end if;
  if public.is_super_admin(_member_id) then raise exception 'That member is not available'; end if;
  -- Any two active Universe members may talk, whatever shops they belong to.
  if not public.is_universe_member(auth.uid()) or not public.is_universe_member(_member_id) then
    raise exception 'That member is not available';
  end if;
  if exists (select 1 from public.social_blocks
              where (blocker_id = _member_id and blocked_id = auth.uid())
                 or (blocker_id = auth.uid() and blocked_id = _member_id)) then
    raise exception 'You cannot message this member';
  end if;
  _a := least(auth.uid(), _member_id); _b := greatest(auth.uid(), _member_id);
  select t.id into _id from public.dm_threads t
   where t.kind = 'direct' and t.user_a = _a and t.user_b = _b;
  if _id is null then
    insert into public.dm_threads (ecosystem_id, user_a, user_b, kind) values (null, _a, _b, 'direct')
      on conflict do nothing;
    select t.id into _id from public.dm_threads t
     where t.kind = 'direct' and t.user_a = _a and t.user_b = _b;
  end if;
  return _id;
end; $$;

create or replace function public.dm_send(_member_id uuid, _body text, _image_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _thread uuid; _eco uuid; _mid uuid;
begin
  if length(btrim(coalesce(_body,''))) = 0 and _image_path is null then
    raise exception 'Write a message first';
  end if;
  if length(coalesce(_body,'')) > 2000 then raise exception 'That message is too long'; end if;
  if (select count(*) from public.dm_messages
       where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'You are sending messages too quickly — please slow down';
  end if;
  _thread := public.dm_open_thread(_member_id);
  select ecosystem_id into _eco from public.dm_threads where id = _thread;
  -- The photo must come from the sender's own folder (<shop|universe>/<sender>/...).
  if _image_path is not null and split_part(_image_path, '/', 2) <> auth.uid()::text then
    raise exception 'Invalid image location';
  end if;
  insert into public.dm_messages (thread_id, ecosystem_id, sender_id, recipient_id, body, image_path)
  values (_thread, _eco, auth.uid(), _member_id, btrim(coalesce(_body,'')), _image_path)
  returning id into _mid;
  update public.dm_threads
     set last_message_at = now(),
         last_message_preview = coalesce(nullif(left(btrim(coalesce(_body,'')), 120), ''), 'Photo')
   where id = _thread;
  return jsonb_build_object('thread_id', _thread, 'message_id', _mid);
end; $$;

create or replace function public.dm_send(_member_id uuid, _body text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public.dm_send(_member_id, _body, null);
end; $$;