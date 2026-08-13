
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'social\_%' or p.proname like 'dm\_%')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
  end loop;
end $$;

grant execute on function public.social_state() to authenticated;
grant execute on function public.social_can_moderate(uuid, uuid) to authenticated;
grant execute on function public.update_social_settings(integer,integer,integer,integer,integer,boolean,text,integer,integer,boolean,integer,integer) to authenticated;
grant execute on function public.social_exchange(text, integer) to authenticated;
grant execute on function public.social_claim_ad_reward(text, text) to authenticated;
grant execute on function public.social_create_post(text, text, boolean) to authenticated;
grant execute on function public.social_create_comment(uuid, text) to authenticated;
grant execute on function public.social_toggle_like(uuid) to authenticated;
grant execute on function public.social_feed(integer, timestamptz) to authenticated;
grant execute on function public.social_post_comments(uuid) to authenticated;
grant execute on function public.social_delete_post(uuid, text) to authenticated;
grant execute on function public.social_delete_comment(uuid, text) to authenticated;
grant execute on function public.social_report(text, uuid, text) to authenticated;
grant execute on function public.social_review_report(uuid, text) to authenticated;
grant execute on function public.social_set_block(uuid, boolean) to authenticated;
grant execute on function public.dm_open_thread(uuid) to authenticated;
grant execute on function public.dm_send(uuid, text) to authenticated;
grant execute on function public.dm_thread_list() to authenticated;
grant execute on function public.dm_messages_for(uuid) to authenticated;
grant execute on function public.dm_unread_count() to authenticated;
grant execute on function public.social_admin_activity(uuid, integer) to authenticated;
grant execute on function public.social_admin_reports(uuid) to authenticated;
