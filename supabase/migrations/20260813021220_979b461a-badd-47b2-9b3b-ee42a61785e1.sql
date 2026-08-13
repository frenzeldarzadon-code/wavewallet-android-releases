
-- ============ SETTINGS ============
create table public.social_settings (
  id integer primary key default 1,
  daily_allowance integer not null default 5,
  post_cost integer not null default 1,
  comment_cost integer not null default 1,
  credit_exchange_rate integer not null default 2,
  points_exchange_rate integer not null default 2,
  promotion_enabled boolean not null default true,
  promotion_currency text not null default 'social',
  promotion_cost_social integer not null default 20,
  promotion_cost_points integer not null default 20,
  ads_enabled boolean not null default false,
  ad_reward_amount integer not null default 5,
  ad_daily_limit integer not null default 3,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_settings_singleton check (id = 1),
  constraint social_settings_currency check (promotion_currency in ('social','points')),
  constraint social_settings_ranges check (
    daily_allowance between 0 and 100 and post_cost between 0 and 50 and comment_cost between 0 and 50
    and credit_exchange_rate between 1 and 100 and points_exchange_rate between 1 and 100
    and promotion_cost_social between 0 and 1000 and promotion_cost_points between 0 and 1000
    and ad_reward_amount between 0 and 50 and ad_daily_limit between 0 and 50)
);
grant select on public.social_settings to authenticated;
grant all on public.social_settings to service_role;
alter table public.social_settings enable row level security;
create policy "Signed-in members read social settings" on public.social_settings for select to authenticated using (true);
insert into public.social_settings (id) values (1);
create trigger social_settings_updated before update on public.social_settings
  for each row execute function public.set_updated_at();

-- ============ SOCIAL CREDIT WALLET ============
create table public.social_credit_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  balance integer not null default 0,
  last_allowance_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_balance_non_negative check (balance >= 0)
);
grant select on public.social_credit_accounts to authenticated;
grant all on public.social_credit_accounts to service_role;
alter table public.social_credit_accounts enable row level security;
create policy "Own social wallet" on public.social_credit_accounts for select to authenticated
  using (user_id = auth.uid()
     or public.is_super_admin(auth.uid())
     or public.is_ecosystem_admin(auth.uid(), ecosystem_id));

create table public.social_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_credit_accounts(id) on delete cascade,
  user_id uuid not null,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  direction text not null,
  amount integer not null,
  balance_after integer not null,
  source text not null,
  reason text not null,
  reference text,
  created_at timestamptz not null default now(),
  constraint social_ledger_direction check (direction in ('credit','debit')),
  constraint social_ledger_amount check (amount > 0),
  constraint social_ledger_source check (source in
    ('daily_allowance','credit_exchange','points_exchange','ad_reward','admin_grant',
     'post','comment','promotion'))
);
create index social_ledger_user_idx on public.social_credit_ledger (user_id, created_at desc);
create index social_ledger_eco_idx on public.social_credit_ledger (ecosystem_id, created_at desc);
grant select on public.social_credit_ledger to authenticated;
grant all on public.social_credit_ledger to service_role;
alter table public.social_credit_ledger enable row level security;
create policy "Own social ledger" on public.social_credit_ledger for select to authenticated
  using (user_id = auth.uid()
     or public.is_super_admin(auth.uid())
     or public.is_ecosystem_admin(auth.uid(), ecosystem_id));
create trigger social_ledger_immutable before update or delete on public.social_credit_ledger
  for each row execute function public.block_ledger_mutation();

-- ============ POSTS / COMMENTS / LIKES ============
create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  author_id uuid not null,
  body text not null,
  image_path text,
  promoted boolean not null default false,
  promotion_currency text,
  promotion_cost integer,
  status text not null default 'active',
  removed_by uuid,
  removed_reason text,
  removed_at timestamptz,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_post_status check (status in ('active','removed')),
  constraint social_post_body check (length(btrim(body)) between 1 and 2000)
);
create index social_posts_feed_idx on public.social_posts (ecosystem_id, created_at desc);
grant select on public.social_posts to authenticated;
grant all on public.social_posts to service_role;
alter table public.social_posts enable row level security;
create policy "Shop members read posts" on public.social_posts for select to authenticated
  using (public.is_super_admin(auth.uid())
     or ecosystem_id = public.current_ecosystem(auth.uid()));

