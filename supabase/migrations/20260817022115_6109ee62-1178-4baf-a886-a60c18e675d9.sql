
create or replace function public.can_view_role(_viewer uuid, _subject uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select _viewer is not null and _subject is not null and (
    _viewer = _subject
    or public.is_super_admin(_viewer)
    or exists (
      select 1 from public.ecosystem_memberships m
       where m.user_id = _subject and public.is_ecosystem_admin(_viewer, m.ecosystem_id)
    )
    or exists (
      select 1 from public.profiles p
       where p.id = _subject and p.ecosystem_id is not null
         and public.is_ecosystem_admin(_viewer, p.ecosystem_id)
    )
    or exists (
      select 1 from public.profiles p where p.id = _subject and p.reseller_id = _viewer
    )
    or exists (
      select 1 from public.profiles v where v.id = _viewer and v.reseller_id = _subject
    )
  );
$$;

revoke all on function public.can_view_role(uuid, uuid) from public, anon, authenticated;

-- Feed: hide the author's internal role from viewers who are not authorised.
create or replace function public.social_feed(_limit integer default 30, _before timestamp with time zone default null)
 returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, image_path text, promoted boolean, promotion_tier_name text, promotion_expires_at timestamp with time zone, like_count integer, comment_count integer, liked_by_me boolean, created_at timestamp with time zone, can_delete boolean, audience text, origin_ecosystem_name text, author_role text, can_hide boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare _eco uuid; _mod boolean; _vs boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select pr.ecosystem_id into _eco from public.profiles pr
   where pr.id = auth.uid() and pr.deleted_at is null;
  if _eco is null then return; end if;
  _mod := public.social_can_moderate(auth.uid(), _eco);
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
         (select count(*)::integer from public.social_likes l
           where l.post_id = p.id and l.ecosystem_id = _eco),
         (select count(*)::integer from public.social_comments c
           where c.post_id = p.id and c.ecosystem_id = _eco and c.status = 'active'),
         exists (select 1 from public.social_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         (p.author_id = auth.uid() or public.is_super_admin(auth.uid())),
         p.audience,
         case when p.audience <> 'ecosystem' then eo.name end,
         case
           when public.is_super_admin(p.author_id) then case when _vs then 'super_admin' else null end
           when public.can_view_role(auth.uid(), p.author_id)
             then coalesce(public.membership_role(p.author_id, p.ecosystem_id)::text, 'customer')
           else null
         end,
         (_mod and p.author_id <> auth.uid())
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
    join public.ecosystems eo on eo.id = p.ecosystem_id
   where p.status = 'active'
     and ((p.audience = 'ecosystem' and p.ecosystem_id = _eco)
          or p.audience = 'general'
          or (p.audience = 'shops' and exists (
                select 1 from public.social_post_distributions d
                 where d.post_id = p.id and d.ecosystem_id = _eco and d.status = 'approved')))
     and not exists (select 1 from public.social_post_shop_hides h
                      where h.post_id = p.id and h.ecosystem_id = _eco)
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
                         or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
     and (_before is null or p.created_at < _before)
   order by case when p.promoted and p.promotion_refunded_at is null
                  and (p.promotion_expires_at is null or p.promotion_expires_at > now())
                 then p.promotion_priority else -1 end desc,
            p.created_at desc
   limit least(coalesce(_limit,30), 50);
end $function$;

-- Member search: role only for authorised viewers.
create or replace function public.search_members(_query text, _ecosystem_id uuid default null)
 returns table(id uuid, full_name text, handle text, avatar_path text, email text, phone text, masked_email text, status text, role text, ecosystem_id uuid, ecosystem_name text, credit_balance numeric, points_balance integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  _actor uuid := auth.uid();
  _q text := lower(btrim(coalesce(_query, '')));
  _h text := public.normalize_handle(_query);
  _digits text := regexp_replace(coalesce(_query, ''), '[^0-9]', '', 'g');
  _super boolean;
  _admin boolean := false;
  _seller boolean := false;
  _eco uuid;
  _scope uuid := _ecosystem_id;
begin
  if _actor is null or length(_q) < 2 then return; end if;

  _super := public.is_super_admin(_actor);
  if not _super then
    select p.ecosystem_id into _eco from public.profiles p where p.id = _actor;
    if _eco is null then return; end if;
    _admin := public.is_ecosystem_admin(_actor, _eco);
    _seller := public.has_role(_actor, 'reseller') or public.has_role(_actor, 'subreseller');
    if not _admin and not _seller then return; end if;
    if _scope is not null and _scope <> _eco then return; end if;
    _scope := _eco;
  end if;

  return query
    select
      p.id,
      p.full_name,
      p.handle,
      p.avatar_path,
      case when _super or _admin then p.email else regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2') end,
      case when _super or _admin then p.phone
           else regexp_replace(p.phone, '.(?=.{3})', '*', 'g') end,
      regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2'),
      p.status::text,
      case when public.can_view_role(_actor, p.id) then coalesce((
        select ur.role::text from public.user_roles ur
        where ur.user_id = p.id
        order by case ur.role
          when 'super_admin' then 1 when 'admin' then 2
          when 'reseller' then 3 when 'subreseller' then 4 else 5 end
        limit 1
      ), 'customer') else null end,
      p.ecosystem_id,
      e.name,
      case when _super or _admin then coalesce(ca.balance, 0)::numeric else 0::numeric end,
      case when _super or _admin then coalesce(pa.balance, 0)::integer else 0 end
    from public.profiles p
    join public.ecosystems e on e.id = p.ecosystem_id
    left join public.credit_accounts ca on ca.user_id = p.id
    left join public.points_accounts pa on pa.user_id = p.id
    where p.deleted_at is null
      and (_super or not public.is_super_admin(p.id))
      and (_scope is null or p.ecosystem_id = _scope)
      and (_super or _admin or public.can_load_credits(_actor, p.id))
      and (
        lower(p.full_name) like '%' || _q || '%'
        or lower(p.email) like '%' || _q || '%'
        or (_h is not null and lower(coalesce(p.handle,'')) like '%' || _h || '%')
        or (_digits <> '' and regexp_replace(p.phone, '[^0-9]', '', 'g') like '%' || _digits || '%')
      )
    order by
      case when lower(p.full_name) = _q or lower(p.email) = _q
                 or lower(coalesce(p.handle,'')) = coalesce(_h,'') then 0 else 1 end,
      p.full_name
    limit 25;
end;
$function$;

-- Transfer recipients: eligibility unchanged, role/relation masked for unauthorised viewers.
create or replace function public.wallet_shop_recipients(_ecosystem_id uuid, _search text default null, _limit integer default 50)
 returns table(id uuid, full_name text, handle text, avatar_path text, role text, relation text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  _subject uuid; _my_role public.app_role; _my_parent uuid; _is_op boolean;
  _term text;
begin
  _subject := public.effective_uid();
  if _subject is null or _ecosystem_id is null then return; end if;

  _is_op := public.is_super_admin(_subject) or public.is_ecosystem_admin(_subject, _ecosystem_id);
  if not _is_op and not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _subject and m.ecosystem_id = _ecosystem_id
       and m.membership_state = 'active' and m.status = 'active') then
    return;
  end if;

  _my_role := public.membership_role(_subject, _ecosystem_id);
  select p.reseller_id into _my_parent from public.profiles p where p.id = _subject;
  _term := nullif(trim(coalesce(_search, '')), '');

  return query
  select p.id,
         p.full_name,
         p.handle,
         p.avatar_path,
         case when public.can_view_role(_subject, p.id) then m.role::text else null end,
         case
           when public.can_view_role(_subject, p.id) then
             case
               when public.is_ecosystem_admin(p.id, _ecosystem_id) then 'admin'
               when m.role = 'reseller' and p.id = _my_parent then 'reseller'
               when m.role = 'subreseller' and p.reseller_id = _subject then 'subreseller'
               else m.role::text
             end
           when m.role = 'customer' then 'customer'
           else 'upline'
         end as relation
    from public.ecosystem_memberships m
    join public.profiles p on p.id = m.user_id
   where m.ecosystem_id = _ecosystem_id
     and m.membership_state = 'active'
     and m.status = 'active'
     and p.status = 'active'
     and p.deleted_at is null
     and p.id <> _subject
     and not public.is_super_admin(p.id)
     and (_term is null or p.full_name ilike '%' || _term || '%' or coalesce(p.handle,'') ilike '%' || _term || '%')
     and (
       case
         when _is_op then true
         when _my_role = 'reseller' then
           (m.role = 'customer') or (m.role = 'subreseller' and p.reseller_id = _subject)
         when _my_role = 'subreseller' then
           (m.role = 'customer')
           or (m.role = 'reseller' and p.id = _my_parent)
           or public.is_ecosystem_admin(p.id, _ecosystem_id)
         else
           (m.role in ('customer','subreseller','reseller'))
           or public.is_ecosystem_admin(p.id, _ecosystem_id)
       end
     )
   order by (case when public.is_ecosystem_admin(p.id, _ecosystem_id) then 0
                  when m.role = 'reseller' and p.id = _my_parent then 1
                  when m.role = 'subreseller' and p.reseller_id = _subject then 2
                  else 3 end), p.full_name
   limit greatest(1, least(coalesce(_limit, 50), 200));
end;
$function$;

-- Received invitations: do not reveal the inviter's internal role to the invitee.
create or replace function public.my_shop_invitations()
 returns table(id uuid, ecosystem_id uuid, ecosystem_name text, inviter_name text, inviter_role app_role, message text, status text, expires_at timestamp with time zone, created_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return;
  end if;
  return query
  select i.id, i.ecosystem_id, e.name, i.inviter_name,
         case when public.can_view_role(auth.uid(), i.invited_by) then i.inviter_role else null end,
         i.message, i.status, i.expires_at, i.created_at
    from public.ecosystem_invitations i
    join public.ecosystems e on e.id = i.ecosystem_id
   where i.user_id = auth.uid()
     and i.status = 'pending'
     and (i.expires_at is null or i.expires_at > now())
   order by i.created_at desc
   limit 50;
end;
$function$;

-- Membership rows carry roles: only the member, shop admins and the platform owner may read them.
drop policy if exists "Operators read memberships in their ecosystem" on public.ecosystem_memberships;
create policy "Shop admins read memberships in their ecosystem"
  on public.ecosystem_memberships for select to authenticated
  using (
    public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );
