create or replace function public.retail_cod_fallback_days() returns integer
language sql immutable set search_path = public as $$ select 3 $$;

drop function if exists public.dm_thread_list();
create function public.dm_thread_list()
returns table(thread_id uuid, member_id uuid, member_name text, member_handle text, member_avatar text,
              last_message_at timestamptz, preview text, unread integer, blocked boolean,
              kind text, order_id uuid, title text, participants jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  return query
  select * from (
    select t.id as thread_id,
           other.id as member_id, coalesce(other.full_name,'Member') as member_name, other.handle as member_handle, other.avatar_path as member_avatar,
           t.last_message_at, t.last_message_preview as preview,
           (select count(*)::int from public.dm_messages m
             where m.thread_id = t.id and m.recipient_id = auth.uid() and m.read_at is null) as unread,
           exists (select 1 from public.social_blocks b
                    where (b.blocker_id = auth.uid() and b.blocked_id = other.id)
                       or (b.blocker_id = other.id and b.blocked_id = auth.uid())) as blocked,
           t.kind, t.order_id, t.title, '[]'::jsonb as participants
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
           false,
           t.kind, t.order_id, t.title,
           coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.full_name,'Member'),
                                                         'handle', p.handle, 'avatar', p.avatar_path, 'role', mm.member_role)
                                      order by mm.added_at)
                       from public.dm_thread_members mm join public.profiles p on p.id = mm.user_id
                      where mm.thread_id = t.id and mm.removed_at is null), '[]'::jsonb)
      from public.dm_threads t
      join public.dm_thread_members me on me.thread_id = t.id and me.user_id = auth.uid() and me.removed_at is null
     where t.kind = 'order'
  ) x
  order by coalesce(x.last_message_at, now()) desc;
end $$;

revoke execute on function public.update_retail_delivery_settings(uuid, boolean, numeric, integer, integer) from public, anon;
revoke execute on function public.retail_cod_quote(uuid, numeric) from public, anon;
revoke execute on function public.retail_cod_seller_funded(uuid, numeric) from public, anon;
revoke execute on function public.retail_order_chat(uuid) from public, anon;
revoke execute on function public.retail_cod_manager(public.retail_orders, uuid) from public, anon;
revoke execute on function public.retail_cod_assignees(uuid) from public, anon;
revoke execute on function public.retail_cod_assign(uuid, boolean, uuid, uuid) from public, anon;
revoke execute on function public.retail_cod_collector_respond(uuid, boolean) from public, anon;
revoke execute on function public.retail_cod_cash_received(uuid, numeric) from public, anon;
revoke execute on function public.retail_cod_seller_release(uuid) from public, anon;
revoke execute on function public.retail_cod_seller_cancel(uuid, text) from public, anon;
revoke execute on function public.retail_cod_resolve_discrepancy(uuid, text, text) from public, anon;
revoke execute on function public.retail_cod_held_total() from public, anon;
revoke execute on function public.retail_my_cod_assignments() from public, anon;
revoke execute on function public.dm_send_thread(uuid, text, text) from public, anon;
revoke execute on function public.dm_is_active_member(uuid, uuid) from public, anon;
revoke execute on function public.dm_thread_list() from public, anon;