create table public.social_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  author_id uuid not null,
  body text not null,
  status text not null default 'active',
  removed_by uuid,
  removed_reason text,
  removed_at timestamptz,
  charged boolean not null default true,
  created_at timestamptz not null default now(),
  constraint social_comment_status check (status in ('active','removed')),
  constraint social_comment_body check (length(btrim(body)) between 1 and 1000)
);
create index social_comments_post_idx on public.social_comments (post_id, created_at);
grant select on public.social_comments to authenticated;
grant all on public.social_comments to service_role;
alter table public.social_comments enable row level security;
create policy "Shop members read comments" on public.social_comments for select to authenticated
  using (public.is_super_admin(auth.uid())
     or ecosystem_id = public.current_ecosystem(auth.uid()));

create table public.social_likes (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
grant select on public.social_likes to authenticated;
grant all on public.social_likes to service_role;
alter table public.social_likes enable row level security;
create policy "Shop members read likes" on public.social_likes for select to authenticated
  using (public.is_super_admin(auth.uid())
     or ecosystem_id = public.current_ecosystem(auth.uid()));

-- ============ MODERATION ============
create table public.social_blocks (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  constraint social_block_self check (blocker_id <> blocked_id)
);
grant select on public.social_blocks to authenticated;
grant all on public.social_blocks to service_role;
alter table public.social_blocks enable row level security;
create policy "Own blocks" on public.social_blocks for select to authenticated
  using (blocker_id = auth.uid() or public.is_super_admin(auth.uid())
     or public.is_ecosystem_admin(auth.uid(), ecosystem_id));

create table public.social_reports (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  reporter_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  target_user_id uuid,
  reason text not null,
  status text not null default 'open',
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint social_report_target check (target_type in ('post','comment','message','member')),
  constraint social_report_status check (status in ('open','actioned','dismissed'))
);
grant select on public.social_reports to authenticated;
grant all on public.social_reports to service_role;
alter table public.social_reports enable row level security;
create policy "Reports visible to reporter and moderators" on public.social_reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_super_admin(auth.uid())
     or public.is_ecosystem_admin(auth.uid(), ecosystem_id));

-- ============ DIRECT MESSAGES ============
create table public.dm_threads (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  user_a uuid not null,
  user_b uuid not null,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now(),
  unique (ecosystem_id, user_a, user_b),
  constraint dm_thread_order check (user_a < user_b)
);
grant select on public.dm_threads to authenticated;
grant all on public.dm_threads to service_role;
alter table public.dm_threads enable row level security;
create policy "Participants read threads" on public.dm_threads for select to authenticated
  using (auth.uid() in (user_a, user_b));

create table public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  sender_id uuid not null,
  recipient_id uuid not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dm_body check (length(btrim(body)) between 1 and 2000)
);
create index dm_messages_thread_idx on public.dm_messages (thread_id, created_at);
grant select on public.dm_messages to authenticated;
grant all on public.dm_messages to service_role;
alter table public.dm_messages enable row level security;
create policy "Participants read messages" on public.dm_messages for select to authenticated
  using (auth.uid() in (sender_id, recipient_id));

-- ============ REWARDED AD EVENTS ============
create table public.social_ad_events (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  user_id uuid not null,
  provider text not null,
  provider_event_id text not null,
  verified boolean not null default false,
  claimed_at timestamptz,
  reward_amount integer,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
grant select on public.social_ad_events to authenticated;
grant all on public.social_ad_events to service_role;
alter table public.social_ad_events enable row level security;
create policy "Own ad events" on public.social_ad_events for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin(auth.uid())
     or public.is_ecosystem_admin(auth.uid(), ecosystem_id));

