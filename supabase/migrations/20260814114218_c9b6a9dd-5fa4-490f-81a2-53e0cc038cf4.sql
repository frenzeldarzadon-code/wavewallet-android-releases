alter table public.social_credit_accounts
  add column if not exists free_balance integer not null default 0;

-- Comments/replies are always free.
update public.social_settings set comment_cost = 0 where comment_cost <> 0;
update public.ecosystem_social_settings set comment_cost = 0 where comment_cost is not null and comment_cost <> 0;

-- Ledger trigger: free allowance resets, spending drains free first then purchased.
create or replace function public.apply_social_credit_entry()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _free integer; _paid integer; _take integer;
begin
  select free_balance, balance into _free, _paid
    from public.social_credit_accounts where id = new.account_id for update;
  if _paid is null then raise exception 'Social wallet not found'; end if;

  if new.direction = 'credit' then
    if new.source = 'daily_allowance' then
      -- A daily allowance is a fresh grant for today, never a top-up: it replaces
      -- whatever free credits were left over from the previous day.
      _free := new.amount;
    else
      _paid := _paid + new.amount;
    end if;
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

-- Wallet: reset (not accumulate) the free allowance on each new server day (UTC).
create or replace function public.social_wallet(_user uuid)
returns social_credit_accounts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _eco uuid; _acct public.social_credit_accounts; _today date := (now() at time zone 'utc')::date;
        _allow integer; _zero uuid := '00000000-0000-0000-0000-000000000000';
begin
  select ecosystem_id into _eco from public.profiles where id = _user and deleted_at is null;

  insert into public.social_credit_accounts (user_id, ecosystem_id)
  values (_user, _eco)
  on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;

  select * into _acct from public.social_credit_accounts
   where user_id = _user and coalesce(ecosystem_id, _zero) = coalesce(_eco, _zero)
   for update;

  if _acct.last_allowance_on is distinct from _today then
    _allow := coalesce((public.social_effective_settings(_acct.ecosystem_id) ->> 'daily_allowance')::integer, 0);
    update public.social_credit_accounts
       set last_allowance_on = _today,
           free_balance = case when _allow > 0 then free_balance else 0 end,
           updated_at = now()
     where id = _acct.id;
    if _allow > 0 then
      insert into public.social_credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                               balance_after, source, reason, reference)
      values (_acct.id, _user, _acct.ecosystem_id, 'credit', _allow, 0, 'daily_allowance',
              'Daily free social credits', _today::text);
    end if;
    select * into _acct from public.social_credit_accounts where id = _acct.id;
  end if;
  return _acct;
end; $function$;

-- Replies are free, always.
create or replace function public.social_create_comment(_post_id uuid, _body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _eco uuid; _p public.social_posts; _s jsonb; _cid uuid; _after integer;
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

  insert into public.social_comments (post_id, ecosystem_id, author_id, body, charged)
  values (_p.id, _eco, auth.uid(), btrim(_body), false)
  returning id into _cid;
  update public.social_posts set comment_count = comment_count + 1 where id = _p.id;

  _after := (public.social_wallet(auth.uid())).free_balance + (public.social_wallet(auth.uid())).balance;
  return jsonb_build_object('comment_id', _cid, 'charged', 0, 'balance', _after);
end; $function$;

-- State: report the combined spendable balance plus its two parts.
create or replace function public.social_state()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    || jsonb_build_object('balance', _acct.free_balance + _acct.balance,
                          'free_balance', _acct.free_balance,
                          'purchased_balance', _acct.balance,
                          'comment_cost', 0,
                          'ecosystem_id', _acct.ecosystem_id,
                          'ads_claimed_today', _ads,
                          'promotion_tiers', _tiers);
end; $function$;

-- social_move must report the combined balance too.
create or replace function public.social_move(_user uuid, _direction text, _amount integer, _source text, _reason text, _reference text default null::text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _acct public.social_credit_accounts; _after integer;
begin
  _acct := public.social_wallet(_user);
  if _amount <= 0 then return _acct.free_balance + _acct.balance; end if;
  insert into public.social_credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                           balance_after, source, reason, reference)
  values (_acct.id, _user, _acct.ecosystem_id, _direction, _amount, 0, _source, _reason, _reference)
  returning balance_after into _after;
  return _after;
end; $function$;