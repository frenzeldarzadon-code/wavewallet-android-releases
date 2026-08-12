-- ============ Platform settings (singleton) ============
CREATE TABLE public.platform_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  plan_name text NOT NULL DEFAULT 'Operator Monthly',
  plan_price numeric NOT NULL DEFAULT 150 CHECK (plan_price >= 0),
  billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','quarterly','yearly')),
  grace_period_days integer NOT NULL DEFAULT 5 CHECK (grace_period_days >= 0),
  currency text NOT NULL DEFAULT 'PHP',
  gcash_number text NOT NULL DEFAULT '',
  gcash_account_name text NOT NULL DEFAULT '',
  payment_instructions text NOT NULL DEFAULT '',
  support_page_name text NOT NULL DEFAULT '',
  support_page_url text NOT NULL DEFAULT '',
  support_message text NOT NULL DEFAULT '',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in operators read platform settings"
  ON public.platform_settings FOR SELECT TO authenticated USING (true);

CREATE TRIGGER platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.platform_settings (id, gcash_number, gcash_account_name, payment_instructions, support_page_name, support_page_url, support_message)
VALUES (
  1,
  '0917 555 0142',
  'WaveWallet Platform',
  'Send the exact amount due to the GCash number above, then submit the GCash reference number and a screenshot of the receipt. Approval is manual and usually takes less than a day.',
  'WaveWallet Support',
  'https://facebook.com/wavewallet.support',
  'Message us on Facebook and include your operator ID.'
);

-- ============ Subscription requests (immutable history) ============
CREATE TABLE public.subscription_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  requested_by uuid,
  requested_by_name text NOT NULL DEFAULT '',
  plan_name text NOT NULL,
  plan_price numeric NOT NULL,
  billing_period text NOT NULL,
  amount_due numeric NOT NULL,
  amount_paid numeric,
  currency text NOT NULL DEFAULT 'PHP',
  payment_reference text NOT NULL,
  proof_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decision_reason text,
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_requests_eco_idx ON public.subscription_requests (ecosystem_id, created_at DESC);
CREATE INDEX subscription_requests_status_idx ON public.subscription_requests (status, created_at DESC);

GRANT SELECT ON public.subscription_requests TO authenticated;
GRANT ALL ON public.subscription_requests TO service_role;
ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop admins read their subscription requests"
  ON public.subscription_requests FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );

CREATE TRIGGER subscription_requests_updated_at
  BEFORE UPDATE ON public.subscription_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Proof-of-payment storage policies ============
CREATE POLICY "Shop admins upload their payment proofs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (
      public.is_super_admin(auth.uid())
      OR public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  );

CREATE POLICY "Shop admins read their payment proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (
      public.is_super_admin(auth.uid())
      OR public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  );

-- ============ RPCs ============
CREATE OR REPLACE FUNCTION public.update_platform_settings(
  _plan_name text,
  _plan_price numeric,
  _billing_period text,
  _grace_period_days integer,
  _currency text,
  _gcash_number text,
  _gcash_account_name text,
  _payment_instructions text,
  _support_page_name text,
  _support_page_url text,
  _support_message text
) RETURNS public.platform_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _row public.platform_settings; _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can change platform settings';
  end if;
  if _billing_period not in ('monthly','quarterly','yearly') then
    raise exception 'Unsupported billing period';
  end if;
  if _plan_price < 0 then raise exception 'Price cannot be negative'; end if;

  update public.platform_settings set
    plan_name = _plan_name,
    plan_price = _plan_price,
    billing_period = _billing_period,
    grace_period_days = greatest(_grace_period_days, 0),
    currency = _currency,
    gcash_number = _gcash_number,
    gcash_account_name = _gcash_account_name,
    payment_instructions = _payment_instructions,
    support_page_name = _support_page_name,
    support_page_url = _support_page_url,
    support_message = _support_message,
    updated_by = auth.uid()
  where id = 1
  returning * into _row;

  select coalesce(full_name, 'Platform owner') into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce(_actor,'Platform owner'), 'Updated platform subscription settings', _plan_name,
          jsonb_build_object('plan_price', _plan_price, 'billing_period', _billing_period, 'grace_period_days', _grace_period_days));

  return _row;
end; $$;

CREATE OR REPLACE FUNCTION public.submit_subscription_request(
  _ecosystem_id uuid,
  _reference text,
  _amount_paid numeric DEFAULT NULL,
  _proof_path text DEFAULT NULL
) RETURNS public.subscription_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _s public.platform_settings; _req public.subscription_requests; _name text; _eco text;
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

  select * into _s from public.platform_settings where id = 1;
  select coalesce(full_name, 'Shop operator') into _name from public.profiles where id = auth.uid();
  select name into _eco from public.ecosystems where id = _ecosystem_id;

  insert into public.subscription_requests (
    ecosystem_id, requested_by, requested_by_name, plan_name, plan_price, billing_period,
    amount_due, amount_paid, currency, payment_reference, proof_path
  ) values (
    _ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'), _s.plan_name, _s.plan_price, _s.billing_period,
    _s.plan_price, _amount_paid, _s.currency, btrim(_reference), _proof_path
  ) returning * into _req;

  update public.ecosystems set
    subscription_state = 'awaiting_approval',
    payment_reference = btrim(_reference),
    submitted_at = now()
  where id = _ecosystem_id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'), 'Submitted subscription payment', coalesce(_eco,'Shop'),
          jsonb_build_object('reference', btrim(_reference), 'amount_due', _s.plan_price, 'billing_period', _s.billing_period, 'request_id', _req.id));

  return _req;
end; $$;

CREATE OR REPLACE FUNCTION public.review_subscription_request(
  _request_id uuid,
  _decision text,
  _reason text DEFAULT NULL
) RETURNS public.subscription_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _req public.subscription_requests; _actor text; _start timestamptz; _end timestamptz; _eco public.ecosystems;
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
    _start := greatest(now(), coalesce(_eco.current_period_end, now()));
    _end := _start + case _req.billing_period
              when 'yearly' then interval '1 year'
              when 'quarterly' then interval '3 months'
              else interval '1 month' end;

    update public.subscription_requests set
      status = 'approved', reviewed_by = auth.uid(), reviewed_by_name = coalesce(_actor,'Platform owner'),
      reviewed_at = now(), period_start = _start, period_end = _end, decision_reason = _reason
    where id = _request_id returning * into _req;

    update public.ecosystems set
      subscription_state = 'active',
      plan_name = _req.plan_name,
      plan_price = _req.plan_price,
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
                             'reason', _reason, 'period_end', _req.period_end));

  return _req;
end; $$;

REVOKE ALL ON FUNCTION public.update_platform_settings(text,numeric,text,integer,text,text,text,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.submit_subscription_request(uuid,text,numeric,text) FROM anon;
REVOKE ALL ON FUNCTION public.review_subscription_request(uuid,text,text) FROM anon;