-- ============ BALANCE TRIGGER ============
create or replace function public.apply_social_credit_entry()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _bal integer;
begin
  select balance into _bal from public.social_credit_accounts where id = new.account_id for update;
  if _bal is null then raise exception 'Social wallet not found'; end if;
  _bal := _bal + case when new.direction = 'credit' then new.amount else -new.amount end;
  if _bal < 0 then raise exception 'Not enough social credits'; end if;
  update public.social_credit_accounts set balance = _bal, updated_at = now() where id = new.account_id;
  new.balance_after := _bal;
  return new;
end; $$;
create trigger social_ledger_apply before insert on public.social_credit_ledger
  for each row execute function public.apply_social_credit_entry();

-- ============ HELPERS ============
create or replace function public.social_rate_limit(_user uuid, _sources text[], _window interval, _max integer)
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare _n integer;
begin
  select count(*) into _n from public.social_credit_ledger
   where user_id = _user and source = any(_sources) and created_at > now() - _window;
  if _n >= _max then raise exception 'You are doing that too often — please try again later'; end if;
end; $$;

-- Ensures the wallet exists and tops up today's free allowance exactly once per UTC day.
create or replace function public.social_wallet(_user uuid)
returns public.social_credit_accounts language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _acct public.social_credit_accounts; _today date := (now() at time zone 'utc')::date;
        _allow integer;
begin
  select ecosystem_id into _eco from public.profiles where id = _user and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;

  insert into public.social_credit_accounts (user_id, ecosystem_id)
  values (_user, _eco) on conflict (user_id) do nothing;

  select * into _acct from public.social_credit_accounts where user_id = _user for update;

  if _acct.last_allowance_on is distinct from _today then
    select daily_allowance into _allow from public.social_settings where id = 1;
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

create or replace function public.social_move(_user uuid, _direction text, _amount integer,
                                              _source text, _reason text, _reference text default null)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare _acct public.social_credit_accounts; _after integer;
begin
  _acct := public.social_wallet(_user);
  if _amount <= 0 then return _acct.balance; end if;
  insert into public.social_credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                           balance_after, source, reason, reference)
  values (_acct.id, _user, _acct.ecosystem_id, _direction, _amount, 0, _source, _reason, _reference)
  returning balance_after into _after;
  return _after;
end; $$;

create or replace function public.social_can_moderate(_user uuid, _eco uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_super_admin(_user) or public.is_ecosystem_admin(_user, _eco);
$$;

-- ============ STATE ============
create or replace function public.social_state()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _acct public.social_credit_accounts; _s public.social_settings; _ads integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  _acct := public.social_wallet(auth.uid());
  select * into _s from public.social_settings where id = 1;
  select count(*) into _ads from public.social_ad_events
   where user_id = auth.uid() and claimed_at > (now() at time zone 'utc')::date;
  return jsonb_build_object(
    'balance', _acct.balance,
    'ecosystem_id', _acct.ecosystem_id,
    'daily_allowance', _s.daily_allowance,
    'post_cost', _s.post_cost,
    'comment_cost', _s.comment_cost,
    'credit_exchange_rate', _s.credit_exchange_rate,
    'points_exchange_rate', _s.points_exchange_rate,
    'promotion_enabled', _s.promotion_enabled,
    'promotion_currency', _s.promotion_currency,
    'promotion_cost_social', _s.promotion_cost_social,
    'promotion_cost_points', _s.promotion_cost_points,
    'ads_enabled', _s.ads_enabled,
    'ad_reward_amount', _s.ad_reward_amount,
    'ad_daily_limit', _s.ad_daily_limit,
    'ads_claimed_today', _ads);
end; $$;

create or replace function public.update_social_settings(
  _daily_allowance integer, _post_cost integer, _comment_cost integer,
  _credit_exchange_rate integer, _points_exchange_rate integer,
  _promotion_enabled boolean, _promotion_currency text,
  _promotion_cost_social integer, _promotion_cost_points integer,
  _ads_enabled boolean, _ad_reward_amount integer, _ad_daily_limit integer)
returns public.social_settings language plpgsql security definer set search_path to 'public' as $$
declare _row public.social_settings; _me text;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Only the platform owner can change social settings'; end if;
  update public.social_settings set
    daily_allowance = _daily_allowance, post_cost = _post_cost, comment_cost = _comment_cost,
    credit_exchange_rate = _credit_exchange_rate, points_exchange_rate = _points_exchange_rate,
    promotion_enabled = _promotion_enabled, promotion_currency = _promotion_currency,
    promotion_cost_social = _promotion_cost_social, promotion_cost_points = _promotion_cost_points,
    ads_enabled = _ads_enabled, ad_reward_amount = _ad_reward_amount, ad_daily_limit = _ad_daily_limit,
    updated_by = auth.uid()
  where id = 1 returning * into _row;
  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce(_me,'Platform owner'), 'Updated social settings', 'Platform',
          to_jsonb(_row));
  return _row;
