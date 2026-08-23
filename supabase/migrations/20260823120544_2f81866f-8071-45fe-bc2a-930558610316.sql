create or replace function public.subscription_is_free(_ecosystem_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ecosystems e
     where e.id = _ecosystem_id
       and e.archived_at is null
       and not coalesce(e.is_review, false)
       and coalesce(e.plan_price, 0) <= 0
  );
$$;

grant execute on function public.subscription_is_free(uuid) to authenticated, anon, service_role;

create or replace function public.subscription_ok(_ecosystem_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ecosystems e
    where e.id = _ecosystem_id
      and e.archived_at is null
      and e.subscription_state = 'active'
      and (e.current_period_end is null
           or (not coalesce(e.is_review, false) and coalesce(e.plan_price, 0) <= 0)
           or e.current_period_end + make_interval(days => e.grace_period_days) > now())
  );
$$;

create or replace function public.run_subscription_expiry(_dry boolean default false)
returns table(warned integer, expired integer, reviews_frozen integer)
language plpgsql
security definer
set search_path = public
as $function$
declare _w int := 0; _e int := 0; _r int := 0;
begin
  if auth.uid() is not null and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can run the subscription job';
  end if;

  select count(*) into _w from public.shop_subscriptions s
   where s.state = 'active' and s.period_end is not null
     and s.period_end <= now() + interval '7 days' and s.period_end > now()
     and not public.subscription_is_free(s.ecosystem_id);
  select count(*) into _e from public.shop_subscriptions s
   where s.state in ('active','expiring_soon') and s.period_end is not null and s.period_end <= now()
     and not public.subscription_is_free(s.ecosystem_id);
  select count(*) into _r from public.shop_subscriptions s
   where s.state = 'review' and s.review_ends_at is not null and s.review_ends_at <= now();

  if not _dry then
    update public.shop_subscriptions
       set state = 'expiring_soon', updated_at = now()
     where state = 'active' and period_end is not null
       and period_end <= now() + interval '7 days' and period_end > now()
       and not public.subscription_is_free(ecosystem_id);

    update public.shop_subscriptions
       set state = 'expired', updated_at = now()
     where state in ('active','expiring_soon') and period_end is not null and period_end <= now()
       and not public.subscription_is_free(ecosystem_id);

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
       and not public.subscription_is_free(e.id)
       and exists (select 1 from public.shop_subscriptions s
                    where s.ecosystem_id = e.id and s.state in ('expired','frozen'));
  end if;

  return query select _w, _e, _r;
end $function$;

create or replace function public.submit_go_live_payment(_ecosystem_id uuid, _plan_id uuid, _payer_number text, _reference text, _months integer DEFAULT 1, _amount_paid numeric DEFAULT NULL::numeric, _proof_path text DEFAULT NULL::text, _payment_method_id uuid DEFAULT NULL::uuid)
returns public.subscription_requests
language plpgsql
security definer
set search_path = public
as $function$
declare _req public.subscription_requests; _plan public.subscription_plans; _eco public.ecosystems;
        _name text; _num_key text; _ref_key text; _dup text; _amount numeric(14,2); _purpose text;
        _pm public.payment_methods;
