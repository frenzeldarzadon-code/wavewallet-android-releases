CREATE OR REPLACE FUNCTION public.social_feed(_limit integer DEFAULT 30, _before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, image_path text, promoted boolean, promotion_tier_name text, promotion_expires_at timestamp with time zone, like_count integer, comment_count integer, liked_by_me boolean, created_at timestamp with time zone, can_delete boolean, audience text, origin_ecosystem_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eco uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select pr.ecosystem_id into _eco from public.profiles pr
   where pr.id = auth.uid() and pr.deleted_at is null;
  if _eco is null then return; end if;
  return query
  select p.id, p.author_id, coalesce(a.full_name,'Member'), a.handle, a.avatar_path,
         p.body, p.image_path,
         (p.promoted and p.promotion_refunded_at is null
          and (p.promotion_expires_at is null or p.promotion_expires_at > now())),
         p.promotion_tier_name, p.promotion_expires_at,
         (select count(*)::integer from public.social_likes l
           where l.post_id = p.id and l.ecosystem_id = _eco),
         (select count(*)::integer from public.social_comments c
           where c.post_id = p.id and c.ecosystem_id = _eco and c.status = 'active'),
         exists (select 1 from public.social_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         ((p.author_id = auth.uid() or public.social_can_moderate(auth.uid(), p.ecosystem_id))
          and (p.audience = 'ecosystem' or p.ecosystem_id = _eco
               or public.is_super_admin(auth.uid()))),
         p.audience,
         case when p.audience = 'general' then eo.name end
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
    join public.ecosystems eo on eo.id = p.ecosystem_id
   where p.status = 'active'
     and ((p.audience = 'ecosystem' and p.ecosystem_id = _eco)
          or (p.audience = 'general' and exists (
                select 1 from public.social_post_distributions d
                 where d.post_id = p.id and d.ecosystem_id = _eco and d.status = 'approved')))
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
                         or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
     and (_before is null or p.created_at < _before)
   order by case when p.promoted and p.promotion_refunded_at is null
                  and (p.promotion_expires_at is null or p.promotion_expires_at > now())
                 then p.promotion_priority else -1 end desc,
            p.created_at desc
   limit least(coalesce(_limit,30), 50);
end; $function$;