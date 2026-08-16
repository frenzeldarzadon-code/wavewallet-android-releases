-- ============================================================
-- Guard: review shops may never write to the real credit ledger,
-- and Subscription Shops may never move coins across shops.
-- ============================================================
create or replace function public.guard_shop_kind_ledger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _kind text; _review boolean;
begin
  if new.ecosystem_id is null then return new; end if;
  select shop_kind, is_review into _kind, _review
    from public.ecosystems where id = new.ecosystem_id;
  if coalesce(_review, false) then
    raise exception 'This is a review shop — its coins are simulated and never touch real balances';
  end if;
  if _kind = 'subscription' and new.entry_kind in ('shop_transfer_in','shop_transfer_out') then
    raise exception 'Coins cannot move between shops in a Subscription Shop';
  end if;
  return new;
end $$;

drop trigger if exists guard_shop_kind_ledger on public.credit_ledger;
create trigger guard_shop_kind_ledger
  before insert on public.credit_ledger
  for each row execute function public.guard_shop_kind_ledger();

create or replace function public.guard_subscription_cashout()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _kind text; _review boolean;
begin
  if new.ecosystem_id is null then return new; end if;
  select shop_kind, is_review into _kind, _review
    from public.ecosystems where id = new.ecosystem_id;
  if coalesce(_review, false) then
    raise exception 'Review shops cannot cash out — subscribe to activate real operations';
  end if;
  if _kind = 'subscription' and coalesce(new.cashout_path, 'superadmin') = 'superadmin' then
    raise exception 'Subscription Shops cash out with their shop admin, not the platform';
  end if;
  return new;
end $$;

drop trigger if exists guard_subscription_cashout on public.withdrawal_requests;
create trigger guard_subscription_cashout
  before insert on public.withdrawal_requests
  for each row execute function public.guard_subscription_cashout();

-- ============================================================
-- Review shop creation (signed-in members only, one at a time)
-- ============================================================
create or replace function public.create_review_shop(_name text, _description text default null)
returns public.ecosystems
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _uid uuid := auth.uid();
  _base text; _candidate text; _n int := 1;
  _row public.ecosystems; _seed numeric(14,2) := 1000;
  _ends timestamptz := now() + interval '5 days';
  _me text;
begin
  if _uid is null then raise exception 'Sign in to create a shop'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Give your shop a name'; end if;

  if exists (
    select 1 from public.ecosystems e
      join public.ecosystem_memberships m on m.ecosystem_id = e.id
     where e.is_review and e.archived_at is null
       and m.user_id = _uid and m.role = 'admin'
  ) then
    raise exception 'You already have a review shop. Subscribe to activate it, or continue there.';
  end if;

  _base := public.slugify(_name);
  if _base = '' then _base := 'shop'; end if;
  _candidate := _base;
  while exists (select 1 from public.ecosystems where slug = _candidate) loop
    _n := _n + 1;
    _candidate := _base || '-' || _n;
  end loop;

  insert into public.ecosystems
    (name, slug, description, shop_kind, is_review, review_ends_at,
     plan_name, plan_price, grace_period_days, signup_enabled, signup_token,
     subscription_state, current_period_end)
  values
    (trim(_name), _candidate, nullif(trim(_description),''), 'subscription', true, _ends,
     'Review (5 days)', 0, 0, false, encode(extensions.gen_random_bytes(12),'hex'),
     'pending', null)
  returning * into _row;

  insert into public.ecosystem_memberships
    (user_id, ecosystem_id, role, status, membership_state, joined_at)
  values (_uid, _row.id, 'admin', 'active', 'active', now())
  on conflict do nothing;

  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_uid, 'admin', _row.id)
  on conflict do nothing;

  update public.profiles set ecosystem_id = coalesce(ecosystem_id, _row.id) where id = _uid;

  insert into public.shop_subscriptions (ecosystem_id, state, review_ends_at, demo_seed_credits)
  values (_row.id, 'review', _ends, _seed)
  on conflict (ecosystem_id) do nothing;

  -- Simulated personas so the owner can see the whole WiFi voucher flow.
  insert into public.demo_wallets (ecosystem_id, member_key, display_name, role, parent_key, balance)
  values
    (_row.id, 'admin',       'You (Shop admin)', 'admin',       null,        _seed),
    (_row.id, 'reseller',    'Ana (Reseller)',    'reseller',    'admin',     0),
    (_row.id, 'subreseller', 'Ben (Subreseller)', 'subreseller', 'reseller',  0),
    (_row.id, 'customer',    'Maria (Customer)',  'customer',    'subreseller', 0)
  on conflict do nothing;

  insert into public.demo_ledger (ecosystem_id, member_key, direction, amount, balance_after, entry_kind, reason)
  values (_row.id, 'admin', 'credit', _seed, _seed, 'demo_seed',
          'Demo cashflow for your 5-day review');

  insert into public.demo_vouchers (ecosystem_id, name, description, price, stock, display_order)
  values
    (_row.id, '1 Hour WiFi',  'Sample WiFi voucher — 1 hour access',  10, 200, 10),
    (_row.id, '1 Day WiFi',   'Sample WiFi voucher — 24 hour access', 50, 100, 20),
    (_row.id, '7 Day WiFi',   'Sample WiFi voucher — 1 week access', 250,  40, 30);

  select full_name into _me from public.profiles where id = _uid;
  insert into public.subscription_events
    (ecosystem_id, event_type, notes, actor_id, actor_name, verification_status)
  values (_row.id, 'review_created', 'Five-day review shop with simulated coins', _uid,
          coalesce(_me,'Member'), 'not_applicable');

  return _row;
