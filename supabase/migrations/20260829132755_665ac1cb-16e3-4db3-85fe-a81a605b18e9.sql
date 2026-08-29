CREATE OR REPLACE FUNCTION public.superadmin_set_shop_plan(_ecosystem_id uuid, _plan_id uuid, _months integer DEFAULT 1, _discount_percent numeric DEFAULT 0, _reason text DEFAULT NULL::text, _paid_months integer DEFAULT NULL::integer)
 RETURNS shop_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _sub public.shop_subscriptions; _plan public.subscription_plans;
        _amount numeric(14,2); _eco text; _me text; _paid integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can override a subscription';
  end if;
  if coalesce(_discount_percent,0) < 0 or coalesce(_discount_percent,0) > 100 then
    raise exception 'Discount must be between 0 and 100 percent';
  end if;
  select * into _plan from public.subscription_plans where id = _plan_id and active;
  if _plan.id is null then raise exception 'Choose an available plan'; end if;
  if not public.is_new_generation_shop(_ecosystem_id) then
    raise exception 'Legacy shops keep their existing subscription handling';
  end if;

  -- Promotion support: the shop may be CHARGED for fewer months than the
  -- SERVICE period it receives (for example pay 10, get 12). Never more.
  _paid := coalesce(_paid_months, _months, 1);
  if _paid < 1 or _paid > coalesce(_months,1) then
    raise exception 'Paid months must be between 1 and the service months';
  end if;

  _amount := round(_plan.monthly_price * _paid * (100 - coalesce(_discount_percent,0)) / 100.0, 2);
  _sub := public.apply_subscription_plan(
    _ecosystem_id, _plan_id, _months, _amount, null,
    'PLATFORM_OVERRIDE — ' || _plan.name || ' at ' || coalesce(_discount_percent,0) || '% discount'
      || case when _paid <> coalesce(_months,1)
              then ' — promotion: paid ' || _paid || ' of ' || _months || ' months'
              else '' end
      || coalesce(' — ' || nullif(btrim(_reason),''), ''));

  select name into _eco from public.ecosystems where id = _ecosystem_id;
  select coalesce(full_name,'Platform owner') into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), _me, 'Platform owner set shop subscription plan', coalesce(_eco,'Shop'),
          jsonb_build_object('plan', _plan.name, 'months', _months, 'paid_months', _paid,
                             'promotion', _paid <> coalesce(_months,1),
                             'discount_percent', coalesce(_discount_percent,0),
                             'amount_charged', _amount, 'free', _amount = 0, 'reason', _reason));
  return _sub;
end $function$;