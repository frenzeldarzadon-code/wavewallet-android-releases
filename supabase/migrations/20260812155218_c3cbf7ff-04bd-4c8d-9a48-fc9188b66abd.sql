ALTER TABLE public.subscription_requests
  ADD COLUMN IF NOT EXISTS months_purchased integer,
  ADD COLUMN IF NOT EXISTS monthly_rate numeric;

-- Each shop bills at its own monthly rate; the platform default is the fallback.
CREATE OR REPLACE FUNCTION public.ecosystem_monthly_rate(_ecosystem_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select coalesce(
    nullif((select e.plan_price from public.ecosystems e where e.id = _ecosystem_id), 0),
    (select s.plan_price from public.platform_settings s where s.id = 1),
    0
  );
$$;

-- Whole months only. A non-multiple amount is a hard error, never a partial month.
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
  if mod(_amount, _rate) <> 0 then
    raise exception 'Non-standard amount: % is not a whole number of months at % per month. Pay an exact multiple (%, %, % …).',
      _amount, _rate, _rate, _rate * 2, _rate * 3;
  end if;
  return (_amount / _rate)::integer;
end;
$$;

REVOKE ALL ON FUNCTION public.ecosystem_monthly_rate(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ecosystem_monthly_rate(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.months_for_payment(numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.months_for_payment(numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_subscription_request(_ecosystem_id uuid, _reference text, _amount_paid numeric DEFAULT NULL::numeric, _proof_path text DEFAULT NULL::text)
RETURNS subscription_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _s public.platform_settings; _req public.subscription_requests; _name text; _eco text;
        _rate numeric; _months integer; _amount numeric;
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

  -- Duration comes from the amount paid, per shop: months = amount / monthly rate.
  _rate := public.ecosystem_monthly_rate(_ecosystem_id);
  _amount := coalesce(_amount_paid, _rate);
  _months := public.months_for_payment(_amount, _rate);

  insert into public.subscription_requests (
    ecosystem_id, requested_by, requested_by_name, plan_name, plan_price, billing_period,
    amount_due, amount_paid, currency, payment_reference, proof_path,
    months_purchased, monthly_rate
  ) values (
    _ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'), _s.plan_name, _rate, 'monthly',
    _rate * _months, _amount, _s.currency, btrim(_reference), _proof_path,
    _months, _rate
  ) returning * into _req;

  update public.ecosystems set
    subscription_state = 'awaiting_approval',
    payment_reference = btrim(_reference),
    submitted_at = now()
  where id = _ecosystem_id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'), 'Submitted subscription payment', coalesce(_eco,'Shop'),
          jsonb_build_object('reference', btrim(_reference), 'amount_due', _req.amount_due,
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
    -- Extend from the current valid-until when still active, otherwise start now.
    _start := greatest(now(), coalesce(_eco.current_period_end, now()));
    _months := coalesce(_req.months_purchased,
                        case _req.billing_period when 'yearly' then 12
                                                 when 'quarterly' then 3
                                                 else 1 end);
    _end := _start + make_interval(months => _months);

    update public.subscription_requests set
      status = 'approved', reviewed_by = auth.uid(), reviewed_by_name = coalesce(_actor,'Platform owner'),
      reviewed_at = now(), period_start = _start, period_end = _end, decision_reason = _reason
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
          jsonb_build_object('request_id', _req.id, 'reference', _req.payment_reference, 'amount', _req.amount_due,
                             'months', _months, 'monthly_rate', _req.monthly_rate,
                             'reason', _reason, 'period_end', _req.period_end));

  return _req;
end; $function$;