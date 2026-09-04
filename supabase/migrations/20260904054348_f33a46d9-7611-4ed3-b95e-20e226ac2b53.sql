-- Universe media visibility: post photos/videos and profile avatars are
-- readable by whoever can already see the post / profile, not only by
-- members of the uploader's current shop.

create or replace function public.social_media_visible(_name text, _user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select _user is not null and (
    public.is_super_admin(_user)
    -- the uploader's own folder (<shop>/<user>/<file>)
    or (storage.foldername(_name))[2] = _user::text
    -- shop admins moderate media posted under their shop
    or ((storage.foldername(_name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and public.is_ecosystem_admin(_user, ((storage.foldername(_name))[1])::uuid))
    -- attached to an active community post the viewer can see in the feed
    or exists (
      select 1 from public.social_posts p
       where (p.image_path = _name or p.video_path = _name)
         and p.status = 'active'
         and (
           p.author_id = _user
           or public.social_post_visible_in(p.id, public.current_ecosystem(_user))
           or exists (
             select 1 from public.ecosystem_memberships m
              where m.user_id = _user and m.membership_state = 'active'
                and public.social_post_visible_in(p.id, m.ecosystem_id))
         )
         and not exists (
           select 1 from public.social_blocks b
            where (b.blocker_id = _user and b.blocked_id = p.author_id)
               or (b.blocker_id = p.author_id and b.blocked_id = _user))
    )
    -- attached to a private message in a thread the viewer belongs to
    or exists (
      select 1 from public.dm_messages dm
       where dm.image_path = _name
         and public.dm_is_active_member(dm.thread_id, _user))
  );
$$;

revoke all on function public.social_media_visible(text, uuid) from public, anon;
grant execute on function public.social_media_visible(text, uuid) to authenticated, service_role;

drop policy if exists "Shop members view social images" on storage.objects;
create policy "Members view social media they can see"
  on storage.objects for select to authenticated
  using (bucket_id = 'social-images' and public.social_media_visible(name, auth.uid()));

-- Avatars / profile covers are Universe-wide identity: any signed-in member
-- may view the picture a live profile currently uses. Replaced or orphaned
-- files stay unreadable to everyone but the owner.
create or replace function public.profile_media_visible(_name text, _user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select _user is not null and (
    public.is_super_admin(_user)
    or (storage.foldername(_name))[2] = _user::text
    or exists (
      select 1 from public.profiles pr
       where pr.deleted_at is null
         and (pr.avatar_path = _name or pr.cover_path = _name))
  );
$$;

revoke all on function public.profile_media_visible(text, uuid) from public, anon;
grant execute on function public.profile_media_visible(text, uuid) to authenticated, service_role;

drop policy if exists "Shop members view avatars" on storage.objects;
create policy "Members view profile pictures"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.profile_media_visible(name, auth.uid()));