end; $$;

-- ============ EXCHANGE ============
create or replace function public.social_exchange(_kind text, _amount integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _s public.social_settings; _granted integer; _tx text; _acct uuid; _after integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  perform public.require_operational();
  if _amount is null or _amount <= 0 or _amount > 100 then raise exception 'Enter an amount between 1 and 100'; end if;
  perform public.social_rate_limit(auth.uid(), array['credit_exchange','points_exchange'], interval '1 day', 20);

  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then raise exception 'Your account is not part of a shop'; end if;
  select * into _s from public.social_settings where id = 1;
  _tx := public.new_tx_id();

  if _kind = 'credit' then
    select id into _acct from public.credit_accounts where user_id = auth.uid();
    if _acct is null then raise exception 'Credit wallet not found'; end if;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_acct, auth.uid(), _eco, 'debit', _amount, 0,
            'Exchanged for social credits', 'SOCIAL', auth.uid(), _tx, 'transfer');
    _granted := _amount * _s.credit_exchange_rate;
    _after := public.social_move(auth.uid(), 'credit', _granted, 'credit_exchange',
                                 'Exchanged ' || _amount || ' wallet credit(s)', _tx);
  elsif _kind = 'points' then
    select id into _acct from public.points_accounts where user_id = auth.uid();
    if _acct is null then raise exception 'Points wallet not found'; end if;
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_type)
    values (_acct, auth.uid(), _eco, 'debit', _amount, 0,
            'Exchanged for social credits', 'SOCIAL', auth.uid(), _tx, 'spend');
    _granted := _amount * _s.points_exchange_rate;
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

