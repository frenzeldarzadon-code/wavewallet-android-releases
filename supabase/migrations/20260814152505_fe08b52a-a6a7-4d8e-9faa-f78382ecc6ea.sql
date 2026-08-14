create or replace function public.universe_profile(_handle text)
returns table(user_id uuid, full_name text, handle text, avatar_path text, bio text,
              joined_at timestamptz, is_platform boolean)
language sql stable security definer set search_path to 'public'
as $$
  with v as (
    select p.*,
           (public.is_super_admin(p.id) and p.id <> auth.uid()
            and not public.is_super_admin(auth.uid())) as masked
      from public.profiles p
     where auth.uid() is not null
       and p.deleted_at is null
       and public.normalize_handle(p.handle) = public.normalize_handle(_handle)
     limit 1
  )
  select case when v.masked then null::uuid else v.id end,
         case when v.masked then 'WaveWallet Super Admin' else v.full_name end,
         case when v.masked then null else v.handle end,
         case when v.masked then null else v.avatar_path end,
         case when v.masked then 'Official WaveWallet platform account.' else v.bio end,
         v.joined_at,
         v.masked
    from v
$$;

create or replace function public.universe_profile_posts(_handle text, _limit integer default 30)
returns table(id uuid, body text, image_path text, created_at timestamptz,
              like_count integer, comment_count integer, audience text)
language sql stable security definer set search_path to 'public'
as $$
  select sp.id, sp.body, sp.image_path, sp.created_at,
         sp.like_count, sp.comment_count, sp.audience
    from public.social_posts sp
    join public.profiles p on p.id = sp.author_id
   where auth.uid() is not null
     and p.deleted_at is null
     and public.normalize_handle(p.handle) = public.normalize_handle(_handle)
     and sp.status = 'published'
     and sp.audience = 'general'
     and (not public.is_super_admin(p.id)
          or p.id = auth.uid()
          or public.is_super_admin(auth.uid()))
   order by sp.created_at desc
   limit least(coalesce(_limit, 30), 100)
$$;

revoke all on function public.universe_profile(text) from public, anon;
revoke all on function public.universe_profile_posts(text, integer) from public, anon;
grant execute on function public.universe_profile(text) to authenticated;
grant execute on function public.universe_profile_posts(text, integer) to authenticated;