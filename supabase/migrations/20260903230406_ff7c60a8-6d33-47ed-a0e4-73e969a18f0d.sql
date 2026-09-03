alter table public.social_posts
  add column if not exists video_path text,
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists hashtags text[] not null default '{}'::text[];

create index if not exists social_posts_hashtags_idx on public.social_posts using gin (hashtags);

alter table public.social_posts drop constraint if exists social_post_body;
alter table public.social_posts add constraint social_post_body check (
  length(btrim(body)) <= 2000
  and (length(btrim(body)) >= 1 or image_path is not null or video_path is not null)
);
alter table public.social_posts drop constraint if exists social_post_meta_size;
alter table public.social_posts add constraint social_post_meta_size check (pg_column_size(meta) <= 4096);

-- Hashtags: 2-40 word characters after '#', at a word boundary, lowercased, unique.
create or replace function public.social_extract_hashtags(_body text)
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}'::text[])
    from regexp_matches(coalesce(_body,''), '(?:^|[\s(\[{])#([A-Za-z0-9_]{2,40})', 'g') m
$$;
revoke all on function public.social_extract_hashtags(text) from public, anon;
grant execute on function public.social_extract_hashtags(text) to authenticated;

-- Keep only known keys, capped lengths, approximate (2-decimal) coordinates.
create or replace function public.social_clean_post_meta(_meta jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $$
declare _out jsonb := '{}'::jsonb; _loc jsonb; _f jsonb; _lat numeric; _lng numeric; _label text;
begin
  if _meta is null or jsonb_typeof(_meta) <> 'object' then return '{}'::jsonb; end if;

  _loc := _meta -> 'location';
  if _loc is not null and jsonb_typeof(_loc) = 'object' then
    _label := left(btrim(coalesce(_loc ->> 'label','')), 80);
    if length(_label) >= 2 then
      _lat := null; _lng := null;
      if jsonb_typeof(_loc -> 'lat') = 'number' and jsonb_typeof(_loc -> 'lng') = 'number' then
        _lat := round((_loc ->> 'lat')::numeric, 2);
        _lng := round((_loc ->> 'lng')::numeric, 2);
        if _lat < -90 or _lat > 90 or _lng < -180 or _lng > 180 then _lat := null; _lng := null; end if;
      end if;
      _out := _out || jsonb_strip_nulls(jsonb_build_object('location',
                jsonb_build_object('label', _label, 'lat', _lat, 'lng', _lng)));
    end if;
  end if;

  _f := _meta -> 'feeling';
  if _f is not null and jsonb_typeof(_f) = 'object'
     and length(btrim(coalesce(_f ->> 'label',''))) between 1 and 40 then
    _out := _out || jsonb_build_object('feeling', jsonb_build_object(
      'kind', case when _f ->> 'kind' = 'activity' then 'activity' else 'feeling' end,
      'label', left(btrim(_f ->> 'label'), 40),
      'emoji', left(coalesce(_f ->> 'emoji',''), 8)));
  end if;

  if jsonb_typeof(_meta -> 'style') = 'string' and (_meta ->> 'style') ~ '^[a-z0-9_-]{1,32}$' then
    _out := _out || jsonb_build_object('style', _meta ->> 'style');
  end if;

  if jsonb_typeof(_meta -> 'dm_invite') = 'boolean' and (_meta ->> 'dm_invite')::boolean then
    _out := _out || jsonb_build_object('dm_invite', true);
  end if;
  return _out;
end $$;
revoke all on function public.social_clean_post_meta(jsonb) from public, anon;
grant execute on function public.social_clean_post_meta(jsonb) to authenticated;

drop function if exists public.social_create_post(text, text, boolean, uuid, text, text, uuid[]);

create or replace function public.social_create_post(
  _body text,
  _image_path text default null,
  _promote boolean default false,
  _tier_id uuid default null,
  _currency text default null,
  _audience text default 'ecosystem',
  _shop_ids uuid[] default null,
  _video_path text default null,
  _meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _eco uuid; _s jsonb; _post uuid; _tx text;
        _me text; _after integer; _t record; _reseller boolean; _hours integer; _prio integer;
        _tname text; _expires timestamptz; _aud text; _pending integer := 0; _live integer := 0;
        _targets uuid[]; _clean jsonb; _tags text[];
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  perform public.require_operational();
  select ecosystem_id, full_name into _eco, _me from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;
  if length(btrim(coalesce(_body,''))) = 0 and _image_path is null and _video_path is null then
    raise exception 'Write something or attach a photo or video first';
  end if;
  if length(btrim(coalesce(_body,''))) > 2000 then raise exception 'Posts can be at most 2000 characters'; end if;
  if _image_path is not null and split_part(_image_path, '/', 1) <> _eco::text then
    raise exception 'Invalid image location';
  end if;
  if _video_path is not null and (split_part(_video_path, '/', 1) <> _eco::text
     or split_part(_video_path, '/', 2) <> auth.uid()::text) then
    raise exception 'Invalid video location';
  end if;
  _clean := public.social_clean_post_meta(_meta);
  _tags := public.social_extract_hashtags(_body);
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

  -- Promotion decides placement and duration only. It is never charged:
  -- Universe members do not spend coins, social credits or points to post or
  -- to promote. Nothing below ever writes a debit.
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
                            'free_post', true,
                            'free_posts_left', 0,
                            'audience', _aud, 'pending_shops', _pending, 'live_shops', _live);
end $function$;
revoke all on function public.social_create_post(text, text, boolean, uuid, text, text, uuid[], text, jsonb) from public, anon;
grant execute on function public.social_create_post(text, text, boolean, uuid, text, text, uuid[], text, jsonb) to authenticated;

drop function if exists public.social_feed(integer, timestamptz);

create or replace function public.social_feed(_limit integer default 30, _before timestamptz default null, _hashtag text default null)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, image_path text, promoted boolean, promotion_tier_name text, promotion_expires_at timestamptz, like_count integer, comment_count integer, liked_by_me boolean, created_at timestamptz, can_delete boolean, audience text, origin_ecosystem_name text, author_role text, can_hide boolean, video_path text, meta jsonb, hashtags text[])
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare _eco uuid; _mod boolean; _vs boolean; _ecos uuid[]; _tag text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select pr.ecosystem_id into _eco from public.profiles pr
   where pr.id = auth.uid() and pr.deleted_at is null;

  select coalesce(array_agg(distinct m.ecosystem_id), '{}')
    into _ecos
    from public.ecosystem_memberships m
   where m.user_id = auth.uid() and m.membership_state = 'active';
  if _eco is not null and not (_eco = any(_ecos)) then
    _ecos := _ecos || _eco;
  end if;

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
         (select count(*)::integer from public.social_comments c
           where c.post_id = p.id and c.status = 'active'),
         exists (select 1 from public.social_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         (p.author_id = auth.uid() or public.is_super_admin(auth.uid())),
         p.audience,
         case when p.audience <> 'ecosystem' then eo.name end,
         case
           when public.is_super_admin(p.author_id) then case when _vs then 'super_admin' else null end
           when public.can_view_role(auth.uid(), p.author_id)
             then coalesce(public.membership_role(p.author_id, p.ecosystem_id)::text, 'customer')
           else null
         end,
         (_mod and p.author_id <> auth.uid()),
         p.video_path, p.meta, p.hashtags
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
    join public.ecosystems eo on eo.id = p.ecosystem_id
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
end $function$;
revoke all on function public.social_feed(integer, timestamptz, text) from public, anon;
grant execute on function public.social_feed(integer, timestamptz, text) to authenticated;