end $$;

revoke all on function public.create_review_shop(text, text) from public, anon;
grant execute on function public.create_review_shop(text, text) to authenticated;

-- ============================================================
-- Deterministic upgrade quote (30-day month, money only)
-- ============================================================
create or replace function public.subscription_quote(_ecosystem_id uuid, _plan_id uuid)
returns table (
  current_plan_id uuid,
  current_plan_name text,
  current_monthly_price numeric,
  current_allocation numeric,
  new_plan_name text,
  new_monthly_price numeric,
  new_allocation numeric,
  days_remaining integer,
  daily_value numeric,
  unused_value numeric,
  amount_due numeric,
  additional_allocation numeric,
  is_first_activation boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _sub public.shop_subscriptions;
  _cur public.subscription_plans;
  _new public.subscription_plans;
  _days int; _daily numeric(12,4); _unused numeric(12,2); _alloc numeric(14,2) := 0;
begin
  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _ecosystem_id)) then
    raise exception 'Only this shop admin can see its subscription quote';
  end if;
  select * into _new from public.subscription_plans where id = _plan_id and active;
  if _new.id is null then raise exception 'Choose an available plan'; end if;

  select * into _sub from public.shop_subscriptions where ecosystem_id = _ecosystem_id;
  if _sub.plan_id is not null then
    select * into _cur from public.subscription_plans where id = _sub.plan_id;
    _alloc := coalesce(_sub.allocation_total, 0);
  end if;

  _days := greatest(0, ceil(extract(epoch from (coalesce(_sub.period_end, now()) - now())) / 86400.0)::int);
  _daily := round(coalesce(_cur.monthly_price, 0) / 30.0, 4);
  _unused := round(_daily * _days, 2);
  if _unused > _new.monthly_price then _unused := _new.monthly_price; end if;

  return query select
    _sub.plan_id,
    _cur.name,
    coalesce(_cur.monthly_price, 0),
    _alloc,
    _new.name,
    _new.monthly_price,
    _new.coin_allocation,
    _days,
    _daily,
    _unused,
    greatest(0, round(_new.monthly_price - _unused, 2)),
    greatest(0, round(_new.coin_allocation - _alloc, 2)),
    (_sub.plan_id is null);
end $$;

revoke all on function public.subscription_quote(uuid, uuid) from public, anon;
grant execute on function public.subscription_quote(uuid, uuid) to authenticated;

