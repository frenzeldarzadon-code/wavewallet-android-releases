-- 1. Normalise a persisted "Demo:" name prefix on a legitimate live transition.
create or replace function public.live_shop_name(_name text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(btrim(regexp_replace(coalesce(_name,''), '^\s*demo\s*[:\-–—]\s*', '', 'i')), '')
$$;

-- 2. apply_subscription_plan: same body, plus name normalisation when leaving review.
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
  _end := _start + (_months || ' months')::interval;

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

-- 3. Manual approval now performs the SAME authoritative activation for
--    Subscription Shops. Legacy shops keep the original path untouched.
CREATE OR REPLACE FUNCTION public.review_subscription_request(_request_id uuid, _decision text, _reason text DEFAULT NULL::text)
 RETURNS subscription_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _req public.subscription_requests; _actor text; _start timestamptz; _end timestamptz;
        _eco public.ecosystems; _months integer; _sub public.shop_subscriptions;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can review subscription payments';
  end if;
  if _decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into _req from public.subscription_requests where id = _request_id for update;
  if _req.id is null then raise exception 'Request not found'; end if;
  if _req.status <> 'pending' then raise exception 'This request has already been reviewed'; end if;

  select * into _eco from public.ecosystems where id = _req.ecosystem_id;
  select coalesce(full_name, 'Platform owner') into _actor from public.profiles where id = auth.uid();

  if _decision = 'approved' then
    _months := coalesce(_req.months_purchased,
                        case _req.billing_period when 'yearly' then 12
                                                 when 'quarterly' then 3
                                                 else 1 end);

    if _eco.shop_kind = 'subscription' and _req.plan_id is not null then
      -- One authoritative activation path: clears Demo state, normalises the
      -- name, opens sign-ups and grants the plan allocation exactly once.
      _sub := public.apply_subscription_plan(
        _req.ecosystem_id, _req.plan_id, _months, _req.amount_paid, _req.payment_reference,
        'MANUAL_APPROVAL — platform owner verified the GCash subscription payment');

      update public.subscription_requests set
        status = 'approved', reviewed_by = auth.uid(),
        reviewed_by_name = coalesce(_actor,'Platform owner'),
        reviewed_at = now(), period_start = _sub.period_start, period_end = _sub.period_end,
        previous_period_end = _eco.current_period_end, decision_reason = _reason,
        auto_state = 'activated',
        auto_reason = 'Activated by the platform owner — the shop is live on the ' || coalesce(_req.plan_name,'chosen') || ' plan'
      where id = _request_id returning * into _req;
    else
      -- Extend from the current expiry when time is still prepaid, otherwise start now.
      _start := greatest(now(), coalesce(_eco.current_period_end, now()));
      _end := _start + make_interval(months => _months);

      update public.subscription_requests set
        status = 'approved', reviewed_by = auth.uid(), reviewed_by_name = coalesce(_actor,'Platform owner'),
        reviewed_at = now(), period_start = _start, period_end = _end,
        previous_period_end = _eco.current_period_end, decision_reason = _reason
      where id = _request_id returning * into _req;

      update public.ecosystems set
        subscription_state = 'active',
        plan_name = _req.plan_name,
        plan_price = coalesce(_req.monthly_rate, _req.plan_price),
        current_period_end = _end,
        reviewed_at = now(),
        reviewed_by = auth.uid()
      where id = _req.ecosystem_id;
    end if;
  else
    update public.subscription_requests set
      status = 'rejected', reviewed_by = auth.uid(), reviewed_by_name = coalesce(_actor,'Platform owner'),
      reviewed_at = now(), decision_reason = _reason
    where id = _request_id returning * into _req;

    update public.ecosystems set
      subscription_state = 'rejected',
      reviewed_at = now(),
      reviewed_by = auth.uid()
    where id = _req.ecosystem_id;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_req.ecosystem_id, auth.uid(), coalesce(_actor,'Platform owner'),
          case when _decision = 'approved' then 'Approved subscription payment' else 'Rejected subscription payment' end,
          coalesce(_eco.name,'Shop'),
          jsonb_build_object('request_id', _req.id, 'reference', _req.payment_reference,
                             'amount_paid', _req.amount_paid, 'amount_applied', _req.amount_due,
                             'remainder', _req.remainder_amount,
                             'months', _months, 'monthly_rate', _req.monthly_rate,
                             'previous_period_end', _eco.current_period_end,
                             'reason', _reason, 'period_end', _req.period_end));

  return _req;
end; $function$;

-- 4. Repair shops already approved but left in Demo state by the old path.
do $$
declare _r record;
begin
  for _r in
    select e.id as eco, r.id as req, r.plan_id, coalesce(r.months_purchased,1) as months,
           r.amount_paid, r.payment_reference, r.plan_name
      from public.ecosystems e
      join public.subscription_requests r on r.ecosystem_id = e.id
     where e.shop_kind = 'subscription' and e.is_review
       and r.status = 'approved' and r.plan_id is not null
  loop
    perform public.apply_subscription_plan(_r.eco, _r.plan_id, _r.months,
      _r.amount_paid, _r.payment_reference,
      'REPAIR — approved payment had not completed the Demo to Live transition');
    update public.subscription_requests
       set auto_state = 'activated',
           auto_reason = 'Verified payment — the shop is live on the ' || coalesce(_r.plan_name,'chosen') || ' plan'
     where id = _r.req;
  end loop;
end $$;