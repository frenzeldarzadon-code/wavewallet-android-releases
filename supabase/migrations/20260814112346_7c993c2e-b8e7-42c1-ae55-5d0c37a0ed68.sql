-- 1. allow the new audience value
do $$ declare c text; begin
  for c in select conname from pg_constraint
            where conrelid = 'public.social_posts'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%audience%'
  loop execute format('alter table public.social_posts drop constraint %I', c); end loop;
end $$;
alter table public.social_posts
  add constraint social_posts_audience_check check (audience in ('ecosystem','general','shops'));

-- 2. shops the caller may target
create or replace function public.social_target_shops()
returns table(ecosystem_id uuid, ecosystem_name text, is_current boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.ecosystem_id, e.name,
         m.ecosystem_id = public.current_ecosystem(public.effective_uid())
    from public.ecosystem_memberships m
    join public.ecosystems e on e.id = m.ecosystem_id
   where m.user_id = public.effective_uid()
     and m.membership_state = 'active'
     and e.archived_at is null
   order by e.name;
$$;
grant execute on function public.social_target_shops() to authenticated;

-- 3. single create-post entry point, with optional explicit shop targets
drop function if exists public.social_create_post(text, text, boolean);
drop function if exists public.social_create_post(text, text, boolean, uuid, text);
drop function if exists public.social_create_post(text, text, boolean, uuid, text, text);

create or replace function public.social_create_post(
  _body text,
  _image_path text default null,
  _promote boolean default false,
  _tier_id uuid default null,
  _currency text default null,
  _audience text default 'ecosystem',
  _shop_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare _eco uuid; _s jsonb; _post uuid; _cost integer; _cur text; _tx text; _acct uuid;
        _me text; _after integer; _t record; _reseller boolean; _hours integer; _prio integer;
        _tname text; _expires timestamptz; _aud text; _pending integer := 0; _live integer := 0;
        _targets uuid[];
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  perform public.require_operational();
  select ecosystem_id, full_name into _eco, _me from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;
  if length(btrim(coalesce(_body,''))) = 0 then raise exception 'Write something first'; end if;
  if _image_path is not null and split_part(_image_path, '/', 1) <> _eco::text then
    raise exception 'Invalid image location';
  end if;
  _aud := coalesce(nullif(btrim(coalesce(_audience,'')),''), 'ecosystem');
  if _aud not in ('ecosystem','general','shops') then raise exception 'Choose who can see this post'; end if;

  if _aud = 'shops' then
    select array_agg(distinct s) into _targets from unnest(coalesce(_shop_ids, '{}'::uuid[])) s;
    if _targets is null or array_length(_targets, 1) is null then
      raise exception 'Choose at least one shop to share with';
    end if;
    if exists (
      select 1 from unnest(_targets) s
       where not exists (
         select 1 from public.ecosystem_memberships m
          where m.user_id = auth.uid() and m.ecosystem_id = s and m.membership_state = 'active')
    ) then
      raise exception 'You can only share with shops you are an approved member of';
    end if;
  end if;

  perform public.social_rate_limit(auth.uid(), array['post','promotion'], interval '1 hour', 20);

  _s := public.social_effective_settings(_eco);
  if not (_s ->> 'social_enabled')::boolean then raise exception 'The community is currently disabled'; end if;
  perform public.social_wallet(auth.uid());
  _tx := public.new_tx_id();

  if coalesce(_promote,false) then
    if not (_s ->> 'promotion_enabled')::boolean then raise exception 'Promotion is currently disabled'; end if;
    _reseller := public.has_role(auth.uid(),'reseller') or public.has_role(auth.uid(),'subreseller')
                 or public.has_role(auth.uid(),'admin') or public.is_super_admin(auth.uid());
    if _tier_id is not null then
      select * into _t from public.social_tiers_for(_eco) t where t.id = _tier_id and t.active;
      if _t.id is null then raise exception 'That promotion is not available'; end if;
      if _t.eligibility = 'reseller' and not _reseller then
        raise exception 'That promotion is only available to resellers';
      end if;
      _cur := case when _t.currency = 'both' then coalesce(nullif(_currency,''), 'social') else _t.currency end;
      if _cur not in ('social','points') then raise exception 'Choose how to pay for the promotion'; end if;
      if _t.currency <> 'both' and _currency is not null and _currency <> _t.currency then
        raise exception 'That promotion must be paid in %', _t.currency;
      end if;
      _cost := case when _cur = 'points' then _t.price_points else _t.price_social end;
      _hours := _t.duration_hours; _prio := _t.priority; _tname := _t.name;
    else
      _cur := coalesce(nullif(_currency,''), _s ->> 'promotion_currency');
      _cost := case when _cur = 'points' then (_s ->> 'promotion_cost_points')::integer
                    else (_s ->> 'promotion_cost_social')::integer end;
      _hours := 24; _prio := 1; _tname := 'Promoted';
    end if;
    _expires := now() + make_interval(hours => _hours);
  else
    _cur := 'social';
    _cost := (_s ->> 'post_cost')::integer;
  end if;

  insert into public.social_posts (ecosystem_id, author_id, body, image_path, promoted,
                                   promotion_currency, promotion_cost, promotion_tier_id,
                                   promotion_tier_name, promotion_duration_hours,
                                   promotion_expires_at, promotion_priority, audience)
  values (_eco, auth.uid(), btrim(_body), _image_path, coalesce(_promote,false),
          case when coalesce(_promote,false) then _cur end,
          case when coalesce(_promote,false) then _cost end,
          case when coalesce(_promote,false) then _tier_id end,
          _tname, _hours, _expires, coalesce(_prio,0), _aud)
  returning id into _post;

  if _aud = 'general' then
    insert into public.social_post_distributions (post_id, origin_ecosystem_id, ecosystem_id,
                                                  status, auto_published, reviewed_at, note)
    select _post, _eco, e.id,
           case when e.id = _eco then 'approved' else 'pending' end,
           e.id = _eco,
           case when e.id = _eco then now() end,
           case when e.id = _eco then 'Published automatically in the author''s own shop' end
      from public.ecosystems e
     where e.archived_at is null;
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Shared a post with all shops', _post::text,
            jsonb_build_object('pending_shops',
              (select count(*) from public.social_post_distributions where post_id = _post and status = 'pending')));
  elsif _aud = 'shops' then
    -- the author is an approved member of every target, so nothing needs moderation
    insert into public.social_post_distributions (post_id, origin_ecosystem_id, ecosystem_id,
                                                  status, auto_published, reviewed_at, note)
    select _post, _eco, s, 'approved', true, now(),
           'Published in a shop the author belongs to'
      from unnest(_targets) s;
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Shared a post with selected shops', _post::text,
            jsonb_build_object('shops', array_length(_targets, 1)));
  end if;

  select count(*) filter (where status = 'pending'), count(*) filter (where status = 'approved')
    into _pending, _live
    from public.social_post_distributions where post_id = _post;

  if _cost > 0 then
    if _cur = 'points' then
      select id into _acct from public.points_accounts where user_id = auth.uid();
      if _acct is null then raise exception 'Points wallet not found'; end if;
      insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                        reason, reference, actor_id, tx_id, entry_type)
      values (_acct, auth.uid(), _eco, 'debit', _cost, 0, 'Promoted a community post', 'SOCIAL',
              auth.uid(), _tx, 'spend');
      _after := (public.social_wallet(auth.uid())).balance;
    else
      _after := public.social_move(auth.uid(), 'debit', _cost,
                 case when coalesce(_promote,false) then 'promotion' else 'post' end,
                 case when coalesce(_promote,false) then 'Promoted a community post' else 'Community post' end,
                 _post::text);
    end if;
  else
    _after := (public.social_wallet(auth.uid())).balance;
  end if;

  if coalesce(_promote,false) then
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Promoted a community post', _post::text,
            jsonb_build_object('cost', _cost, 'currency', _cur, 'tx_id', _tx,
                               'tier', _tname, 'duration_hours', _hours, 'expires_at', _expires));
  end if;

  return jsonb_build_object('post_id', _post, 'charged', _cost, 'currency', _cur,
                            'promoted', coalesce(_promote,false), 'tier', _tname,
                            'expires_at', _expires, 'balance', _after,
                            'audience', _aud, 'pending_shops', _pending, 'live_shops', _live);
