CREATE OR REPLACE FUNCTION public.social_post_comments(_post_id uuid)
 RETURNS TABLE(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, created_at timestamp with time zone, can_delete boolean, parent_id uuid, depth integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eco uuid; _vs boolean; _me uuid := auth.uid();
begin
  if _me is null then raise exception 'You must be signed in'; end if;
  select pr.ecosystem_id into _eco from public.profiles pr where pr.id = _me and pr.deleted_at is null;
  _vs := public.is_super_admin(_me);
  if not public.social_post_visible_in(_post_id, _eco)
     and not exists (select 1 from public.social_posts sp where sp.id = _post_id and sp.author_id = _me) then
    return;
  end if;
  return query
  select c.id,
         case when public.is_super_admin(c.author_id) and not _vs then null::uuid else c.author_id end,
         case when public.is_super_admin(c.author_id) and not _vs then 'WaveWallet Super Admin' else coalesce(a.full_name,'Member') end,
         case when public.is_super_admin(c.author_id) and not _vs then null else a.handle end,
         case when public.is_super_admin(c.author_id) and not _vs then null else a.avatar_path end,
         c.body, c.created_at,
         (c.author_id = _me or public.social_can_moderate(_me, c.ecosystem_id)),
         c.parent_id, c.depth
    from public.social_comments c
    join public.profiles a on a.id = c.author_id
   where c.post_id = _post_id and c.status = 'active'
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = _me and b.blocked_id = c.author_id)
                         or (b.blocker_id = c.author_id and b.blocked_id = _me))
   order by c.created_at;
end $function$;