-- Rewarded ads: only a verified, unclaimed provider event can ever grant credits.
create or replace function public.social_claim_ad_reward(_provider text, _provider_event_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _s public.social_settings; _ev public.social_ad_events; _today date := (now() at time zone 'utc')::date;
        _count integer; _after integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  select * into _s from public.social_settings where id = 1;
  if not _s.ads_enabled then raise exception 'Rewarded ads are not available yet'; end if;

  select * into _ev from public.social_ad_events
   where provider = _provider and provider_event_id = _provider_event_id for update;
  if _ev.id is null or not _ev.verified then raise exception 'That ad view could not be verified'; end if;
  if _ev.user_id <> auth.uid() then raise exception 'That ad view belongs to another member'; end if;
  if _ev.claimed_at is not null then raise exception 'That ad reward was already claimed'; end if;

  select count(*) into _count from public.social_ad_events
   where user_id = auth.uid() and claimed_at >= _today;
  if _count >= _s.ad_daily_limit then raise exception 'You reached today''s ad reward limit'; end if;

  update public.social_ad_events set claimed_at = now(), reward_amount = _s.ad_reward_amount where id = _ev.id;
  _after := public.social_move(auth.uid(), 'credit', _s.ad_reward_amount, 'ad_reward',
                               'Rewarded ad', _ev.provider_event_id);
  return jsonb_build_object('granted', _s.ad_reward_amount, 'balance', _after);
end; $$;

-- ============ POSTING ============
create or replace function public.social_create_post(_body text, _image_path text default null,
                                                     _promote boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _s public.social_settings; _post uuid; _cost integer; _cur text;
        _tx text; _acct uuid; _me text; _after integer;
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

  select * into _s from public.social_settings where id = 1;
  perform public.social_wallet(auth.uid());
  _tx := public.new_tx_id();

  if coalesce(_promote,false) then
    if not _s.promotion_enabled then raise exception 'Promotion is currently disabled'; end if;
    _cur := _s.promotion_currency;
    _cost := case when _cur = 'points' then _s.promotion_cost_points else _s.promotion_cost_social end;
  else
    _cur := 'social';
    _cost := _s.post_cost;
  end if;

  insert into public.social_posts (ecosystem_id, author_id, body, image_path, promoted,
                                   promotion_currency, promotion_cost)
  values (_eco, auth.uid(), btrim(_body), _image_path, coalesce(_promote,false),
          case when coalesce(_promote,false) then _cur end,
          case when coalesce(_promote,false) then _cost end)
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
            jsonb_build_object('cost', _cost, 'currency', _cur, 'tx_id', _tx));
  end if;

  return jsonb_build_object('post_id', _post, 'charged', _cost, 'currency', _cur,
                            'promoted', coalesce(_promote,false), 'balance', _after);
end; $$;

create or replace function public.social_create_comment(_post_id uuid, _body text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _p public.social_posts; _s public.social_settings; _cost integer; _cid uuid; _after integer;
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

  select * into _s from public.social_settings where id = 1;
  -- Disclosed rule: replies to a promoted post are free.
  _cost := case when _p.promoted then 0 else _s.comment_cost end;
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

create or replace function public.social_toggle_like(_post_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _p public.social_posts; _liked boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  select * into _p from public.social_posts where id = _post_id;
  if _p.id is null or _p.ecosystem_id <> _eco or _p.status <> 'active' then
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
    'likes', (select like_count from public.social_posts where id = _p.id));
end; $$;

-- ============ FEED READS ============
create or replace function public.social_feed(_limit integer default 30, _before timestamptz default null)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text,
              body text, image_path text, promoted boolean, like_count integer, comment_count integer,
              liked_by_me boolean, created_at timestamptz, can_delete boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare _eco uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null then return; end if;
  return query
  select p.id, p.author_id, coalesce(a.full_name,'Member'), a.handle, a.avatar_path,
         p.body, p.image_path, p.promoted, p.like_count, p.comment_count,
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
   order by p.promoted desc, p.created_at desc
   limit least(coalesce(_limit,30), 50);
end; $$;

create or replace function public.social_post_comments(_post_id uuid)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text,
              body text, created_at timestamptz, can_delete boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare _eco uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  return query
  select c.id, c.author_id, coalesce(a.full_name,'Member'), a.handle, a.avatar_path, c.body, c.created_at,
         (c.author_id = auth.uid() or public.social_can_moderate(auth.uid(), c.ecosystem_id))
    from public.social_comments c
    join public.profiles a on a.id = c.author_id
   where c.post_id = _post_id and c.ecosystem_id = _eco and c.status = 'active'
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = c.author_id)
                         or (b.blocker_id = c.author_id and b.blocked_id = auth.uid()))
   order by c.created_at;
end; $$;

-- ============ MODERATION ACTIONS ============
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

create or replace function public.social_delete_comment(_comment_id uuid, _reason text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _c public.social_comments; _me text;
begin
  select * into _c from public.social_comments where id = _comment_id;
  if _c.id is null then raise exception 'That reply is not available'; end if;
  if _c.author_id <> auth.uid() and not public.social_can_moderate(auth.uid(), _c.ecosystem_id) then
    raise exception 'You cannot remove this reply';
  end if;
  update public.social_comments set status = 'removed', removed_by = auth.uid(),
         removed_reason = nullif(btrim(coalesce(_reason,'')),''), removed_at = now()
   where id = _c.id and status = 'active';
  if found then
    update public.social_posts set comment_count = greatest(comment_count - 1, 0) where id = _c.post_id;
  end if;
  select full_name into _me from public.profiles where id = auth.uid();
  if _c.author_id <> auth.uid() then
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_c.ecosystem_id, auth.uid(), coalesce(_me,''), 'Removed a community reply', _c.id::text,
            jsonb_build_object('author_id', _c.author_id, 'reason', _reason));
  end if;
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
    select author_id into _target_user from public.social_posts where id = _target_id and ecosystem_id = _eco;
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

