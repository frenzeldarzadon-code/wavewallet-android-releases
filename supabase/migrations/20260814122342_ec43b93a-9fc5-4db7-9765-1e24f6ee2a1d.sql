-- 1. Platform setting: free posts per day (replaces the daily free-credit allowance)
ALTER TABLE public.social_settings
  ADD COLUMN IF NOT EXISTS free_posts_per_day integer NOT NULL DEFAULT 1;

ALTER TABLE public.ecosystem_social_settings
  ADD COLUMN IF NOT EXISTS free_posts_per_day integer;

-- The daily free social-credit allowance model is retired.
UPDATE public.social_settings SET daily_allowance = 0 WHERE id = 1;
UPDATE public.ecosystem_social_settings SET daily_allowance = 0 WHERE daily_allowance IS DISTINCT FROM 0;

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS used_free_post boolean NOT NULL DEFAULT false;

-- 2. Effective settings now expose the free-post allowance
CREATE OR REPLACE FUNCTION public.social_effective_settings(_eco uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'social_enabled', coalesce(e.social_enabled, true),
    'daily_allowance', 0,
    'free_posts_per_day', greatest(coalesce(e.free_posts_per_day, s.free_posts_per_day, 1), 0),
    'post_cost', coalesce(e.post_cost, s.post_cost),
    'comment_cost', coalesce(e.comment_cost, s.comment_cost),
    'credit_exchange_rate', coalesce(e.credit_exchange_rate, s.credit_exchange_rate),
    'points_exchange_rate', coalesce(e.points_exchange_rate, s.points_exchange_rate),
    'promotion_enabled', coalesce(e.promotion_enabled, s.promotion_enabled),
    'promotion_currency', s.promotion_currency,
    'promotion_cost_social', s.promotion_cost_social,
    'promotion_cost_points', s.promotion_cost_points,
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

-- 3. Platform owner setting update keeps the new field
CREATE OR REPLACE FUNCTION public.update_social_settings(
  _daily_allowance integer, _post_cost integer, _comment_cost integer,
  _credit_exchange_rate integer, _points_exchange_rate integer, _promotion_enabled boolean,
  _promotion_currency text, _promotion_cost_social integer, _promotion_cost_points integer,
  _ads_enabled boolean, _ad_reward_amount integer, _ad_daily_limit integer,
  _ad_provider text DEFAULT ''::text, _allow_admin_overrides boolean DEFAULT true,
  _max_daily_allowance integer DEFAULT 20, _max_exchange_rate integer DEFAULT 10,
  _image_max_px integer DEFAULT 1000, _image_max_kb integer DEFAULT 320,
  _free_posts_per_day integer DEFAULT NULL)
RETURNS social_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _row public.social_settings; _me text;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Only the platform owner can change social settings'; end if;
  update public.social_settings set
    daily_allowance = 0, post_cost = greatest(_post_cost,0),
    comment_cost = greatest(_comment_cost,0),
    free_posts_per_day = greatest(coalesce(_free_posts_per_day, free_posts_per_day), 0),
    credit_exchange_rate = greatest(_credit_exchange_rate,1), points_exchange_rate = greatest(_points_exchange_rate,1),
    promotion_enabled = _promotion_enabled, promotion_currency = _promotion_currency,
    promotion_cost_social = greatest(_promotion_cost_social,0), promotion_cost_points = greatest(_promotion_cost_points,0),
    ads_enabled = _ads_enabled, ad_reward_amount = greatest(_ad_reward_amount,0),
    ad_daily_limit = greatest(_ad_daily_limit,0), ad_provider = btrim(coalesce(_ad_provider,'')),
    allow_admin_overrides = _allow_admin_overrides,
    max_daily_allowance = greatest(_max_daily_allowance,0), max_exchange_rate = greatest(_max_exchange_rate,1),
    image_max_px = least(greatest(_image_max_px,240),2000), image_max_kb = least(greatest(_image_max_kb,40),2048),
    updated_by = auth.uid()
  where id = 1 returning * into _row;
  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce(_me,'Platform owner'), 'Updated social settings', 'Platform', to_jsonb(_row));
  return _row;
end; $function$;

-- 4. No more daily free-credit grant; the wallet just tracks the two buckets
CREATE OR REPLACE FUNCTION public.social_wallet(_user uuid)
RETURNS social_credit_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _acct public.social_credit_accounts;
        _zero uuid := '00000000-0000-0000-0000-000000000000';
begin
  select ecosystem_id into _eco from public.profiles where id = _user and deleted_at is null;

  insert into public.social_credit_accounts (user_id, ecosystem_id)
  values (_user, _eco)
  on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;

  select * into _acct from public.social_credit_accounts
   where user_id = _user and coalesce(ecosystem_id, _zero) = coalesce(_eco, _zero)
   for update;
  return _acct;
end; $function$;