-- ============================================================
-- Activate / renew / upgrade after a verified GCash subscription payment
-- ============================================================
create or replace function public.activate_subscription(
  _ecosystem_id uuid,
  _plan_id uuid,
  _amount_php numeric default null,
  _reference text default null,
  _months integer default 1
)
returns public.shop_subscriptions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _sub public.shop_subscriptions;
  _plan public.subscription_plans;
  _prev uuid; _prev_alloc numeric(14,2) := 0; _add numeric(14,2) := 0;
  _admin uuid; _tx text; _q record; _start timestamptz; _end timestamptz;
  _me text; _kind text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can activate a subscription';
  end if;
  if coalesce(_months, 1) < 1 or _months > 24 then raise exception 'Months must be between 1 and 24'; end if;

  select shop_kind into _kind from public.ecosystems where id = _ecosystem_id;
  if _kind is distinct from 'subscription' then
    raise exception 'Only Subscription Shops use the subscription plan system';
  end if;
  select * into _plan from public.subscription_plans where id = _plan_id and active;
  if _plan.id is null then raise exception 'Choose an available plan'; end if;

  insert into public.shop_subscriptions (ecosystem_id, state) values (_ecosystem_id, 'review')
  on conflict (ecosystem_id) do nothing;
  select * into _sub from public.shop_subscriptions where ecosystem_id = _ecosystem_id for update;

  _prev := _sub.plan_id;
  _prev_alloc := coalesce(_sub.allocation_total, 0);
  -- One-time allocation: full on first activation, difference on upgrade,
  -- nothing on renewal. Never negative.
  _add := greatest(0, round(_plan.coin_allocation - _prev_alloc, 2));

  _start := case when _sub.period_end is not null and _sub.period_end > now()
                 then _sub.period_end else now() end;
  _end := _start + (_months || ' months')::interval;

  -- Leaving review: discard the simulated ledger, it never becomes real money.
  if coalesce((select is_review from public.ecosystems where id = _ecosystem_id), false) then
    delete from public.demo_ledger where ecosystem_id = _ecosystem_id;
    delete from public.demo_wallets where ecosystem_id = _ecosystem_id;
    delete from public.demo_vouchers where ecosystem_id = _ecosystem_id;
    update public.ecosystems
       set is_review = false, review_ends_at = null, signup_enabled = true
     where id = _ecosystem_id;
  end if;

  update public.ecosystems
     set subscription_state = 'active',
         operations_frozen = false,
         frozen_reason = null,
         plan_name = _plan.name,
         plan_price = _plan.monthly_price,
         current_period_end = _end,
         payment_reference = coalesce(nullif(trim(_reference),''), payment_reference),
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = _ecosystem_id;

  -- Mint the allocation into the shop admin's wallet, exactly once.
  if _add > 0 then
    select m.user_id into _admin from public.ecosystem_memberships m
     where m.ecosystem_id = _ecosystem_id and m.role = 'admin'
       and m.membership_state = 'active' and m.status = 'active'
     order by m.created_at limit 1;
    if _admin is null then raise exception 'This shop has no active admin to receive the allocation'; end if;
    _tx := public.superadmin_issue_credits(
      _admin, _add,
      'Subscription cashflow allocation — ' || _plan.name,
      'Subscription allocation',
      nullif(trim(_reference),''), null, _ecosystem_id);
  end if;

  update public.shop_subscriptions
     set plan_id = _plan.id,
         state = 'active',
         allocation_total = greatest(_prev_alloc, _plan.coin_allocation),
         period_start = _start,
         period_end = _end,
         review_ends_at = null,
         updated_at = now()
   where ecosystem_id = _ecosystem_id
   returning * into _sub;

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.subscription_events
    (ecosystem_id, event_type, previous_plan_id, new_plan_id, amount_php,
     allocation_granted, additional_allocation, payment_reference, verification_status,
     period_start, period_end, tx_id, actor_id, actor_name, notes)
  values
    (_ecosystem_id,
     case when _prev is null then 'activation'
          when _prev = _plan.id then 'renewal' else 'upgrade' end,
     _prev, _plan.id, _amount_php, _add, _add,
     nullif(trim(_reference),''), 'verified', _start, _end, _tx, auth.uid(),
     coalesce(_me,'Platform owner'),
     'SUBSCRIPTION_PAYMENT — not a cash in, not a coin transfer');

  return _sub;