create or replace function public.social_review_report(_report_id uuid, _status text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _r public.social_reports; _me text;
begin
  select * into _r from public.social_reports where id = _report_id;
  if _r.id is null then raise exception 'Report not found'; end if;
  if not public.social_can_moderate(auth.uid(), _r.ecosystem_id) then raise exception 'Not allowed'; end if;
  if _status not in ('actioned','dismissed') then raise exception 'Unknown status'; end if;
  update public.social_reports set status = _status, handled_by = auth.uid(), handled_at = now()
   where id = _r.id;
  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_r.ecosystem_id, auth.uid(), coalesce(_me,''), 'Reviewed a community report', _r.id::text,
          jsonb_build_object('status', _status, 'target_type', _r.target_type, 'target_id', _r.target_id));
end; $$;

create or replace function public.social_set_block(_member_id uuid, _blocked boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if _member_id = auth.uid() then raise exception 'You cannot block yourself'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null or not exists (select 1 from public.profiles
        where id = _member_id and ecosystem_id = _eco and deleted_at is null) then
    raise exception 'That member is not available';
  end if;
  if _blocked then
    insert into public.social_blocks (ecosystem_id, blocker_id, blocked_id)
    values (_eco, auth.uid(), _member_id) on conflict (blocker_id, blocked_id) do nothing;
  else
    delete from public.social_blocks where blocker_id = auth.uid() and blocked_id = _member_id;
  end if;
end; $$;

-- ============ DIRECT MESSAGES ============
create or replace function public.dm_open_thread(_member_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _a uuid; _b uuid; _id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  if _member_id = auth.uid() then raise exception 'Pick another member'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null or not exists (select 1 from public.profiles
        where id = _member_id and ecosystem_id = _eco and deleted_at is null and status = 'active') then
    raise exception 'That member is not available';
  end if;
  if exists (select 1 from public.social_blocks
              where (blocker_id = _member_id and blocked_id = auth.uid())
                 or (blocker_id = auth.uid() and blocked_id = _member_id)) then
    raise exception 'You cannot message this member';
  end if;
  _a := least(auth.uid(), _member_id); _b := greatest(auth.uid(), _member_id);
  insert into public.dm_threads (ecosystem_id, user_a, user_b) values (_eco, _a, _b)
    on conflict (ecosystem_id, user_a, user_b) do nothing;
  select id into _id from public.dm_threads where ecosystem_id = _eco and user_a = _a and user_b = _b;
  return _id;
end; $$;

create or replace function public.dm_send(_member_id uuid, _body text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _thread uuid; _eco uuid; _mid uuid;
begin
  if length(btrim(coalesce(_body,''))) = 0 then raise exception 'Write a message first'; end if;
  if length(_body) > 2000 then raise exception 'That message is too long'; end if;
  if (select count(*) from public.dm_messages
       where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'You are sending messages too quickly — please slow down';
  end if;
  _thread := public.dm_open_thread(_member_id);
  select ecosystem_id into _eco from public.dm_threads where id = _thread;
  insert into public.dm_messages (thread_id, ecosystem_id, sender_id, recipient_id, body)
  values (_thread, _eco, auth.uid(), _member_id, btrim(_body)) returning id into _mid;
  update public.dm_threads set last_message_at = now(), last_message_preview = left(btrim(_body), 120)
   where id = _thread;
  return jsonb_build_object('thread_id', _thread, 'message_id', _mid);
end; $$;

create or replace function public.dm_thread_list()
returns table(thread_id uuid, member_id uuid, member_name text, member_handle text, member_avatar text,
              last_message_at timestamptz, preview text, unread integer, blocked boolean)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  return query
  select t.id,
         other.id, coalesce(other.full_name,'Member'), other.handle, other.avatar_path,
         t.last_message_at, t.last_message_preview,
         (select count(*)::int from public.dm_messages m
           where m.thread_id = t.id and m.recipient_id = auth.uid() and m.read_at is null),
         exists (select 1 from public.social_blocks b
                  where (b.blocker_id = auth.uid() and b.blocked_id = other.id)
                     or (b.blocker_id = other.id and b.blocked_id = auth.uid()))
    from public.dm_threads t
    join public.profiles other
      on other.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
   where auth.uid() in (t.user_a, t.user_b)
   order by coalesce(t.last_message_at, t.created_at) desc;
end; $$;

create or replace function public.dm_messages_for(_thread_id uuid)
returns table(id uuid, sender_id uuid, body text, created_at timestamptz, mine boolean)
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
  select m.id, m.sender_id, m.body, m.created_at, m.sender_id = auth.uid()
    from public.dm_messages m where m.thread_id = _thread_id order by m.created_at;
end; $$;

create or replace function public.dm_unread_count()
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce(count(*),0)::int from public.dm_messages
   where recipient_id = auth.uid() and read_at is null;
$$;

-- ============ ADMIN VIEWS ============
create or replace function public.social_admin_activity(_ecosystem_id uuid default null, _limit integer default 100)
returns table(created_at timestamptz, user_id uuid, user_name text, direction text, amount integer,
              source text, reason text, balance_after integer)
language plpgsql stable security definer set search_path to 'public' as $$
declare _eco uuid;
begin
  _eco := coalesce(_ecosystem_id, public.current_ecosystem(auth.uid()));
  if not public.social_can_moderate(auth.uid(), _eco) then raise exception 'Not allowed'; end if;
  return query
  select l.created_at, l.user_id, coalesce(p.full_name,'Member'), l.direction, l.amount,
         l.source, l.reason, l.balance_after
    from public.social_credit_ledger l
    left join public.profiles p on p.id = l.user_id
   where l.ecosystem_id = _eco
   order by l.created_at desc
   limit least(coalesce(_limit,100), 500);
end; $$;

create or replace function public.social_admin_reports(_ecosystem_id uuid default null)
returns table(id uuid, created_at timestamptz, target_type text, target_id uuid, reason text,
              status text, reporter_name text, target_name text, content text)
language plpgsql stable security definer set search_path to 'public' as $$
declare _eco uuid;
begin
  _eco := coalesce(_ecosystem_id, public.current_ecosystem(auth.uid()));
  if not public.social_can_moderate(auth.uid(), _eco) then raise exception 'Not allowed'; end if;
  return query
  select r.id, r.created_at, r.target_type, r.target_id, r.reason, r.status,
         coalesce(rp.full_name,'Member'), coalesce(tp.full_name,'Member'),
         case r.target_type
           when 'post' then (select left(sp.body,200) from public.social_posts sp where sp.id = r.target_id)
           when 'comment' then (select left(sc.body,200) from public.social_comments sc where sc.id = r.target_id)
           else null end
    from public.social_reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles tp on tp.id = r.target_user_id
   where r.ecosystem_id = _eco
   order by (r.status = 'open') desc, r.created_at desc
   limit 200;
end; $$;

-- ============ EXECUTE GRANTS ============
revoke execute on function public.social_wallet(uuid) from public, anon, authenticated;
revoke execute on function public.social_move(uuid, text, integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.social_rate_limit(uuid, text[], interval, integer) from public, anon, authenticated;
revoke execute on function public.apply_social_credit_entry() from public, anon, authenticated;

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

-- ============ STORAGE POLICIES ============
create policy "Shop members view social images" on storage.objects for select to authenticated
  using (bucket_id = 'social-images'
     and (public.is_super_admin(auth.uid())
          or (storage.foldername(name))[1] = (public.current_ecosystem(auth.uid()))::text));
create policy "Members upload social images" on storage.objects for insert to authenticated
  with check (bucket_id = 'social-images'
     and (storage.foldername(name))[1] = (public.current_ecosystem(auth.uid()))::text
     and (storage.foldername(name))[2] = (auth.uid())::text);
create policy "Members or admins delete social images" on storage.objects for delete to authenticated
  using (bucket_id = 'social-images'
     and ((storage.foldername(name))[2] = (auth.uid())::text
          or public.is_super_admin(auth.uid())
          or public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)));
