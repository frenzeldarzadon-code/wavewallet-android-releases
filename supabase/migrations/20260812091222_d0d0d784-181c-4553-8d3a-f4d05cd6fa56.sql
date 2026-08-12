-- 1. Central operational guard: platform owner is exempt; everyone else must be
--    inside an active (or grace-period) subscription to perform write actions.
CREATE OR REPLACE FUNCTION public.require_operational()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if public.is_super_admin(auth.uid()) then return; end if;
  if not public.subscription_ok(public.current_ecosystem(auth.uid())) then
    raise exception 'This shop is not active — the operator must renew the subscription before making changes';
  end if;
end;
$$;

REVOKE ALL ON FUNCTION public.require_operational() FROM anon;
GRANT EXECUTE ON FUNCTION public.require_operational() TO authenticated;

-- 2. Inject the guard into every state-changing tenant RPC, preserving each body.
DO $do$
declare
  _sig text;
  _def text;
  _pos int;
  _sigs text[] := array[
    'public.admin_adjust_credits(uuid,numeric,text,text)',
    'public.admin_adjust_points(uuid,integer,text,text)',
    'public.transfer_credits(uuid,numeric,text)',
    'public.reseller_load_credits(uuid,numeric,text)',
    'public.import_voucher_codes(uuid,text[],text)',
    'public.promote_to_reseller(uuid,integer)',
    'public.promote_to_subreseller(uuid,integer)',
    'public.set_reseller_discount(uuid,integer)',
    'public.set_reseller_commission(uuid,integer)',
    'public.set_member_status(uuid,account_status)',
    'public.set_points_rule(uuid,numeric)',
    'public.request_redemption(uuid)',
    'public.review_redemption(uuid,text,text)',
    'public.reverse_sale_points(uuid,text)',
    'public.regenerate_signup_token(uuid)'
  ];
begin
  foreach _sig in array _sigs loop
    _def := pg_get_functiondef(_sig::regprocedure);
    if position('require_operational' in _def) > 0 then
      continue;
    end if;
    _pos := position(E'\nbegin\n' in _def);
    if _pos = 0 then
      raise exception 'Could not locate body start for %', _sig;
    end if;
    _def := left(_def, _pos + 6) || E'  perform public.require_operational();\n' || substr(_def, _pos + 7);
    execute _def;
  end loop;
end;
$do$;

-- 3. Lifecycle: flip lapsed shops to expired. Data is retained, only access changes.
CREATE OR REPLACE FUNCTION public.expire_stale_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare _count integer;
begin
  with lapsed as (
    update public.ecosystems e
    set subscription_state = 'expired'
    where e.subscription_state = 'active'
      and e.current_period_end is not null
      and e.current_period_end + make_interval(days => e.grace_period_days) < now()
    returning e.id
  )
  select count(*) into _count from lapsed;
  return coalesce(_count, 0);
end;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_subscriptions() FROM anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_subscriptions() TO authenticated;

-- 4. Refresh expiry before a shop submits a payment.
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

  perform public.expire_stale_subscriptions();

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

REVOKE ALL ON FUNCTION public.submit_subscription_request(uuid,text,numeric,text) FROM anon;

-- 5. Remove the placeholder collection details that shipped as defaults.
UPDATE public.platform_settings
SET gcash_number = '',
    gcash_account_name = '',
    support_page_name = '',
    support_page_url = '',
    support_message = ''
WHERE id = 1
  AND gcash_number = '0917 555 0142';

ALTER TABLE public.platform_settings
  ALTER COLUMN payment_instructions SET DEFAULT '';