begin
  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _ecosystem_id)) then
    raise exception 'Only this shop admin can pay for its subscription';
  end if;
  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco.id is null then raise exception 'Shop not found'; end if;
  if _eco.shop_kind is distinct from 'subscription' then
    raise exception 'Legacy shops keep their existing subscription workflow';
  end if;
  if coalesce(_months, 1) < 1 or _months > 24 then raise exception 'Months must be between 1 and 24'; end if;

  select * into _plan from public.subscription_plans where id = _plan_id and active;
  if _plan.id is null then raise exception 'Choose an available plan'; end if;

  if round(coalesce(_plan.monthly_price, 0) * coalesce(_months, 1), 2) <= 0
     or public.subscription_is_free(_ecosystem_id) then
    raise exception 'No payment is required for this shop — its subscription price is zero';
  end if;

  if _payment_method_id is not null then
    select * into _pm from public.payment_methods
     where id = _payment_method_id and active and ecosystem_id is null;
    if _pm.id is null then raise exception 'Choose one of the published WaveWallet payment options'; end if;
  end if;

  _num_key := public.normalize_sender_identifier(_payer_number);
  if _num_key is null or length(_num_key) < 4 then
    raise exception 'Enter the account number or mobile number you are paying from';
  end if;
  _ref_key := public.normalize_payment_reference(_reference);
  if _ref_key is null then raise exception 'A payment reference number is required'; end if;

  if _proof_path is null or btrim(_proof_path) = '' then
    raise exception 'A payment screenshot is required';
  end if;
  if split_part(_proof_path, '/', 1) <> auth.uid()::text then
    raise exception 'Proof of payment must belong to you';
  end if;

  _dup := public.go_live_reference_duplicate(_ref_key, null);
  if _dup is not null then
    raise exception 'That reference was already used for another payment. Each reference can only be used once.';
  end if;

  if exists (select 1 from public.subscription_requests r
              where r.ecosystem_id = _ecosystem_id and r.status = 'pending') then
    raise exception 'A payment for this shop is already awaiting verification';
  end if;

  _amount := coalesce(_amount_paid, round(_plan.monthly_price * _months, 2));
  _purpose := case when coalesce(_eco.is_review, false) then 'go_live' else 'plan_change' end;
  select coalesce(full_name, 'Shop operator') into _name from public.profiles where id = auth.uid();

  insert into public.subscription_requests (
    ecosystem_id, requested_by, requested_by_name, plan_name, plan_price, billing_period,
    amount_due, amount_paid, currency, payment_reference, proof_path,
    months_purchased, monthly_rate, remainder_amount,
    purpose, plan_id, payer_number, payer_number_key, payer_reference_key, auto_state, receipt_check,
    payment_method_id, payment_method_name
  ) values (
    _ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'), _plan.name, _plan.monthly_price, 'monthly',
    round(_plan.monthly_price * _months, 2), _amount,
    coalesce((select currency from public.platform_settings where id = 1), 'PHP'),
    btrim(_reference), btrim(_proof_path), _months, _plan.monthly_price,
    greatest(0, _amount - round(_plan.monthly_price * _months, 2)),
    _purpose, _plan.id, btrim(_payer_number), _num_key, _ref_key, 'pending', 'pending',
    _pm.id, _pm.name
  ) returning * into _req;

  update public.ecosystems
     set subscription_state = 'awaiting_approval',
         payment_reference = btrim(_reference),
         submitted_at = now()
   where id = _ecosystem_id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'),
          case when _purpose = 'go_live' then 'Submitted Go Live payment' else 'Submitted plan change payment' end,
          coalesce(_eco.name,'Shop'),
          jsonb_build_object('request_id', _req.id, 'plan', _plan.name, 'months', _months,
                             'amount', _amount, 'reference', btrim(_reference),
                             'payer_number_key', _num_key, 'proof', true,
                             'payment_method', _pm.name));

  perform public.reconcile_go_live_request(_req.id);
  select * into _req from public.subscription_requests where id = _req.id;
  return _req;
end $function$;

create or replace function public.activate_free_subscription(_ecosystem_id uuid, _plan_id uuid, _months integer default 1)
returns public.shop_subscriptions
language plpgsql
security definer
set search_path = public
as $function$
declare _plan public.subscription_plans; _eco public.ecosystems;
        _sub public.shop_subscriptions; _me text;
begin
  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _ecosystem_id)) then
    raise exception 'Only this shop admin can activate its subscription';
  end if;
  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco.id is null then raise exception 'Shop not found'; end if;

  select * into _plan from public.subscription_plans where id = _plan_id and active;
  if _plan.id is null then raise exception 'Choose an available plan'; end if;

  if round(coalesce(_plan.monthly_price, 0) * coalesce(_months, 1), 2) > 0
     and not public.subscription_is_free(_ecosystem_id) then
    raise exception 'This plan costs money — use the normal payment flow';
  end if;

  _sub := public.apply_subscription_plan(
    _ecosystem_id, _plan_id, _months, 0, null,
    'FREE_SUBSCRIPTION — price is zero, no payment required');

  select coalesce(full_name, 'Shop operator') into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_me,'Shop operator'),
          'Activated a zero-priced subscription', coalesce(_eco.name,'Shop'),
          jsonb_build_object('plan', _plan.name, 'months', _months, 'amount', 0, 'free', true));

  return _sub;
end $function$;

grant execute on function public.activate_free_subscription(uuid, uuid, integer) to authenticated, service_role;