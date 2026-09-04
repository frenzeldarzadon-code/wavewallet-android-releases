-- Universe posts are globally public within the authenticated Universe.
-- Per-shop hides no longer affect visibility anywhere.

create or replace function public.social_post_visible_to(_post_id uuid, _user uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select _user is not null and exists (
    select 1 from public.social_posts p
     where p.id = _post_id and p.status = 'active'
       and (
         p.author_id = _user
         or public.is_super_admin(_user)
         or (
           public.is_universe_member(_user)
           and not exists (select 1 from public.social_blocks b
                            where (b.blocker_id = _user and b.blocked_id = p.author_id)
                               or (b.blocker_id = p.author_id and b.blocked_id = _user))
         )));
$function$;

create or replace function public.social_post_visible_in(_post_id uuid, _eco uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- Shop scope is ignored: Universe posts are public to every Universe member.
  select exists (select 1 from public.social_posts p where p.id = _post_id and p.status = 'active');
$function$;

create or replace function public.social_feed(_limit integer default 30, _before timestamp with time zone default null, _hashtag text default null)
 returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, image_path text, promoted boolean, promotion_tier_name text, promotion_expires_at timestamp with time zone, like_count integer, comment_count integer, liked_by_me boolean, created_at timestamp with time zone, can_delete boolean, audience text, origin_ecosystem_name text, author_role text, can_hide boolean, video_path text, meta jsonb, hashtags text[])
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare _vs boolean; _tag text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_universe_member(auth.uid()) then raise exception 'Your account is not active'; end if;
  _tag := nullif(lower(regexp_replace(coalesce(_hashtag,''), '^#', '')), '');
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
         false,  -- per-shop hiding is retired
         p.video_path, p.meta, p.hashtags
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
    left join public.ecosystems eo on eo.id = p.ecosystem_id
   where p.status = 'active'
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

-- Retire the per-shop hide action: it can no longer create hides.
create or replace function public.social_hide_post_for_shop(_post_id uuid, _hidden boolean, _reason text default null, _eco uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  raise exception 'Universe posts are public to every Universe member and cannot be hidden per shop. Report the post instead.';
end $function$;

revoke execute on function public.social_hide_post_for_shop(uuid, boolean, text, uuid) from anon, authenticated;
revoke execute on function public.social_hidden_posts(uuid) from anon;