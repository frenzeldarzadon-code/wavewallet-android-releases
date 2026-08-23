-- Fixed 30-day subscription month standard.
CREATE OR REPLACE FUNCTION public.apply_subscription_plan(_ecosystem_id uuid, _plan_id uuid, _months integer DEFAULT 1, _amount_php numeric DEFAULT NULL::numeric, _reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS shop_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _sub public.shop_subscriptions; _plan public.subscription_plans;
  _prev uuid; _prev_alloc numeric(14,2) := 0; _add numeric(14,2) := 0;
  _admin uuid; _tx text; _start timestamptz; _end timestamptz; _me text; _kind text;
begin
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
  _add := greatest(0, round(_plan.coin_allocation - _prev_alloc, 2));

  _start := case when _sub.period_end is not null and _sub.period_end > now()
                 then _sub.period_end else now() end;
  -- FIXED 30-DAY SUBSCRIPTION MONTH: 1 month = 30 days, always.
  _end := _start + ((coalesce(_months,1) * 30) || ' days')::interval;

  if coalesce((select is_review from public.ecosystems where id = _ecosystem_id), false) then
    delete from public.demo_ledger where ecosystem_id = _ecosystem_id;
    delete from public.demo_wallets where ecosystem_id = _ecosystem_id;
    delete from public.demo_vouchers where ecosystem_id = _ecosystem_id;
    update public.ecosystems
       set is_review = false, review_ends_at = null, signup_enabled = true,
           name = coalesce(public.live_shop_name(name), name)
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

  if _add > 0 then
    select m.user_id into _admin from public.ecosystem_memberships m
     where m.ecosystem_id = _ecosystem_id and m.role = 'admin'
       and m.membership_state = 'active' and m.status = 'active'
     order by m.created_at limit 1;
    if _admin is null then raise exception 'This shop has no active admin to receive the allocation'; end if;
    perform set_config('wavewallet.subscription_allocation', 'on', true);
    _tx := public.superadmin_issue_credits(
      _admin, _add,
      'Subscription cashflow allocation — ' || _plan.name,
      'Subscription allocation',
      nullif(trim(_reference),''), null, _ecosystem_id);
    perform set_config('wavewallet.subscription_allocation', 'off', true);
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
     coalesce(_me,'WaveWallet platform'),
     coalesce(_notes, 'SUBSCRIPTION_PAYMENT — not a cash in, not a coin transfer'));

  return _sub;
end $function$;

CREATE OR REPLACE FUNCTION public.subscription_quote(_ecosystem_id uuid, _plan_id uuid)
 RETURNS TABLE(current_plan_id uuid, current_plan_name text, current_monthly_price numeric, current_allocation numeric, new_plan_name text, new_monthly_price numeric, new_allocation numeric, days_remaining integer, daily_value numeric, unused_value numeric, amount_due numeric, additional_allocation numeric, is_first_activation boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _sub public.shop_subscriptions;
  _cur public.subscription_plans;
  _new public.subscription_plans;
  _days int; _daily numeric(12,4); _unused numeric(12,2); _alloc numeric(14,2) := 0;
  _period_days int; _paid_months int; _max_days int;
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

  -- FIXED 30-DAY MONTH: eligible remaining days can never exceed the fixed
  -- 30-day length of the periods actually paid for. Legacy calendar periods
  -- (28/31 days) are normalised so a fully unused month is worth exactly one
  -- monthly price — never 31 × (price / 30).
  if _sub.period_start is not null and _sub.period_end is not null then
    _period_days := greatest(1, ceil(extract(epoch from (_sub.period_end - _sub.period_start)) / 86400.0)::int);
    _paid_months := greatest(1, round(_period_days / 30.0)::int);
  else
    _paid_months := 1;
  end if;
  _max_days := _paid_months * 30;
  if _days > _max_days then _days := _max_days; end if;

  _daily := round(coalesce(_cur.monthly_price, 0) / 30.0, 4);
  _unused := round(_daily * _days, 2);
  -- Never refund more than the value actually paid for the running periods.
  if _unused > round(coalesce(_cur.monthly_price, 0) * _paid_months, 2) then
    _unused := round(coalesce(_cur.monthly_price, 0) * _paid_months, 2);
  end if;
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
end $function$;