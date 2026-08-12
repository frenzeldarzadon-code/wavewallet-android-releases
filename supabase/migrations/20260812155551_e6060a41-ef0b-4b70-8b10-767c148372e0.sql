ALTER TABLE public.subscription_requests
  ADD COLUMN IF NOT EXISTS remainder_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_period_end timestamp with time zone;

-- Whole months, rounded down. Any leftover is reported, never silently absorbed.
CREATE OR REPLACE FUNCTION public.months_for_payment(_amount numeric, _rate numeric)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
begin
  if _rate is null or _rate <= 0 then
    raise exception 'This shop has no monthly rate set yet — contact the platform owner.';
  end if;
  if _amount is null or _amount <= 0 then
    raise exception 'Enter the amount you paid.';
  end if;
  if _amount < _rate then
    raise exception 'Insufficient amount: one month costs %. Pay at least that.', _rate;
  end if;
  return floor(_amount / _rate)::integer;
end;
$$;

CREATE OR REPLACE FUNCTION public.submit_subscription_request(_ecosystem_id uuid, _reference text, _amount_paid numeric DEFAULT NULL::numeric, _proof_path text DEFAULT NULL::text)
RETURNS subscription_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _s public.platform_settings; _req public.subscription_requests; _name text; _eco text;
        _rate numeric; _months integer; _amount numeric; _remainder numeric;
begin
  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _ecosystem_id)) then
    raise exception 'Not allowed to submit a subscription payment for this shop';
  end if;
  if coalesce(btrim(_reference), '') = '' then
    raise exception 'A payment reference is required';
  end if;
  if _proof_path is not null and split_part(_proof_path, '/', 1) <> _ecosystem_id::text then
    raise exception 'Proof of payment must belong to this shop';
  end if;
  if exists (select 1 from public.subscription_requests r
              where r.ecosystem_id = _ecosystem_id and r.status = 'pending') then
    raise exception 'A payment request is already awaiting approval';
  end if;

  perform public.expire_stale_subscriptions();

  select * into _s from public.platform_settings where id = 1;
  select coalesce(full_name, 'Shop operator') into _name from public.profiles where id = auth.uid();
  select name into _eco from public.ecosystems where id = _ecosystem_id;

  -- Duration comes from the amount paid, per shop: months = floor(amount / monthly rate).
  _rate := public.ecosystem_monthly_rate(_ecosystem_id);
  _amount := coalesce(_amount_paid, _rate);
  _months := public.months_for_payment(_amount, _rate);
  _remainder := _amount - (_rate * _months);

  insert into public.subscription_requests (
    ecosystem_id, requested_by, requested_by_name, plan_name, plan_price, billing_period,
    amount_due, amount_paid, currency, payment_reference, proof_path,
    months_purchased, monthly_rate, remainder_amount
  ) values (
    _ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'), _s.plan_name, _rate, 'monthly',
    _rate * _months, _amount, _s.currency, btrim(_reference), _proof_path,
    _months, _rate, _remainder
  ) returning * into _req;

  update public.ecosystems set
    subscription_state = 'awaiting_approval',
    payment_reference = btrim(_reference),
    submitted_at = now()
  where id = _ecosystem_id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'), 'Submitted subscription payment', coalesce(_eco,'Shop'),
          jsonb_build_object('reference', btrim(_reference), 'amount_paid', _amount,
                             'amount_applied', _req.amount_due, 'remainder', _remainder,
                             'billing_period', 'monthly', 'months', _months, 'monthly_rate', _rate,
                             'request_id', _req.id));

  return _req;
end; $function$;

CREATE OR REPLACE FUNCTION public.review_subscription_request(_request_id uuid, _decision text, _reason text DEFAULT NULL::text)
RETURNS subscription_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _req public.subscription_requests; _actor text; _start timestamptz; _end timestamptz;
        _eco public.ecosystems; _months integer;
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
    -- Extend from the current expiry when time is still prepaid, otherwise start now.
    _start := greatest(now(), coalesce(_eco.current_period_end, now()));
    _months := coalesce(_req.months_purchased,
                        case _req.billing_period when 'yearly' then 12
                                                 when 'quarterly' then 3
                                                 else 1 end);
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

-- Courtesy / dispute expiration adjustments are separate auditable events.
CREATE TABLE IF NOT EXISTS public.subscription_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_name text NOT NULL,
  previous_period_end timestamp with time zone,
  new_period_end timestamp with time zone NOT NULL,
  direction text NOT NULL CHECK (direction IN ('extended','shortened','unchanged')),
  reason text NOT NULL,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_adjustments TO authenticated;
GRANT ALL ON public.subscription_adjustments TO service_role;

ALTER TABLE public.subscription_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform owners read all expiration adjustments"
  ON public.subscription_adjustments FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Shop admins read their own expiration adjustments"
  ON public.subscription_adjustments FOR SELECT TO authenticated
  USING (public.is_ecosystem_admin(auth.uid(), ecosystem_id));

CREATE OR REPLACE FUNCTION public.adjust_ecosystem_expiration(
  _ecosystem_id uuid,
  _new_period_end timestamp with time zone,
  _reason text,
  _note text DEFAULT NULL,
  _confirm_shorten boolean DEFAULT false
)
RETURNS public.subscription_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare _eco public.ecosystems; _actor text; _prev timestamptz; _dir text; _row public.subscription_adjustments;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can adjust an expiration date';
  end if;
  if coalesce(btrim(_reason), '') = '' then
    raise exception 'An adjustment reason is required';
  end if;
  if _new_period_end is null then
    raise exception 'A new expiration date is required';
  end if;

  select * into _eco from public.ecosystems where id = _ecosystem_id for update;
  if _eco.id is null then raise exception 'Shop not found'; end if;

  _prev := _eco.current_period_end;
  _dir := case
            when _prev is null then 'extended'
            when _new_period_end > _prev then 'extended'
            when _new_period_end < _prev then 'shortened'
            else 'unchanged'
          end;

  -- Shortening can cut a paying shop off early, so it needs explicit confirmation.
  if _dir = 'shortened' and not coalesce(_confirm_shorten, false) then
    raise exception 'Shortening an expiration date must be explicitly confirmed';
  end if;

  select coalesce(full_name, 'Platform owner') into _actor from public.profiles where id = auth.uid();

  insert into public.subscription_adjustments (
    ecosystem_id, actor_id, actor_name, previous_period_end, new_period_end, direction, reason, note
  ) values (
    _ecosystem_id, auth.uid(), coalesce(_actor,'Platform owner'), _prev, _new_period_end, _dir,
    btrim(_reason), nullif(btrim(coalesce(_note,'')), '')
  ) returning * into _row;

  -- Payment records are untouched; only the live expiry moves.
  update public.ecosystems set
    current_period_end = _new_period_end,
    subscription_state = case
      when _new_period_end > now() and subscription_state in ('expired','pending') then 'active'
      else subscription_state end
  where id = _ecosystem_id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Platform owner'),
          'Adjusted subscription expiration', _eco.name,
          jsonb_build_object('adjustment_id', _row.id, 'direction', _dir,
                             'previous_period_end', _prev, 'new_period_end', _new_period_end,
                             'reason', btrim(_reason), 'note', _row.note,
                             'confirmed_shorten', coalesce(_confirm_shorten,false)));

  return _row;
end;
$$;

REVOKE ALL ON FUNCTION public.adjust_ecosystem_expiration(uuid, timestamptz, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_ecosystem_expiration(uuid, timestamptz, text, text, boolean) TO authenticated, service_role;