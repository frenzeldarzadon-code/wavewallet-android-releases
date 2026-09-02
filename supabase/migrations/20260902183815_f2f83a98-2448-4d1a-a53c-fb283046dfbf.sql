-- Universe social activity is free. Posting, promoting and participating never
-- consume WaveWallet coins, social credits or points. This is enforced here, in
-- the database, so a direct RPC call cannot charge a member either.

create or replace function public.social_effective_settings(_eco uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'social_enabled', coalesce(e.social_enabled, true),
    'daily_allowance', 0,
    'free_posts_per_day', 0,
    'post_cost', 0,
    'comment_cost', 0,
    'credit_exchange_rate', 0,
    'points_exchange_rate', 0,
    'promotion_enabled', coalesce(e.promotion_enabled, s.promotion_enabled),
    'promotion_currency', 'social',
    'promotion_cost_social', 0,
    'promotion_cost_points', 0,
    'ads_enabled', s.ads_enabled and length(btrim(s.ad_provider)) > 0,
    'ad_provider', s.ad_provider,
    'ad_reward_amount', s.ad_reward_amount,
    'ad_daily_limit', s.ad_daily_limit,
    'image_max_px', s.image_max_px,
    'image_max_kb', s.image_max_kb,
    'allow_admin_overrides', s.allow_admin_overrides,
    'max_daily_allowance', s.max_daily_allowance,
    'max_exchange_rate', s.max_exchange_rate)
  from public.social_settings s
  left join public.ecosystem_social_settings e on e.ecosystem_id = _eco
  where s.id = 1;
$function$;

-- Exchanging wallet coins / points into social credits is retired: nothing in
-- the Universe costs social credits any more, so there is nothing to buy.
create or replace function public.social_exchange(_kind text, _amount integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  raise exception 'Universe social features are free — coins and points are never exchanged for social credits';
end; $function$;

create or replace function public.social_create_post(_body text, _image_path text default null::text, _promote boolean default false, _tier_id uuid default null::uuid, _currency text default null::text, _audience text default 'ecosystem'::text, _shop_ids uuid[] default null::uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _eco uuid; _s jsonb; _post uuid; _tx text;
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

  -- Promotion decides placement and duration only. It is never charged:
  -- Universe members do not spend coins, social credits or points to post or
  -- to promote. Nothing below ever writes a debit.
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
      _hours := _t.duration_hours; _prio := _t.priority; _tname := _t.name;
    else
      _hours := 24; _prio := 1; _tname := 'Promoted';
    end if;
    _expires := now() + make_interval(hours => _hours);
  end if;

  insert into public.social_posts (ecosystem_id, author_id, body, image_path, promoted,
                                   promotion_currency, promotion_cost, promotion_tier_id,
                                   promotion_tier_name, promotion_duration_hours,
                                   promotion_expires_at, promotion_priority, audience, used_free_post)
  values (_eco, auth.uid(), btrim(_body), _image_path, coalesce(_promote,false),
          case when coalesce(_promote,false) then 'social' end,
          case when coalesce(_promote,false) then 0 end,
          case when coalesce(_promote,false) then _tier_id end,
          _tname, _hours, _expires, coalesce(_prio,0), _aud, true)
  returning id into _post;

  if _aud = 'general' then
    insert into public.social_post_distributions (post_id, origin_ecosystem_id, ecosystem_id,
                                                  status, auto_published, reviewed_at, note)
    select _post, _eco, e.id, 'approved', true, now(),
           'Published automatically across the Universe'
      from public.ecosystems e
     where e.archived_at is null;
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Shared a post with all shops', _post::text,
            jsonb_build_object('approval_required', false));
  elsif _aud = 'shops' then
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

  _after := (public.social_wallet(auth.uid())).balance;

  if coalesce(_promote,false) then
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, auth.uid(), coalesce(_me,''), 'Promoted a community post', _post::text,
            jsonb_build_object('cost', 0, 'currency', 'social', 'tx_id', _tx,
                               'tier', _tname, 'duration_hours', _hours, 'expires_at', _expires));
  end if;

  return jsonb_build_object('post_id', _post, 'charged', 0, 'currency', 'social',
                            'promoted', coalesce(_promote,false), 'tier', _tname,
                            'expires_at', _expires, 'balance', _after,
                            'free_post', true,
                            'free_posts_left', 0,
                            'audience', _aud, 'pending_shops', _pending, 'live_shops', _live);
end $function$;