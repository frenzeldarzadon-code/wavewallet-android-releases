create or replace function public.normalize_sender_identifier(_raw text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(
    public.normalize_ph_mobile(_raw),
    nullif(regexp_replace(lower(btrim(coalesce(_raw, ''))), '[^a-z0-9]', '', 'g'), '')
  )
$$;

grant execute on function public.normalize_sender_identifier(text) to authenticated, anon, service_role;

create or replace function public.submit_go_live_payment(_ecosystem_id uuid, _plan_id uuid, _payer_number text, _reference text, _months integer DEFAULT 1, _amount_paid numeric DEFAULT NULL::numeric, _proof_path text DEFAULT NULL::text, _payment_method_id uuid DEFAULT NULL::uuid)
 RETURNS subscription_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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