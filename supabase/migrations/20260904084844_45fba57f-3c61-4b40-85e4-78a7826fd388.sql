-- 1. Recently active Universe members (presence-first). Reuses member_presence +
--    presence_online_window(); no new presence mechanism.
create or replace function public.universe_online_members(_limit integer default 40)
returns table(id uuid, full_name text, handle text, avatar_path text, online boolean, last_seen_at timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select p.id, coalesce(p.full_name,'Member'), p.handle, p.avatar_path,
         (mp.last_seen_at > now() - public.presence_online_window()) as online,
         date_trunc('minute', mp.last_seen_at) as last_seen_at
    from public.member_presence mp
    join public.profiles p on p.id = mp.user_id
   where auth.uid() is not null
     and p.id <> auth.uid()
     and p.deleted_at is null
     and p.status = 'active'
     and mp.last_seen_at > now() - interval '7 days'
     and (not coalesce(p.is_demo,false) or coalesce((select is_demo from public.profiles where id = auth.uid()), false))
     and (not public.is_super_admin(p.id) or public.is_super_admin(auth.uid()))
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
                         or (b.blocker_id = p.id and b.blocked_id = auth.uid()))
   order by online desc, mp.last_seen_at desc, p.full_name
   limit least(greatest(coalesce(_limit, 40), 1), 100)
$$;
revoke all on function public.universe_online_members(integer) from public, anon;
grant execute on function public.universe_online_members(integer) to authenticated, service_role;

-- 2. Batch relationship state (same rules as universe_relationship / my_social_graph).
create or replace function public.universe_relationship_batch(_users uuid[])
returns table(user_id uuid, following boolean, friend_status text, friend_request_id uuid)
language sql stable security definer set search_path to 'public'
as $$
  select u,
         exists (select 1 from public.social_follows s where s.follower_id = auth.uid() and s.followee_id = u),
         coalesce((select case when f.status = 'accepted' then 'friends'
                               when f.status = 'pending' and f.requester_id = auth.uid() then 'requested'
                               when f.status = 'pending' then 'incoming'
                               else 'none' end
                     from public.social_friendships f
                    where least(f.requester_id, f.addressee_id) = least(auth.uid(), u)
                      and greatest(f.requester_id, f.addressee_id) = greatest(auth.uid(), u)), 'none'),
         (select f.id from public.social_friendships f
           where f.status in ('pending','accepted')
             and least(f.requester_id, f.addressee_id) = least(auth.uid(), u)
             and greatest(f.requester_id, f.addressee_id) = greatest(auth.uid(), u))
    from unnest(coalesce(_users, '{}'::uuid[])) u
   where auth.uid() is not null and u <> auth.uid()
$$;
revoke all on function public.universe_relationship_batch(uuid[]) from public, anon;
grant execute on function public.universe_relationship_batch(uuid[]) to authenticated, service_role;

-- 3. Order-chat labels for threads the caller is an active member of.
create or replace function public.dm_order_chat_context(_thread_ids uuid[])
returns table(thread_id uuid, order_no text, status text, fulfillment_status text, shop_name text, shop_slug text)
language sql stable security definer set search_path to 'public'
as $$
  select t.id, o.order_no::text, o.status::text, o.fulfillment_status::text, e.name, e.slug
    from public.dm_threads t
    join public.retail_orders o on o.id = t.order_id
    left join public.ecosystems e on e.id = o.ecosystem_id
   where auth.uid() is not null
     and t.kind = 'order'
     and t.id = any(coalesce(_thread_ids, '{}'::uuid[]))
     and public.dm_is_active_member(t.id, auth.uid())
$$;
revoke all on function public.dm_order_chat_context(uuid[]) from public, anon;
grant execute on function public.dm_order_chat_context(uuid[]) to authenticated, service_role;

-- 4. Directory: demo viewers may find demo members (real members still never see demo accounts).
create or replace function public.universe_directory(_query text default null, _province text default null, _city_municipality text default null, _barangay text default null, _limit integer default 30)
returns table(id uuid, full_name text, handle text, avatar_path text, province text, city_municipality text, barangay text)
language sql stable security definer set search_path to 'public'
as $$
  select p.id, p.full_name, p.handle, p.avatar_path,
         p.province, p.city_municipality, p.barangay
    from public.profiles p
   where auth.uid() is not null
     and p.deleted_at is null
     and p.id <> auth.uid()
     and (coalesce(p.is_demo, false) = false
          or coalesce((select d.is_demo from public.profiles d where d.id = auth.uid()), false))
     and (not public.is_super_admin(p.id) or public.is_super_admin(auth.uid()))
     and (nullif(btrim(coalesce(_query,'')),'') is null
          or lower(p.full_name) like '%' || lower(btrim(_query)) || '%'
          or lower(coalesce(p.handle,'')) like '%' || coalesce(public.normalize_handle(_query),'') || '%')
     and (nullif(btrim(coalesce(_province,'')),'') is null
          or lower(coalesce(p.province,'')) = lower(btrim(_province)))
     and (nullif(btrim(coalesce(_city_municipality,'')),'') is null
          or lower(coalesce(p.city_municipality,'')) like '%' || lower(btrim(_city_municipality)) || '%')
     and (nullif(btrim(coalesce(_barangay,'')),'') is null
          or lower(coalesce(p.barangay,'')) like '%' || lower(btrim(_barangay)) || '%')
   order by p.full_name
   limit least(greatest(coalesce(_limit, 30), 1), 50)
$$;