-- 5. Ledger accounting: gifts move purchased credits only
CREATE OR REPLACE FUNCTION public.apply_social_credit_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _free integer; _paid integer; _take integer;
begin
  select free_balance, balance into _free, _paid
    from public.social_credit_accounts where id = new.account_id for update;
  if _paid is null then raise exception 'Social wallet not found'; end if;

  if new.direction = 'credit' then
    if new.source = 'daily_allowance' then
      _free := new.amount;
    else
      _paid := _paid + new.amount;
    end if;
  elsif new.source = 'gift_sent' then
    -- Only purchased social credits may leave an account as a gift. Free or
    -- promotional credits are never transferable.
    if _paid < new.amount then
      raise exception 'Only purchased social credits can be gifted';
    end if;
    _paid := _paid - new.amount;
  else
    if _free + _paid < new.amount then raise exception 'Not enough social credits'; end if;
    _take := least(_free, new.amount);
    _free := _free - _take;
    _paid := _paid - (new.amount - _take);
  end if;

  update public.social_credit_accounts
     set free_balance = _free, balance = _paid, updated_at = now()
   where id = new.account_id;
  new.balance_after := _free + _paid;
  return new;
end; $function$;

-- 6. How many free posts the member has left today (UTC calendar day)
CREATE OR REPLACE FUNCTION public.social_free_posts_used(_user uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select count(*)::integer from public.social_posts
   where author_id = _user
     and used_free_post
     and (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date;
$function$;

-- 7. Posting: free allowance first, then paid credits
CREATE OR REPLACE FUNCTION public.social_create_post(_body text, _image_path text DEFAULT NULL::text, _promote boolean DEFAULT false, _tier_id uuid DEFAULT NULL::uuid, _currency text DEFAULT NULL::text, _audience text DEFAULT 'ecosystem'::text, _shop_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _s jsonb; _post uuid; _cost integer; _cur text; _tx text; _acct uuid;
        _me text; _after integer; _t record; _reseller boolean; _hours integer; _prio integer;
        _tname text; _expires timestamptz; _aud text; _pending integer := 0; _live integer := 0;
        _targets uuid[]; _free_allow integer; _free_used integer; _free_post boolean := false;
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
    -- Free post allowance: a configurable number of ordinary posts per day
    -- cost nothing. It is an allowance of posts, never of social credits.
    _free_allow := coalesce((_s ->> 'free_posts_per_day')::integer, 0);
    _free_used := public.social_free_posts_used(auth.uid());
    if _free_used < _free_allow then
      _free_post := true;
      _cost := 0;
    end if;
  end if;

  insert into public.social_posts (ecosystem_id, author_id, body, image_path, promoted,
                                   promotion_currency, promotion_cost, promotion_tier_id,
                                   promotion_tier_name, promotion_duration_hours,
                                   promotion_expires_at, promotion_priority, audience, used_free_post)
  values (_eco, auth.uid(), btrim(_body), _image_path, coalesce(_promote,false),
          case when coalesce(_promote,false) then _cur end,
          case when coalesce(_promote,false) then _cost end,
          case when coalesce(_promote,false) then _tier_id end,
          _tname, _hours, _expires, coalesce(_prio,0), _aud, _free_post)
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
                            'free_post', _free_post,
                            'free_posts_left', greatest(coalesce(_free_allow,0) - public.social_free_posts_used(auth.uid()), 0),
                            'audience', _aud, 'pending_shops', _pending, 'live_shops', _live);
end $function$;

-- 8. Member state: paid balance + free post allowance, never a blended number
CREATE OR REPLACE FUNCTION public.social_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _acct public.social_credit_accounts; _s jsonb; _ads integer; _tiers jsonb; _reseller boolean;
        _allow integer; _used integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  _acct := public.social_wallet(auth.uid());
  _s := public.social_effective_settings(_acct.ecosystem_id);
  select count(*) into _ads from public.social_ad_events
   where user_id = auth.uid() and claimed_at > (now() at time zone 'utc')::date;
  _reseller := public.has_role(auth.uid(),'reseller') or public.has_role(auth.uid(),'subreseller')
               or public.has_role(auth.uid(),'admin') or public.is_super_admin(auth.uid());
  select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order, t.priority), '[]'::jsonb) into _tiers
    from public.social_tiers_for(_acct.ecosystem_id) t
   where t.active and (t.eligibility = 'all' or _reseller);
  _allow := coalesce((_s ->> 'free_posts_per_day')::integer, 0);
  _used := public.social_free_posts_used(auth.uid());
  return _s
    || jsonb_build_object('balance', _acct.free_balance + _acct.balance,
                          'free_balance', _acct.free_balance,
                          'purchased_balance', _acct.balance,
                          'free_posts_per_day', _allow,
                          'free_posts_used_today', _used,
                          'free_posts_left', greatest(_allow - _used, 0),
                          'comment_cost', 0,
                          'ecosystem_id', _acct.ecosystem_id,
                          'ads_claimed_today', _ads,
                          'promotion_tiers', _tiers);