end $$;

revoke all on function public.activate_subscription(uuid, uuid, numeric, text, integer) from public, anon;
grant execute on function public.activate_subscription(uuid, uuid, numeric, text, integer) to authenticated;

-- ============================================================
-- Daily lifecycle job: 7-day warning, then freeze on expiry
-- ============================================================
create or replace function public.run_subscription_expiry(_dry boolean default false)
returns table (warned integer, expired integer, reviews_frozen integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare _w int := 0; _e int := 0; _r int := 0;
begin
  if auth.uid() is not null and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can run the subscription job';
  end if;

  select count(*) into _w from public.shop_subscriptions s
   where s.state = 'active' and s.period_end is not null
     and s.period_end <= now() + interval '7 days' and s.period_end > now();
  select count(*) into _e from public.shop_subscriptions s
   where s.state in ('active','expiring_soon') and s.period_end is not null and s.period_end <= now();
  select count(*) into _r from public.shop_subscriptions s
   where s.state = 'review' and s.review_ends_at is not null and s.review_ends_at <= now();

  if not _dry then
    update public.shop_subscriptions
       set state = 'expiring_soon', updated_at = now()
     where state = 'active' and period_end is not null
       and period_end <= now() + interval '7 days' and period_end > now();

    update public.shop_subscriptions
       set state = 'expired', updated_at = now()
     where state in ('active','expiring_soon') and period_end is not null and period_end <= now();

    update public.shop_subscriptions
       set state = 'frozen', updated_at = now()
     where state = 'review' and review_ends_at is not null and review_ends_at <= now();

    update public.ecosystems e
       set operations_frozen = true,
           frozen_reason = 'Subscription expired — renew to reactivate this shop',
           frozen_at = now(),
           subscription_state = 'expired'
     where e.shop_kind = 'subscription'
       and not coalesce(e.operations_frozen, false)
       and exists (select 1 from public.shop_subscriptions s
                    where s.ecosystem_id = e.id and s.state in ('expired','frozen'));
  end if;

  return query select _w, _e, _r;
end $$;

revoke all on function public.run_subscription_expiry(boolean) from public, anon;
grant execute on function public.run_subscription_expiry(boolean) to authenticated;

select cron.schedule('subscription-lifecycle', '45 3 * * *',
                     'select public.run_subscription_expiry(false);')
 where not exists (select 1 from cron.job where jobname = 'subscription-lifecycle');

-- ============================================================
-- Public guide questions
-- ============================================================
create or replace function public.submit_guide_question(_question text, _contact text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare _id uuid; _recent int;
begin
  if length(coalesce(trim(_question),'')) < 10 then
    raise exception 'Please write a little more detail in your question';
  end if;
  if length(_question) > 1000 then raise exception 'Please keep the question under 1000 characters'; end if;
  select count(*) into _recent from public.guide_questions
   where created_at > now() - interval '1 hour';
  if _recent > 60 then raise exception 'Too many questions right now — please try again later'; end if;

  insert into public.guide_questions (question, contact)
  values (trim(_question), nullif(trim(_contact),''))
  returning id into _id;
  return _id;
end $$;

grant execute on function public.submit_guide_question(text, text) to anon, authenticated;

create or replace function public.answer_guide_question(_id uuid, _answer text, _publish boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only WaveWallet Support can answer questions';
  end if;
  update public.guide_questions
     set answer = nullif(trim(_answer),''),
         answered_at = now(),
         status = case when _publish then 'published' else 'rejected' end
   where id = _id;
end $$;

revoke all on function public.answer_guide_question(uuid, text, boolean) from public, anon;
grant execute on function public.answer_guide_question(uuid, text, boolean) to authenticated;