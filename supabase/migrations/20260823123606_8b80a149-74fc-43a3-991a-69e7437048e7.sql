-- Automatic activation stays as-is; add informational notifications only.
CREATE OR REPLACE FUNCTION public.activate_go_live_request(_request_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _req public.subscription_requests; _eco public.ecosystems; _su uuid;
begin
  select * into _req from public.subscription_requests where id = _request_id for update;
  if _req.id is null then return 'not_found'; end if;
  if _req.status <> 'pending' then return 'already_activated'; end if;
  if _req.plan_id is null then return 'no_plan'; end if;
  select * into _eco from public.ecosystems where id = _req.ecosystem_id;

  perform public.apply_subscription_plan(
    _req.ecosystem_id, _req.plan_id, coalesce(_req.months_purchased, 1),
    _req.amount_paid, _req.payment_reference,
    case when _req.purpose = 'go_live' then 'GO_LIVE — verified GCash subscription payment'
         else 'PLAN_CHANGE — verified GCash subscription payment' end);

  update public.subscription_requests
     set status = 'approved', reviewed_at = now(),
         reviewed_by_name = 'WaveWallet GCash listener',
         auto_state = 'activated',
         auto_reason = 'Verified payment — the shop is live on the ' || _req.plan_name || ' plan',
         period_start = now()
   where id = _request_id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_req.ecosystem_id, _req.requested_by, 'WaveWallet GCash listener',
          'Activated shop from verified GCash payment', coalesce(_eco.name,'Shop'),
          jsonb_build_object('request_id', _req.id, 'plan', _req.plan_name,
                             'reference', _req.payment_reference,
                             'listener_event_id', _req.listener_event_id,
                             'months', _req.months_purchased));

  -- Operator: congratulations, no verification mechanics disclosed.
  if _req.requested_by is not null then
    perform public.notify_member(
      _req.requested_by, _req.ecosystem_id, 'subscription',
      'Congratulations! Your shop is now LIVE',
      coalesce(_eco.name,'Your shop') || ' is live on the ' || coalesce(_req.plan_name,'selected') || ' plan.',
      '/admin');
  end if;

  -- Platform owners: review-only notice. This never gates activation.
  for _su in select ur.user_id from public.user_roles ur where ur.role = 'super_admin' loop
    perform public.notify_member(
      _su, _req.ecosystem_id, 'subscription',
      'New shop went live',
      coalesce(_eco.name,'A shop') || ' activated the ' || coalesce(_req.plan_name,'selected')
        || ' plan (' || to_char(coalesce(_req.monthly_rate, _req.plan_price, 0),'FM999999990.00')
        || '/month × ' || coalesce(_req.months_purchased,1) || '). For review only — no approval needed.',
      '/super/subscriptions');
  end loop;

  return 'activated';
end $function$;

CREATE OR REPLACE FUNCTION public.activate_free_subscription(_ecosystem_id uuid, _plan_id uuid, _months integer DEFAULT 1)
 RETURNS shop_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _plan public.subscription_plans; _eco public.ecosystems;
        _sub public.shop_subscriptions; _me text; _su uuid;
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

  for _su in select ur.user_id from public.user_roles ur where ur.role = 'super_admin' loop
    perform public.notify_member(
      _su, _ecosystem_id, 'subscription',
      'New shop went live',
      coalesce(_eco.name,'A shop') || ' activated the ' || _plan.name
        || ' plan (free). For review only — no approval needed.',
      '/super/subscriptions');
  end loop;

  return _sub;
end $function$;