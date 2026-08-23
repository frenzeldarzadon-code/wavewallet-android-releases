-- Super Admin review of automatically approved subscription payments.
ALTER TABLE public.subscription_requests
  ADD COLUMN IF NOT EXISTS super_review_state text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS super_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS super_reviewed_by_name text,
  ADD COLUMN IF NOT EXISTS super_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS super_review_reason text,
  ADD COLUMN IF NOT EXISTS entitlement_hold boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.subscription_requests
    ADD CONSTRAINT subscription_requests_super_review_state_check
    CHECK (super_review_state IN ('not_required','pending','verified','invalid'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS subscription_requests_super_review_idx
  ON public.subscription_requests (super_review_state, reviewed_at DESC);

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
        || '/month × ' || coalesce(_req.months_purchased,1) || '). Confirm the payment in Auto-approved payments.',
      '/super/auto-payments');
  end loop;

  return 'activated';
end $function$;

CREATE OR REPLACE FUNCTION public.review_auto_approved_payment(
  _request_id uuid, _decision text, _reason text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _req public.subscription_requests; _eco public.ecosystems;
        _actor uuid := auth.uid(); _name text; _reason_txt text := nullif(btrim(coalesce(_reason,'')),'');
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can review automatic payments';
  end if;
  if _decision not in ('verified','invalid') then
    raise exception 'Decision must be verified or invalid';
  end if;
  if _decision = 'invalid' and _reason_txt is null then
    raise exception 'A reason is required when marking a payment invalid';
  end if;

  select * into _req from public.subscription_requests where id = _request_id for update;
  if _req.id is null then raise exception 'Payment not found'; end if;
  if coalesce(_req.super_review_state,'not_required') = 'not_required' then
    raise exception 'This payment was not approved automatically';
  end if;
  if _req.super_review_state = _decision then return 'unchanged'; end if;

  select * into _eco from public.ecosystems where id = _req.ecosystem_id;
  select coalesce(p.full_name, 'Platform owner') into _name
    from public.profiles p where p.id = _actor;

  update public.subscription_requests
     set super_review_state = _decision,
         super_reviewed_by = _actor,
         super_reviewed_by_name = coalesce(_name,'Platform owner'),
         super_reviewed_at = now(),
         super_review_reason = _reason_txt,
         entitlement_hold = (_decision = 'invalid')
   where id = _request_id;

  if _decision = 'invalid' then
    update public.ecosystems
       set operations_frozen = true,
           frozen_reason = 'Payment under review — marked invalid: ' || _reason_txt
     where id = _req.ecosystem_id;

    if _req.requested_by is not null then
      perform public.notify_member(
        _req.requested_by, _req.ecosystem_id, 'subscription',
        'Action needed: your payment was marked invalid',
        'The payment ' || coalesce(_req.payment_reference,'') || ' for the '
          || coalesce(_req.plan_name,'selected') || ' plan was marked invalid by the platform owner. '
          || 'Reason: ' || _reason_txt || '. Your subscription benefits are on hold until this is resolved.',
        '/admin/go-live');
    end if;
  else
    update public.ecosystems
       set operations_frozen = false, frozen_reason = null
     where id = _req.ecosystem_id
       and coalesce(frozen_reason,'') like 'Payment under review%';

    if _req.requested_by is not null then
      perform public.notify_member(
        _req.requested_by, _req.ecosystem_id, 'subscription',
        'Your payment has been verified',
        'The payment ' || coalesce(_req.payment_reference,'') || ' for the '
          || coalesce(_req.plan_name,'selected') || ' plan is verified. '
          || 'Your subscription is fully active.',
        '/admin');
    end if;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_req.ecosystem_id, _actor, coalesce(_name,'Platform owner'),
          case when _decision = 'invalid'
               then 'Marked automatic payment invalid'
               else 'Verified automatic payment' end,
          coalesce(_eco.name,'Shop'),
          jsonb_build_object('request_id', _req.id, 'plan', _req.plan_name,
                             'reference', _req.payment_reference,
                             'months', _req.months_purchased,
                             'amount_paid', _req.amount_paid,
                             'previous_state', _req.super_review_state,
                             'new_state', _decision,
                             'reason', _reason_txt,
                             'entitlement_hold', (_decision = 'invalid')));

  return _decision;
end $function$;

REVOKE ALL ON FUNCTION public.review_auto_approved_payment(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.review_auto_approved_payment(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_approved_payments(_state text DEFAULT NULL)
 RETURNS TABLE(
   id uuid, ecosystem_id uuid, shop_name text, operator_name text,
   plan_name text, monthly_rate numeric, months_purchased integer,
   amount_due numeric, amount_paid numeric,
   payment_reference text, payer_number text, payment_method_name text,
   purpose text, submitted_at timestamptz, auto_approved_at timestamptz,
   auto_reason text, review_state text, reviewed_by_name text,
   reviewed_at timestamptz, review_reason text, entitlement_hold boolean,
   operations_frozen boolean, frozen_reason text,
   listener_provider text, listener_sender text, listener_reference text,
   listener_amount numeric, listener_posted_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.id, r.ecosystem_id, e.name, r.requested_by_name,
         r.plan_name, coalesce(r.monthly_rate, r.plan_price), coalesce(r.months_purchased, 1),
         r.amount_due, r.amount_paid,
         r.payment_reference, r.payer_number, r.payment_method_name,
         r.purpose, r.created_at, r.reviewed_at,
         r.auto_reason, r.super_review_state, r.super_reviewed_by_name,
         r.super_reviewed_at, r.super_review_reason, r.entitlement_hold,
         coalesce(e.operations_frozen, false), e.frozen_reason,
         coalesce(le.app_label, le.package_name), le.sender_number, le.gcash_reference,
         le.amount_php, le.posted_at
    from public.subscription_requests r
    join public.ecosystems e on e.id = r.ecosystem_id
    left join public.listener_events le on le.id = r.listener_event_id
   where public.is_super_admin(auth.uid())
     and coalesce(r.super_review_state,'not_required') <> 'not_required'
     and (_state is null or r.super_review_state = _state)
   order by (r.super_review_state = 'pending') desc, r.reviewed_at desc nulls last;
$function$;

REVOKE ALL ON FUNCTION public.auto_approved_payments(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.auto_approved_payments(text) TO authenticated;