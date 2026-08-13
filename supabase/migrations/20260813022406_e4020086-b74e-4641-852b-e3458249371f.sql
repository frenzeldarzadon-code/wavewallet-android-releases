
-- ============ platform settings additions ============
alter table public.social_settings
  add column if not exists ad_provider text not null default '',
  add column if not exists allow_admin_overrides boolean not null default true,
  add column if not exists max_daily_allowance integer not null default 20,
  add column if not exists max_exchange_rate integer not null default 10,
  add column if not exists image_max_px integer not null default 1000,
  add column if not exists image_max_kb integer not null default 320;

-- ============ per-ecosystem overrides ============
create table if not exists public.ecosystem_social_settings (
  ecosystem_id uuid primary key references public.ecosystems(id) on delete cascade,
  social_enabled boolean not null default true,
  daily_allowance integer,
  post_cost integer,
  comment_cost integer,
  credit_exchange_rate integer,
  points_exchange_rate integer,
  promotion_enabled boolean,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.ecosystem_social_settings to authenticated;
grant all on public.ecosystem_social_settings to service_role;
alter table public.ecosystem_social_settings enable row level security;
create policy "Members read own shop community settings"
  on public.ecosystem_social_settings for select to authenticated
  using (ecosystem_id = public.current_ecosystem(auth.uid()) or public.is_super_admin(auth.uid()));
drop trigger if exists set_ecosystem_social_settings_updated_at on public.ecosystem_social_settings;
create trigger set_ecosystem_social_settings_updated_at before update on public.ecosystem_social_settings
  for each row execute function public.set_updated_at();

-- ============ promotion tiers ============
create table if not exists public.social_promotion_tiers (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid references public.ecosystems(id) on delete cascade,
  name text not null,
  description text not null default '',
  price_social integer not null default 20,
  price_points integer not null default 20,
  currency text not null default 'both' check (currency in ('social','points','both')),
  duration_hours integer not null default 24 check (duration_hours between 1 and 8760),
  priority integer not null default 1 check (priority between 0 and 100),
  eligibility text not null default 'all' check (eligibility in ('all','reseller')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.social_promotion_tiers to authenticated;
grant all on public.social_promotion_tiers to service_role;
alter table public.social_promotion_tiers enable row level security;
create policy "Members read tiers of own shop or platform defaults"
  on public.social_promotion_tiers for select to authenticated
  using (ecosystem_id is null or ecosystem_id = public.current_ecosystem(auth.uid())
         or public.is_super_admin(auth.uid()));
drop trigger if exists set_social_promotion_tiers_updated_at on public.social_promotion_tiers;
create trigger set_social_promotion_tiers_updated_at before update on public.social_promotion_tiers
  for each row execute function public.set_updated_at();

insert into public.social_promotion_tiers (ecosystem_id, name, description, price_social, price_points, currency, duration_hours, priority, sort_order)
select null, v.name, v.descr, v.ps, v.pp, 'both', v.dur, v.prio, v.ord
  from (values
    ('Basic',    'Pinned above normal posts for a day.',       20, 20, 24,  1, 1),
    ('Featured', 'Higher placement for three days.',           50, 50, 72,  5, 2),
    ('Premium',  'Top of the feed for a full week.',          120,120,168, 10, 3)
  ) as v(name, descr, ps, pp, dur, prio, ord)
 where not exists (select 1 from public.social_promotion_tiers where ecosystem_id is null);

-- ============ post promotion snapshot ============
alter table public.social_posts
  add column if not exists promotion_tier_id uuid references public.social_promotion_tiers(id),
  add column if not exists promotion_tier_name text,
  add column if not exists promotion_duration_hours integer,
  add column if not exists promotion_expires_at timestamptz,
  add column if not exists promotion_priority integer not null default 0,
  add column if not exists promotion_refunded_at timestamptz,
  add column if not exists promotion_refund_reason text;

alter table public.dm_messages add column if not exists image_path text;

-- ============ effective settings ============
create or replace function public.social_effective_settings(_eco uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'social_enabled', coalesce(e.social_enabled, true),
    'daily_allowance', coalesce(e.daily_allowance, s.daily_allowance),
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
$$;

create or replace function public.social_tiers_for(_eco uuid)
returns table(id uuid, name text, description text, price_social integer, price_points integer,
              currency text, duration_hours integer, priority integer, eligibility text,
              active boolean, sort_order integer, is_default boolean)
language sql stable security definer set search_path to 'public' as $$
  select t.id, t.name, t.description, t.price_social, t.price_points, t.currency,
         t.duration_hours, t.priority, t.eligibility, t.active, t.sort_order,
         t.ecosystem_id is null
    from public.social_promotion_tiers t
   where t.ecosystem_id = _eco
      or (t.ecosystem_id is null
          and not exists (select 1 from public.social_promotion_tiers x where x.ecosystem_id = _eco))
   order by t.sort_order, t.priority;
$$;

-- ============ wallet uses effective allowance ============
create or replace function public.social_wallet(_user uuid)
returns social_credit_accounts language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _acct public.social_credit_accounts; _today date := (now() at time zone 'utc')::date;
        _allow integer;
begin
  select ecosystem_id into _eco from public.profiles where id = _user and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;

  insert into public.social_credit_accounts (user_id, ecosystem_id)
  values (_user, _eco) on conflict (user_id) do nothing;

  select * into _acct from public.social_credit_accounts where user_id = _user for update;

  if _acct.last_allowance_on is distinct from _today then
    _allow := (public.social_effective_settings(_eco) ->> 'daily_allowance')::integer;
    update public.social_credit_accounts set last_allowance_on = _today where id = _acct.id;
    if coalesce(_allow,0) > 0 then
      insert into public.social_credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                               balance_after, source, reason, reference)
      values (_acct.id, _user, _acct.ecosystem_id, 'credit', _allow, 0, 'daily_allowance',
              'Daily free social credits', _today::text);
    end if;
    select * into _acct from public.social_credit_accounts where id = _acct.id;
  end if;
  return _acct;
end; $$;

-- ============ state ============
create or replace function public.social_state()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _acct public.social_credit_accounts; _s jsonb; _ads integer; _tiers jsonb; _reseller boolean;
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
  return _s
    || jsonb_build_object('balance', _acct.balance,
                          'ecosystem_id', _acct.ecosystem_id,
                          'ads_claimed_today', _ads,
                          'promotion_tiers', _tiers);
end; $$;

-- ============ feed ============
drop function if exists public.social_feed(integer, timestamptz);
create function public.social_feed(_limit integer default 30, _before timestamptz default null)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text,
              body text, image_path text, promoted boolean, promotion_tier_name text,
              promotion_expires_at timestamptz, like_count integer, comment_count integer,
              liked_by_me boolean, created_at timestamptz, can_delete boolean)
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
         p.like_count, p.comment_count,
         exists (select 1 from public.social_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         (p.author_id = auth.uid() or public.social_can_moderate(auth.uid(), p.ecosystem_id))
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
   where p.ecosystem_id = _eco
     and p.status = 'active'
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

-- ============ create post ============
create or replace function public.social_create_post(_body text, _image_path text default null,
  _promote boolean default false, _tier_id uuid default null, _currency text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _s jsonb; _post uuid; _cost integer; _cur text; _tx text; _acct uuid;
        _me text; _after integer; _t record; _reseller boolean; _hours integer; _prio integer;
        _tname text; _expires timestamptz;
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
                                   promotion_expires_at, promotion_priority)
  values (_eco, auth.uid(), btrim(_body), _image_path, coalesce(_promote,false),
          case when coalesce(_promote,false) then _cur end,
          case when coalesce(_promote,false) then _cost end,
          case when coalesce(_promote,false) then _tier_id end,
          _tname, _hours, _expires, coalesce(_prio,0))
  returning id into _post;

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
                            'expires_at', _expires, 'balance', _after);
end; $$;

-- ============ comment uses effective settings + active promotion ============
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
  if _p.id is null or _p.ecosystem_id <> _eco or _p.status <> 'active' then
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
  perform public.social_wallet(auth.uid());

  insert into public.social_comments (post_id, ecosystem_id, author_id, body, charged)
  values (_p.id, _eco, auth.uid(), btrim(_body), _cost > 0) returning id into _cid;
  update public.social_posts set comment_count = comment_count + 1, updated_at = now() where id = _p.id;

  if _cost > 0 then
    _after := public.social_move(auth.uid(), 'debit', _cost, 'comment', 'Community reply', _cid::text);
  else
    _after := (public.social_wallet(auth.uid())).balance;
  end if;
  return jsonb_build_object('comment_id', _cid, 'charged', _cost, 'balance', _after);
end; $$;

-- ============ exchange uses effective rates ============
create or replace function public.social_exchange(_kind text, _amount integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _s jsonb; _granted integer; _tx text; _acct uuid; _after integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  perform public.require_operational();
  if _amount is null or _amount <= 0 or _amount > 100 then raise exception 'Enter an amount between 1 and 100'; end if;
  perform public.social_rate_limit(auth.uid(), array['credit_exchange','points_exchange'], interval '1 day', 20);

  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;
  _s := public.social_effective_settings(_eco);
  if not (_s ->> 'social_enabled')::boolean then raise exception 'The community is currently disabled'; end if;
  _tx := public.new_tx_id();

  if _kind = 'credit' then
    select id into _acct from public.credit_accounts where user_id = auth.uid();
    if _acct is null then raise exception 'Credit wallet not found'; end if;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_acct, auth.uid(), _eco, 'debit', _amount, 0,
            'Exchanged for social credits', 'SOCIAL', auth.uid(), _tx, 'transfer');
    _granted := _amount * (_s ->> 'credit_exchange_rate')::integer;
    _after := public.social_move(auth.uid(), 'credit', _granted, 'credit_exchange',
                                 'Exchanged ' || _amount || ' wallet credit(s)', _tx);
  elsif _kind = 'points' then
    select id into _acct from public.points_accounts where user_id = auth.uid();
    if _acct is null then raise exception 'Points wallet not found'; end if;
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_type)
    values (_acct, auth.uid(), _eco, 'debit', _amount, 0,
            'Exchanged for social credits', 'SOCIAL', auth.uid(), _tx, 'spend');
    _granted := _amount * (_s ->> 'points_exchange_rate')::integer;
    _after := public.social_move(auth.uid(), 'credit', _granted, 'points_exchange',
                                 'Exchanged ' || _amount || ' point(s)', _tx);
  else
    raise exception 'Unknown exchange type';
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  select _eco, auth.uid(), coalesce(p.full_name,''), 'Exchanged for social credits', _kind,
         jsonb_build_object('amount', _amount, 'granted', _granted, 'tx_id', _tx)
    from public.profiles p where p.id = auth.uid();

  return jsonb_build_object('granted', _granted, 'balance', _after, 'tx_id', _tx);
end; $$;

-- ============ DM images ============
create or replace function public.dm_send(_member_id uuid, _body text, _image_path text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _thread uuid; _eco uuid; _mid uuid;
begin
  if length(btrim(coalesce(_body,''))) = 0 and _image_path is null then
    raise exception 'Write a message first';
  end if;
  if length(coalesce(_body,'')) > 2000 then raise exception 'That message is too long'; end if;
  if (select count(*) from public.dm_messages
       where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'You are sending messages too quickly — please slow down';
  end if;
  _thread := public.dm_open_thread(_member_id);
  select ecosystem_id into _eco from public.dm_threads where id = _thread;
  if _image_path is not null and split_part(_image_path, '/', 1) <> _eco::text then
    raise exception 'Invalid image location';
  end if;
  insert into public.dm_messages (thread_id, ecosystem_id, sender_id, recipient_id, body, image_path)
  values (_thread, _eco, auth.uid(), _member_id, btrim(coalesce(_body,'')), _image_path)
  returning id into _mid;
  update public.dm_threads
     set last_message_at = now(),
         last_message_preview = coalesce(nullif(left(btrim(coalesce(_body,'')), 120), ''), 'Photo')
   where id = _thread;
  return jsonb_build_object('thread_id', _thread, 'message_id', _mid);
end; $$;

drop function if exists public.dm_messages_for(uuid);
create function public.dm_messages_for(_thread_id uuid)
returns table(id uuid, sender_id uuid, body text, image_path text, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.dm_threads t
                  where t.id = _thread_id and auth.uid() in (t.user_a, t.user_b)) then
    raise exception 'Conversation not found';
  end if;
  update public.dm_messages set read_at = now()
   where thread_id = _thread_id and recipient_id = auth.uid() and read_at is null;
  return query
  select m.id, m.sender_id, m.body, m.image_path, m.created_at, m.sender_id = auth.uid()
    from public.dm_messages m where m.thread_id = _thread_id order by m.created_at;
end; $$;

-- ============ admin settings RPCs ============
drop function if exists public.update_social_settings(integer,integer,integer,integer,integer,boolean,text,integer,integer,boolean,integer,integer);
create function public.update_social_settings(
  _daily_allowance integer, _post_cost integer, _comment_cost integer,
  _credit_exchange_rate integer, _points_exchange_rate integer,
  _promotion_enabled boolean, _promotion_currency text,
  _promotion_cost_social integer, _promotion_cost_points integer,
  _ads_enabled boolean, _ad_reward_amount integer, _ad_daily_limit integer,
  _ad_provider text default '', _allow_admin_overrides boolean default true,
  _max_daily_allowance integer default 20, _max_exchange_rate integer default 10,
  _image_max_px integer default 1000, _image_max_kb integer default 320)
returns social_settings language plpgsql security definer set search_path to 'public' as $$
declare _row public.social_settings; _me text;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Only the platform owner can change social settings'; end if;
  update public.social_settings set
    daily_allowance = greatest(_daily_allowance,0), post_cost = greatest(_post_cost,0),
    comment_cost = greatest(_comment_cost,0),
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
end; $$;

create or replace function public.update_ecosystem_social_settings(
  _social_enabled boolean, _daily_allowance integer default null, _post_cost integer default null,
  _comment_cost integer default null, _credit_exchange_rate integer default null,
  _points_exchange_rate integer default null, _promotion_enabled boolean default null,
  _ecosystem_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _s public.social_settings; _me text;
begin
  _eco := coalesce(_ecosystem_id, public.current_ecosystem(auth.uid()));
  if _eco is null or not public.social_can_moderate(auth.uid(), _eco) then raise exception 'Not allowed'; end if;
  select * into _s from public.social_settings where id = 1;
  if not _s.allow_admin_overrides and not public.is_super_admin(auth.uid()) then
    raise exception 'Shop-level community settings are locked by the platform owner';
  end if;
  if _daily_allowance is not null and (_daily_allowance < 0 or _daily_allowance > _s.max_daily_allowance) then
    raise exception 'Daily free social credits must be between 0 and %', _s.max_daily_allowance;
  end if;
  if _credit_exchange_rate is not null and (_credit_exchange_rate < 1 or _credit_exchange_rate > _s.max_exchange_rate) then
    raise exception 'Exchange rate must be between 1 and %', _s.max_exchange_rate;
  end if;
  if _points_exchange_rate is not null and (_points_exchange_rate < 1 or _points_exchange_rate > _s.max_exchange_rate) then
    raise exception 'Exchange rate must be between 1 and %', _s.max_exchange_rate;
  end if;
  if (_post_cost is not null and _post_cost < 0) or (_comment_cost is not null and _comment_cost < 0) then
    raise exception 'Costs cannot be negative';
  end if;

  insert into public.ecosystem_social_settings as e (ecosystem_id, social_enabled, daily_allowance, post_cost,
    comment_cost, credit_exchange_rate, points_exchange_rate, promotion_enabled, updated_by)
  values (_eco, coalesce(_social_enabled,true), _daily_allowance, _post_cost, _comment_cost,
          _credit_exchange_rate, _points_exchange_rate, _promotion_enabled, auth.uid())
  on conflict (ecosystem_id) do update set
    social_enabled = excluded.social_enabled, daily_allowance = excluded.daily_allowance,
    post_cost = excluded.post_cost, comment_cost = excluded.comment_cost,
    credit_exchange_rate = excluded.credit_exchange_rate,
    points_exchange_rate = excluded.points_exchange_rate,
    promotion_enabled = excluded.promotion_enabled, updated_by = auth.uid();

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,''), 'Updated community settings', 'Community',
          public.social_effective_settings(_eco));
  return public.social_effective_settings(_eco);
end; $$;

create or replace function public.upsert_social_promotion_tier(
  _name text, _description text, _price_social integer, _price_points integer, _currency text,
  _duration_hours integer, _priority integer, _eligibility text, _active boolean,
  _sort_order integer default 0, _tier_id uuid default null, _ecosystem_id uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _id uuid; _me text; _platform boolean;
begin
  _platform := _ecosystem_id is null and public.is_super_admin(auth.uid())
               and public.current_ecosystem(auth.uid()) is null;
  _eco := case when _platform then null else coalesce(_ecosystem_id, public.current_ecosystem(auth.uid())) end;
  if not _platform then
    if _eco is null or not public.social_can_moderate(auth.uid(), _eco) then raise exception 'Not allowed'; end if;
  end if;
  if length(btrim(coalesce(_name,''))) = 0 then raise exception 'Name the promotion'; end if;
  if _currency not in ('social','points','both') then raise exception 'Choose a valid currency'; end if;
  if _eligibility not in ('all','reseller') then raise exception 'Choose a valid eligibility'; end if;
  if _duration_hours < 1 or _duration_hours > 8760 then raise exception 'Duration must be 1-8760 hours'; end if;
  if _priority < 0 or _priority > 100 then raise exception 'Priority must be 0-100'; end if;
  if _price_social < 0 or _price_points < 0 then raise exception 'Prices cannot be negative'; end if;

  if _tier_id is null then
    -- first shop-level tier replaces the platform defaults for this shop
    insert into public.social_promotion_tiers (ecosystem_id, name, description, price_social, price_points,
      currency, duration_hours, priority, eligibility, active, sort_order)
    values (_eco, btrim(_name), coalesce(_description,''), _price_social, _price_points, _currency,
            _duration_hours, _priority, _eligibility, coalesce(_active,true), coalesce(_sort_order,0))
    returning id into _id;
  else
    update public.social_promotion_tiers set
      name = btrim(_name), description = coalesce(_description,''), price_social = _price_social,
      price_points = _price_points, currency = _currency, duration_hours = _duration_hours,
      priority = _priority, eligibility = _eligibility, active = coalesce(_active,true),
      sort_order = coalesce(_sort_order,0)
    where id = _tier_id and ecosystem_id is not distinct from _eco
    returning id into _id;
    if _id is null then raise exception 'That promotion could not be updated'; end if;
  end if;

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Platform owner'), 'Saved promotion tier', btrim(_name),
          jsonb_build_object('tier_id', _id, 'price_social', _price_social, 'price_points', _price_points,
                             'currency', _currency, 'duration_hours', _duration_hours,
                             'priority', _priority, 'eligibility', _eligibility, 'active', _active));
  return _id;
end; $$;

create or replace function public.delete_social_promotion_tier(_tier_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _row public.social_promotion_tiers; _me text;
begin
  select * into _row from public.social_promotion_tiers where id = _tier_id;
  if _row.id is null then raise exception 'That promotion no longer exists'; end if;
  if _row.ecosystem_id is null then
    if not public.is_super_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  elsif not public.social_can_moderate(auth.uid(), _row.ecosystem_id) then
    raise exception 'Not allowed';
  end if;
  _eco := _row.ecosystem_id;
  update public.social_promotion_tiers set active = false where id = _tier_id;
  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Platform owner'), 'Disabled promotion tier', _row.name,
          jsonb_build_object('tier_id', _tier_id));
end; $$;

-- ============ explicit, authorized promotion refund ============
create or replace function public.social_refund_promotion(_post_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _p public.social_posts; _tx text; _acct uuid; _me text; _after integer;
begin
  if length(btrim(coalesce(_reason,''))) < 4 then raise exception 'Give a reason for the refund'; end if;
  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null then raise exception 'That post no longer exists'; end if;
  if not public.social_can_moderate(auth.uid(), _p.ecosystem_id) then raise exception 'Not allowed'; end if;
  if not _p.promoted or coalesce(_p.promotion_cost,0) = 0 then raise exception 'That post has no promotion charge'; end if;
  if _p.promotion_refunded_at is not null then raise exception 'That promotion was already refunded'; end if;

  _tx := public.new_tx_id();
  if _p.promotion_currency = 'points' then
    select id into _acct from public.points_accounts where user_id = _p.author_id;
    if _acct is null then raise exception 'Points wallet not found'; end if;
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_type)
    values (_acct, _p.author_id, _p.ecosystem_id, 'credit', _p.promotion_cost, 0,
            'Promotion refund: ' || btrim(_reason), 'SOCIAL', auth.uid(), _tx, 'adjust');
    _after := null;
  else
    _after := public.social_move(_p.author_id, 'credit', _p.promotion_cost, 'promotion_refund',
                                 'Promotion refund: ' || btrim(_reason), _p.id::text);
  end if;

  update public.social_posts
     set promoted = false, promotion_refunded_at = now(), promotion_refund_reason = btrim(_reason),
         promotion_priority = 0, updated_at = now()
   where id = _p.id;

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_p.ecosystem_id, auth.uid(), coalesce(_me,''), 'Refunded a promotion', _p.id::text,
          jsonb_build_object('amount', _p.promotion_cost, 'currency', _p.promotion_currency,
                             'reason', btrim(_reason), 'tx_id', _tx));
  return jsonb_build_object('refunded', _p.promotion_cost, 'currency', _p.promotion_currency, 'tx_id', _tx);
end; $$;
