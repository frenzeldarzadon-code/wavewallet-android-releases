-- ============ AUDIENCE ============
alter table public.social_posts
  add column if not exists audience text not null default 'ecosystem';
do $$ begin
  alter table public.social_posts add constraint social_post_audience
    check (audience in ('ecosystem','general'));
exception when duplicate_object then null; end $$;

-- ============ DISTRIBUTIONS ============
create table if not exists public.social_post_distributions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  origin_ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  status text not null default 'pending',
  auto_published boolean not null default false,
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, ecosystem_id),
  constraint social_distribution_status check (status in ('pending','approved','rejected'))
);
create index if not exists social_distribution_queue_idx
  on public.social_post_distributions (ecosystem_id, status, created_at desc);

grant select on public.social_post_distributions to authenticated;
grant all on public.social_post_distributions to service_role;
alter table public.social_post_distributions enable row level security;

drop policy if exists "Moderators read distributions" on public.social_post_distributions;
create policy "Moderators read distributions"
  on public.social_post_distributions for select to authenticated
  using (public.is_super_admin(auth.uid())
     or public.is_ecosystem_admin(auth.uid(), ecosystem_id)
     or public.is_ecosystem_admin(auth.uid(), origin_ecosystem_id));

drop trigger if exists set_social_post_distributions_updated_at on public.social_post_distributions;
create trigger set_social_post_distributions_updated_at before update
  on public.social_post_distributions
  for each row execute function public.set_updated_at();

-- ============ VISIBILITY HELPER ============
create or replace function public.social_post_visible_in(_post_id uuid, _eco uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.social_posts p
     where p.id = _post_id
       and p.status = 'active'
       and (
         (p.audience = 'ecosystem' and p.ecosystem_id = _eco)
         or (p.audience = 'general' and exists (
              select 1 from public.social_post_distributions d
               where d.post_id = p.id and d.ecosystem_id = _eco and d.status = 'approved'))
       ));
$$;
grant execute on function public.social_post_visible_in(uuid, uuid) to authenticated;

drop policy if exists "Shop members read posts" on public.social_posts;
create policy "Shop members read posts" on public.social_posts for select to authenticated
  using (public.is_super_admin(auth.uid())
     or ecosystem_id = public.current_ecosystem(auth.uid())
     or (audience = 'general' and exists (
           select 1 from public.social_post_distributions d
            where d.post_id = social_posts.id
              and (d.ecosystem_id = public.current_ecosystem(auth.uid())
                   or public.is_ecosystem_admin(auth.uid(), d.ecosystem_id))
              and (d.status = 'approved' or public.is_ecosystem_admin(auth.uid(), d.ecosystem_id)))));

-- ============ FEED ============
drop function if exists public.social_feed(integer, timestamptz);
create function public.social_feed(_limit integer default 30, _before timestamptz default null)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text,
              body text, image_path text, promoted boolean, promotion_tier_name text,
              promotion_expires_at timestamptz, like_count integer, comment_count integer,
              liked_by_me boolean, created_at timestamptz, can_delete boolean,
              audience text, origin_ecosystem_name text)
language plpgsql stable security definer set search_path to 'public' as $$
declare _eco uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
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
end; $$;
grant execute on function public.social_feed(integer, timestamptz) to authenticated;

-- ============ CREATE POST (audience aware) ============
create or replace function public.social_create_post(_body text, _image_path text default null,
  _promote boolean default false, _tier_id uuid default null, _currency text default null,
  _audience text default 'ecosystem')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _s jsonb; _post uuid; _cost integer; _cur text; _tx text; _acct uuid;
        _me text; _after integer; _t record; _reseller boolean; _hours integer; _prio integer;
        _tname text; _expires timestamptz; _aud text; _pending integer := 0;
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
  if _aud not in ('ecosystem','general') then raise exception 'Choose who can see this post'; end if;
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
      _cur := case
                when _t.currency = 'both' then coalesce(nullif(_currency,''), 'social')
                else _t.currency end;
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
    select count(*) into _pending from public.social_post_distributions
     where post_id = _post and status = 'pending';
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Shared a post with all shops', _post::text,
            jsonb_build_object('pending_shops', _pending));
  end if;

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
                            'audience', _aud, 'pending_shops', _pending);
