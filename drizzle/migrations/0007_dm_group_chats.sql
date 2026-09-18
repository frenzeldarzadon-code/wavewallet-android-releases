-- Group chats reuse the existing dm_threads/dm_thread_members/dm_messages primitives.
alter table public.dm_threads drop constraint if exists dm_threads_kind_check;
alter table public.dm_threads add constraint dm_threads_kind_check
  check (kind = any (array['direct'::text, 'order'::text, 'group'::text]));

create or replace function public.dm_create_group(_title text, _member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _id uuid; _m uuid; _clean uuid[];
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  if length(btrim(coalesce(_title,''))) = 0 then raise exception 'Give the group a name'; end if;
  if length(btrim(_title)) > 80 then raise exception 'That group name is too long'; end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into _clean
    from unnest(coalesce(_member_ids, '{}'::uuid[])) as x
   where x is not null and x <> auth.uid();

  if array_length(_clean, 1) is null then raise exception 'Add at least one member'; end if;
  if array_length(_clean, 1) > 50 then raise exception 'A group can hold up to 50 members'; end if;
  if not public.is_universe_member(auth.uid()) then raise exception 'That member is not available'; end if;

  foreach _m in array _clean loop
    if public.is_super_admin(_m) or not public.is_universe_member(_m) then
      raise exception 'One of those members is not available';
    end if;
    if exists (select 1 from public.social_blocks
                where (blocker_id = _m and blocked_id = auth.uid())
                   or (blocker_id = auth.uid() and blocked_id = _m)) then
      raise exception 'You cannot add a member you have blocked';
    end if;
  end loop;

  insert into public.dm_threads (ecosystem_id, user_a, user_b, kind, title)
  values (null, null, null, 'group', btrim(_title))
  returning id into _id;

  insert into public.dm_thread_members (thread_id, user_id, member_role)
  values (_id, auth.uid(), 'owner');
  insert into public.dm_thread_members (thread_id, user_id, member_role)
  select _id, m, 'member' from unnest(_clean) as m
  on conflict do nothing;

  return _id;
end $function$;

revoke all on function public.dm_create_group(text, uuid[]) from public, anon;
grant execute on function public.dm_create_group(text, uuid[]) to authenticated;

-- Posting: order chats unchanged; group chats accept the same call.
create or replace function public.dm_send_thread(_thread_id uuid, _body text, _image_path text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _t public.dm_threads; _mid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  if length(btrim(coalesce(_body,''))) = 0 and _image_path is null then raise exception 'Write a message first'; end if;
  if length(coalesce(_body,'')) > 2000 then raise exception 'That message is too long'; end if;
  if (select count(*) from public.dm_messages
       where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'You are sending messages too quickly — please slow down';
  end if;
  select * into _t from public.dm_threads t where t.id = _thread_id;
  if _t.id is null or _t.kind not in ('order','group') then raise exception 'Conversation not found'; end if;
  if not public.dm_is_active_member(_thread_id, auth.uid()) then raise exception 'You are not part of this conversation'; end if;
  if _image_path is not null then
    if _t.kind = 'order' then
      if split_part(_image_path, '/', 1) <> _t.ecosystem_id::text then
        raise exception 'Invalid image location';
      end if;
    else
      -- Group photos must come from the sender's own media folder.
      if split_part(_image_path, '/', 2) <> auth.uid()::text then
        raise exception 'Invalid image location';
      end if;
    end if;
  end if;
  insert into public.dm_messages (thread_id, ecosystem_id, sender_id, recipient_id, body, image_path)
  values (_t.id, _t.ecosystem_id, auth.uid(), null, btrim(coalesce(_body,'')), _image_path)
  returning id into _mid;
  update public.dm_threads
     set last_message_at = now(),
         last_message_preview = coalesce(nullif(left(btrim(coalesce(_body,'')), 120), ''), 'Photo')
   where id = _t.id;
  update public.dm_thread_members set last_read_at = now() where thread_id = _t.id and user_id = auth.uid();
  return jsonb_build_object('thread_id', _t.id, 'message_id', _mid);
end $function$;

-- Thread list: group threads join the member-based branch alongside order chats.
create or replace function public.dm_thread_list()
returns table(thread_id uuid, member_id uuid, member_name text, member_handle text, member_avatar text, last_message_at timestamp with time zone, preview text, unread integer, blocked boolean, kind text, order_id uuid, title text, participants jsonb, member_online boolean)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  return query
  select * from (
    select t.id as thread_id,
           other.id as member_id, coalesce(other.full_name,'Member') as member_name,
           other.handle as member_handle, other.avatar_path as member_avatar,
           t.last_message_at, t.last_message_preview as preview,
           (select count(*)::int from public.dm_messages m
             where m.thread_id = t.id and m.recipient_id = auth.uid() and m.read_at is null) as unread,
           exists (select 1 from public.social_blocks b
                    where (b.blocker_id = auth.uid() and b.blocked_id = other.id)
                       or (b.blocker_id = other.id and b.blocked_id = auth.uid())) as blocked,
           t.kind, t.order_id, t.title, '[]'::jsonb as participants,
           coalesce((select mp.last_seen_at > now() - interval '2 minutes'
                       from public.member_presence mp where mp.user_id = other.id), false) as member_online
      from public.dm_threads t
      join public.profiles other
        on other.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
     where t.kind = 'direct' and auth.uid() in (t.user_a, t.user_b)
    union all
    select t.id, null::uuid, null::text, null::text, null::text,
           t.last_message_at, t.last_message_preview,
           (select count(*)::int from public.dm_messages m
             where m.thread_id = t.id and m.sender_id <> auth.uid()
               and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz)),
           false, t.kind, t.order_id, t.title,
           coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.full_name,'Member'),
                                                         'handle', p.handle, 'avatar', p.avatar_path, 'role', mm.member_role)
                                      order by mm.added_at)
                       from public.dm_thread_members mm join public.profiles p on p.id = mm.user_id
                      where mm.thread_id = t.id and mm.removed_at is null), '[]'::jsonb),
           false
      from public.dm_threads t
      join public.dm_thread_members me on me.thread_id = t.id and me.user_id = auth.uid() and me.removed_at is null
     where t.kind in ('order','group')
  ) x
  order by coalesce(x.last_message_at, now()) desc;
end $function$;

-- Notifications: direct messages unchanged; group posts notify the other members.
create or replace function public.tg_notify_dm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _name text; _kind text; _title text; _r record;
begin
  select coalesce(full_name, 'Someone') into _name from public.profiles where id = NEW.sender_id;
  select t.kind, t.title into _kind, _title from public.dm_threads t where t.id = NEW.thread_id;

  if NEW.recipient_id is not null and NEW.recipient_id <> NEW.sender_id then
    perform public.notify_universe(NEW.recipient_id, 'dm_message', 'New private message',
      _name || ' sent you a message', '/universe/messages?thread=' || NEW.thread_id::text);
    return NEW;
  end if;

  if _kind = 'group' then
    for _r in select user_id from public.dm_thread_members
               where thread_id = NEW.thread_id and removed_at is null and user_id <> NEW.sender_id
    loop
      perform public.notify_universe(_r.user_id, 'dm_message', coalesce(_title, 'Group chat'),
        _name || ' sent a message', '/universe/messages?thread=' || NEW.thread_id::text);
    end loop;
  end if;
  return NEW;
end $function$;