end; $function$;

-- 9. Gifting purchased social credits to a post author
CREATE OR REPLACE FUNCTION public.social_gift_credits(_post_id uuid, _amount integer, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _p public.social_posts; _me text; _them text; _sender public.social_credit_accounts;
        _recipient public.social_credit_accounts; _after integer; _tx text; _reason text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  perform public.require_operational();
  if _amount is null or _amount <= 0 then raise exception 'Enter how many social credits to gift'; end if;
  if _amount > 1000 then raise exception 'You can gift at most 1000 social credits at a time'; end if;

  select ecosystem_id, full_name into _eco, _me from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;

  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null or not public.social_post_visible_in(_p.id, _eco) then
    raise exception 'That post is not available';
  end if;
  if _p.author_id = auth.uid() then raise exception 'You cannot gift social credits to yourself'; end if;
  if exists (select 1 from public.social_blocks
              where (blocker_id = _p.author_id and blocked_id = auth.uid())
                 or (blocker_id = auth.uid() and blocked_id = _p.author_id)) then
    raise exception 'You cannot gift social credits to this member';
  end if;
  select full_name into _them from public.profiles where id = _p.author_id and deleted_at is null;
  if _them is null then raise exception 'That member is no longer available'; end if;

  perform public.social_rate_limit(auth.uid(), array['gift_sent'], interval '1 hour', 30);

  -- Deterministic lock order so two members gifting each other cannot deadlock.
  if auth.uid() < _p.author_id then
    _sender := public.social_wallet(auth.uid());
    _recipient := public.social_wallet(_p.author_id);
  else
    _recipient := public.social_wallet(_p.author_id);
    _sender := public.social_wallet(auth.uid());
  end if;

  if _sender.balance < _amount then
    raise exception 'You need % purchased social credits. Free social credits cannot be gifted.', _amount;
  end if;

  _tx := public.new_tx_id();
  _reason := 'Gift to ' || coalesce(_them, 'a member');

  insert into public.social_credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                           balance_after, source, reason, reference)
  values (_sender.id, auth.uid(), _sender.ecosystem_id, 'debit', _amount, 0, 'gift_sent',
          _reason, _post_id::text)
  returning balance_after into _after;

  insert into public.social_credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                           balance_after, source, reason, reference)
  values (_recipient.id, _p.author_id, _recipient.ecosystem_id, 'credit', _amount, 0, 'gift_received',
          'Gift from ' || coalesce(_me, 'a member'), _post_id::text);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,''), 'Gifted social credits', _post_id::text,
          jsonb_build_object('amount', _amount, 'recipient_id', _p.author_id,
                             'recipient_name', _them, 'tx_id', _tx,
                             'note', nullif(btrim(coalesce(_note,'')), ''),
                             'source_balance', 'purchased'));

  return jsonb_build_object('amount', _amount, 'recipient_name', _them,
                            'purchased_balance', greatest(_sender.balance - _amount, 0),
                            'balance', _after, 'tx_id', _tx);
end; $function$;

-- 10. Personal social-credit history (includes gifts sent and received)
CREATE OR REPLACE FUNCTION public.social_my_credit_history(_limit integer DEFAULT 50)
RETURNS TABLE(created_at timestamp with time zone, direction text, amount integer,
              source text, reason text, balance_after integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select l.created_at, l.direction, l.amount, l.source, l.reason, l.balance_after
    from public.social_credit_ledger l
   where l.user_id = auth.uid()
   order by l.created_at desc
   limit least(coalesce(_limit, 50), 200);
$function$;

-- 11. Platform-owner audit of every purchased-credit gift
CREATE OR REPLACE FUNCTION public.social_gift_audit(_limit integer DEFAULT 100)
RETURNS TABLE(created_at timestamp with time zone, sender_name text, recipient_name text,
              amount integer, post_id text, sender_balance_after integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  return query
  select l.created_at,
         coalesce(sp.full_name, 'Member'),
         coalesce(rp.full_name, 'Member'),
         l.amount,
         l.reference,
         l.balance_after
    from public.social_credit_ledger l
    left join public.profiles sp on sp.id = l.user_id
    left join public.social_posts p on p.id::text = l.reference
    left join public.profiles rp on rp.id = p.author_id
   where l.source = 'gift_sent'
   order by l.created_at desc
   limit least(coalesce(_limit, 100), 500);
end; $function$;

REVOKE ALL ON FUNCTION public.social_gift_credits(uuid, integer, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.social_my_credit_history(integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.social_gift_audit(integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.social_free_posts_used(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.social_gift_credits(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_my_credit_history(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_gift_audit(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_free_posts_used(uuid) TO authenticated;