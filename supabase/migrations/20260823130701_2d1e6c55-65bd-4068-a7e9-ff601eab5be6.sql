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
         period_start = now(),
         super_review_state = 'pending',
         entitlement_hold = false
   where id = _request_id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_req.ecosystem_id, _req.requested_by, 'WaveWallet GCash listener',
          'Activated shop from verified GCash payment', coalesce(_eco.name,'Shop'),
          jsonb_build_object('request_id', _req.id, 'plan', _req.plan_name,
                             'reference', _req.payment_reference,
                             'listener_event_id', _req.listener_event_id,
                             'months', _req.months_purchased,
                             'super_review_state', 'pending'));

  if _req.requested_by is not null then
    perform public.notify_member(
      _req.requested_by, _req.ecosystem_id, 'subscription',
      'Congratulations! Your shop is now LIVE',
      coalesce(_eco.name,'Your shop') || ' is live on the ' || coalesce(_req.plan_name,'selected') || ' plan.',
      '/admin');
  end if;

  for _su in select ur.user_id from public.user_roles ur where ur.role = 'super_admin' loop
    perform public.notify_member(
      _su, _req.ecosystem_id, 'subscription',
      'New shop went live',
      coalesce(_eco.name,'A shop') || ' activated the ' || coalesce(_req.plan_name,'selected')
        || ' plan (' || to_char(coalesce(_req.monthly_rate, _req.plan_price, 0),'FM999999990.00')
        || '/month × ' || coalesce(_req.months_purchased,1)
        || '). No approval needed for activation — confirm the payment in Auto-approved payments.',
      '/super/auto-payments');
  end loop;

  return 'activated';
end $function$;