end; $function$;

grant execute on function public.social_create_post(text, text, boolean, uuid, text, text, uuid[]) to authenticated;

-- 4. feed: include shop-targeted posts and expose the author's role
drop function if exists public.social_feed(integer, timestamptz);
create or replace function public.social_feed(_limit integer default 30, _before timestamptz default null)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text,
              body text, image_path text, promoted boolean, promotion_tier_name text,
              promotion_expires_at timestamptz, like_count integer, comment_count integer,
              liked_by_me boolean, created_at timestamptz, can_delete boolean, audience text,
              origin_ecosystem_name text, author_role text)
language plpgsql
stable
security definer
set search_path = public
as $function$
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
         case when p.audience <> 'ecosystem' then eo.name end,
         case when public.is_super_admin(p.author_id) then 'super_admin'
              else coalesce(public.membership_role(p.author_id, p.ecosystem_id)::text, 'customer') end
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
    join public.ecosystems eo on eo.id = p.ecosystem_id
   where p.status = 'active'
     and ((p.audience = 'ecosystem' and p.ecosystem_id = _eco)
          or (p.audience in ('general','shops') and exists (
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

grant execute on function public.social_feed(integer, timestamptz) to authenticated;

-- 5. author-facing sharing status also covers shop-targeted posts
create or replace function public.social_post_distribution_status(_post_id uuid)
returns table(ecosystem_name text, status text, reviewed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare _p public.social_posts;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null or _p.audience not in ('general','shops') then return; end if;
  if _p.author_id <> auth.uid() and not public.social_can_moderate(auth.uid(), _p.ecosystem_id) then
    raise exception 'Not allowed';
  end if;
  return query
  select e.name, d.status, d.reviewed_at
    from public.social_post_distributions d
    join public.ecosystems e on e.id = d.ecosystem_id
   where d.post_id = _p.id
   order by e.name;
end; $function$;