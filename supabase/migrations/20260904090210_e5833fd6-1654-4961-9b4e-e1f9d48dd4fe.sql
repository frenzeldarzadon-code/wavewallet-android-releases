-- 1) Visibility helpers: audience no longer matters. Only active status,
--    blocks and per-shop moderation hides remain.
create or replace function public.social_post_visible_to(_post_id uuid, _user uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select _user is not null and exists (
    select 1 from public.social_posts p
     where p.id = _post_id and p.status = 'active'
       and (
         p.author_id = _user
         or public.is_super_admin(_user)
         or (
           public.is_universe_member(_user)
           and not exists (select 1 from public.social_post_shop_hides h
                            where h.post_id = p.id and h.ecosystem_id = any(public.social_member_shops(_user)))
           and not exists (select 1 from public.social_blocks b
                            where (b.blocker_id = _user and b.blocked_id = p.author_id)
                               or (b.blocker_id = p.author_id and b.blocked_id = _user))
         )));
$function$;

create or replace function public.social_post_visible_in(_post_id uuid, _eco uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.social_posts p
     where p.id = _post_id
       and p.status = 'active'
       and not exists (
         select 1 from public.social_post_shop_hides h
          where h.post_id = p.id and h.ecosystem_id = _eco)
  );
$function$;

-- 2) Feed: every active post for every Universe member.
create or replace function public.social_feed(_limit integer default 30, _before timestamptz default null, _hashtag text default null)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, image_path text, promoted boolean, promotion_tier_name text, promotion_expires_at timestamptz, like_count integer, comment_count integer, liked_by_me boolean, created_at timestamptz, can_delete boolean, audience text, origin_ecosystem_name text, author_role text, can_hide boolean, video_path text, meta jsonb, hashtags text[])
language plpgsql stable security definer set search_path to 'public'
as $function$
declare _eco uuid; _mod boolean; _vs boolean; _ecos uuid[]; _tag text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_universe_member(auth.uid()) then raise exception 'Your account is not active'; end if;
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
         'general'::text,
         eo.name,
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

-- 3) Profile history: all active posts by that member.
create or replace function public.universe_profile_posts(_handle text, _limit integer default 30)
returns table(id uuid, body text, image_path text, created_at timestamptz, like_count integer, comment_count integer, audience text)
language sql stable security definer set search_path to 'public'
as $function$
  select sp.id, sp.body, sp.image_path, sp.created_at,
         sp.like_count, sp.comment_count, 'general'::text
    from public.social_posts sp
    join public.profiles p on p.id = sp.author_id
   where auth.uid() is not null
     and p.deleted_at is null
     and public.normalize_handle(p.handle) = public.normalize_handle(_handle)
     and sp.status = 'active'
     and (not public.is_super_admin(p.id)
          or p.id = auth.uid()
          or public.is_super_admin(auth.uid()))
   order by sp.created_at desc
   limit least(coalesce(_limit, 30), 100)
$function$;

-- 4) Create post: audience and shop lists are accepted for compatibility but ignored.
create or replace function public.social_create_post(_body text, _image_path text default null, _promote boolean default false, _tier_id uuid default null, _currency text default null, _audience text default 'general', _shop_ids uuid[] default null, _video_path text default null, _meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _eco uuid; _s jsonb; _post uuid; _tx text;
        _me text; _after integer; _t record; _reseller boolean; _hours integer; _prio integer;
        _tname text; _expires timestamptz; _live integer := 0;
        _clean jsonb; _tags text[]; _folder text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  if not public.is_universe_member(auth.uid()) then raise exception 'Your account is not active'; end if;
  -- Universe is the customer portal: no shop membership, role or approval is
  -- required to post, and every post is public to the whole Universe.
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

  perform public.social_rate_limit(auth.uid(), array['post','promotion'], interval '1 hour', 20);

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
          _tname, _hours, _expires, coalesce(_prio,0), 'general', true)
  returning id into _post;

  -- Distribution rows are kept only as the per-shop moderation ledger (hide/unhide).
  insert into public.social_post_distributions (post_id, origin_ecosystem_id, ecosystem_id,
                                                status, auto_published, reviewed_at, note)
  select _post, _eco, e.id, 'approved', true, now(), 'Public to the whole Universe'
    from public.ecosystems e
   where e.archived_at is null;
  get diagnostics _live = row_count;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,''), 'Shared a post with the whole Universe', _post::text,
          jsonb_build_object('approval_required', false));

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
                            'audience', 'general', 'pending_shops', 0, 'live_shops', _live);
end $function$;

-- 5) Existing posts become Universe-wide.
update public.social_posts set audience = 'general' where audience is distinct from 'general';