end; $$;
grant execute on function public.social_create_post(text, text, boolean, uuid, text, text) to authenticated;

-- ============ INTERACTIONS RESPECT VISIBILITY ============
create or replace function public.social_create_comment(_post_id uuid, _body text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _p public.social_posts; _s jsonb; _cost integer; _cid uuid; _after integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  perform public.require_operational();
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;
  if length(btrim(coalesce(_body,''))) = 0 then raise exception 'Write something first'; end if;
  perform public.social_rate_limit(auth.uid(), array['comment'], interval '1 hour', 60);

  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null or not public.social_post_visible_in(_p.id, _eco) then
    raise exception 'That post is not available';
  end if;
  if exists (select 1 from public.social_blocks
              where (blocker_id = _p.author_id and blocked_id = auth.uid())
                 or (blocker_id = auth.uid() and blocked_id = _p.author_id)) then
    raise exception 'You cannot reply to this member';
  end if;

  _s := public.social_effective_settings(_eco);
  if not (_s ->> 'social_enabled')::boolean then raise exception 'The community is currently disabled'; end if;
  -- Disclosed rule: replies to an active promoted post are free.
  _cost := case when _p.promoted and _p.promotion_refunded_at is null
                 and (_p.promotion_expires_at is null or _p.promotion_expires_at > now())
                then 0 else (_s ->> 'comment_cost')::integer end;

  insert into public.social_comments (post_id, ecosystem_id, author_id, body, charged)
  values (_p.id, _eco, auth.uid(), btrim(_body), _cost > 0)
  returning id into _cid;
  update public.social_posts set comment_count = comment_count + 1 where id = _p.id;

  if _cost > 0 then
    _after := public.social_move(auth.uid(), 'debit', _cost, 'comment', 'Community reply', _cid::text);
  else
    _after := (public.social_wallet(auth.uid())).balance;
  end if;
  return jsonb_build_object('comment_id', _cid, 'charged', _cost, 'balance', _after);
end; $$;

create or replace function public.social_toggle_like(_post_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _p public.social_posts; _liked boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null or _eco is null or not public.social_post_visible_in(_p.id, _eco) then
    raise exception 'That post is not available';
  end if;
  if exists (select 1 from public.social_likes where post_id = _p.id and user_id = auth.uid()) then
    delete from public.social_likes where post_id = _p.id and user_id = auth.uid();
    update public.social_posts set like_count = greatest(like_count - 1, 0) where id = _p.id;
    _liked := false;
  else
    if (select count(*) from public.social_likes
         where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 200 then
      raise exception 'You are doing that too often — please try again later';
    end if;
    insert into public.social_likes (post_id, user_id, ecosystem_id) values (_p.id, auth.uid(), _eco);
    update public.social_posts set like_count = like_count + 1 where id = _p.id;
    _liked := true;
  end if;
  return jsonb_build_object('liked', _liked,
    'likes', (select count(*)::integer from public.social_likes l
               where l.post_id = _p.id and l.ecosystem_id = _eco));
end; $$;

create or replace function public.social_report(_target_type text, _target_id uuid, _reason text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _target_user uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;
  if length(btrim(coalesce(_reason,''))) < 3 then raise exception 'Tell us briefly what is wrong'; end if;
  if (select count(*) from public.social_reports
       where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have reported too many items today';
  end if;

  if _target_type = 'post' then
    select author_id into _target_user from public.social_posts
     where id = _target_id and public.social_post_visible_in(id, _eco);
  elsif _target_type = 'comment' then
    select author_id into _target_user from public.social_comments where id = _target_id and ecosystem_id = _eco;
  elsif _target_type = 'message' then
    select sender_id into _target_user from public.dm_messages
     where id = _target_id and recipient_id = auth.uid();
  elsif _target_type = 'member' then
    select id into _target_user from public.profiles where id = _target_id and ecosystem_id = _eco;
  else
    raise exception 'Unknown report target';
  end if;
  if _target_user is null then raise exception 'That item is not available'; end if;

  insert into public.social_reports (ecosystem_id, reporter_id, target_type, target_id, target_user_id, reason)
  values (_eco, auth.uid(), _target_type, _target_id, _target_user, btrim(_reason));
end; $$;

-- Removal of a shared post stays with the author's own shop; other shops reject instead.
create or replace function public.social_delete_post(_post_id uuid, _reason text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _p public.social_posts; _me text;
begin
  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null then raise exception 'That post is not available'; end if;
  if _p.author_id <> auth.uid() and not public.social_can_moderate(auth.uid(), _p.ecosystem_id) then
    raise exception 'You cannot remove this post';
  end if;
  update public.social_posts set status = 'removed', removed_by = auth.uid(),
         removed_reason = nullif(btrim(coalesce(_reason,'')),''), removed_at = now(), updated_at = now()
   where id = _p.id;
  select full_name into _me from public.profiles where id = auth.uid();
  if _p.author_id <> auth.uid() then
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_p.ecosystem_id, auth.uid(), coalesce(_me,''), 'Removed a community post', _p.id::text,
            jsonb_build_object('author_id', _p.author_id, 'reason', _reason));
  end if;
end; $$;

-- ============ MODERATION QUEUE ============
create or replace function public.social_general_queue(_eco uuid default null, _status text default 'pending')
returns table(id uuid, post_id uuid, status text, note text, created_at timestamptz,
              reviewed_at timestamptz, reviewed_by_name text, ecosystem_id uuid,
              origin_ecosystem_name text, author_name text, author_handle text,
              author_avatar text, body text, image_path text, post_created_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare _target uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  _target := coalesce(_eco, public.current_ecosystem(auth.uid()));
  if _target is null or not public.social_can_moderate(auth.uid(), _target) then
    raise exception 'Not allowed';
  end if;
  return query
  select d.id, d.post_id, d.status, d.note, d.created_at, d.reviewed_at, d.reviewed_by_name,
         d.ecosystem_id, eo.name, coalesce(a.full_name,'Member'), a.handle, a.avatar_path,
         p.body, p.image_path, p.created_at
    from public.social_post_distributions d
    join public.social_posts p on p.id = d.post_id
    join public.profiles a on a.id = p.author_id
    join public.ecosystems eo on eo.id = d.origin_ecosystem_id
   where d.ecosystem_id = _target
     and p.status = 'active'
     and (coalesce(_status,'pending') = 'all' or d.status = coalesce(_status,'pending'))
   order by d.created_at desc
   limit 200;
end; $$;
grant execute on function public.social_general_queue(uuid, text) to authenticated;

create or replace function public.social_review_distribution(_id uuid, _status text, _note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _d public.social_post_distributions; _me text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  select * into _d from public.social_post_distributions where id = _id;
  if _d.id is null then raise exception 'That request is not available'; end if;
  if not public.social_can_moderate(auth.uid(), _d.ecosystem_id) then raise exception 'Not allowed'; end if;
  if _status not in ('approved','rejected') then raise exception 'Unknown decision'; end if;
  select full_name into _me from public.profiles where id = auth.uid();
  update public.social_post_distributions
     set status = _status, reviewed_by = auth.uid(), reviewed_by_name = coalesce(_me,''),
         reviewed_at = now(), note = nullif(btrim(coalesce(_note,'')),''), auto_published = false
   where id = _d.id;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_d.ecosystem_id, auth.uid(), coalesce(_me,''),
          case when _status = 'approved' then 'Approved a shared community post'
               else 'Rejected a shared community post' end,
          _d.post_id::text,
          jsonb_build_object('distribution_id', _d.id, 'origin_ecosystem_id', _d.origin_ecosystem_id,
                             'status', _status));
end; $$;
grant execute on function public.social_review_distribution(uuid, text, text) to authenticated;

-- Author-facing status: shop names and decisions only, never private admin notes.
create or replace function public.social_post_distribution_status(_post_id uuid)
returns table(ecosystem_name text, status text, reviewed_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare _p public.social_posts;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null or _p.audience <> 'general' then return; end if;
  if _p.author_id <> auth.uid() and not public.social_can_moderate(auth.uid(), _p.ecosystem_id) then
    raise exception 'Not allowed';
  end if;
  return query
  select e.name, d.status, d.reviewed_at
    from public.social_post_distributions d
    join public.ecosystems e on e.id = d.ecosystem_id
   where d.post_id = _p.id
   order by e.name;
end; $$;
grant execute on function public.social_post_distribution_status(uuid) to authenticated;