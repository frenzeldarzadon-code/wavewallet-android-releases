-- Subscription transaction history — ONE source, two audiences.
create or replace function public.shop_subscription_history(_ecosystem_id uuid)
returns table (
  id uuid,
  occurred_at timestamptz,
  source text,
  event_type text,
  previous_plan_name text,
  new_plan_name text,
  amount_php numeric,
  coins numeric,
  period_start timestamptz,
  period_end timestamptz,
  reference text,
  actor_name text,
  detail text
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select public.is_super_admin(auth.uid())
        or public.is_ecosystem_admin(auth.uid(), _ecosystem_id) as ok
  )
  select * from (
    select e.id,
           e.created_at as occurred_at,
           'subscription'::text as source,
           e.event_type,
           pp.name as previous_plan_name,
           np.name as new_plan_name,
           e.amount_php,
           e.additional_allocation as coins,
           e.period_start,
           e.period_end,
           e.payment_reference as reference,
           e.actor_name,
           e.notes as detail
      from public.subscription_events e
      left join public.subscription_plans pp on pp.id = e.previous_plan_id
      left join public.subscription_plans np on np.id = e.new_plan_id
     where e.ecosystem_id = _ecosystem_id

    union all

    select a.id,
           a.created_at,
           'adjustment'::text,
           case a.direction when 'extended' then 'super_admin_extension'
                            when 'shortened' then 'super_admin_shortening'
                            else 'super_admin_adjustment' end,
           null::text,
           null::text,
           null::numeric,
           null::numeric,
           a.previous_period_end,
           a.new_period_end,
           null::text,
           a.actor_name,
           a.reason
      from public.subscription_adjustments a
     where a.ecosystem_id = _ecosystem_id

    union all

    select i.id,
           i.created_at,
           'platform_credit'::text,
           'super_admin_credit',
           null::text,
           null::text,
           null::numeric,
           i.amount,
           null::timestamptz,
           null::timestamptz,
           i.reference,
           i.operator_name,
           i.reason
      from public.platform_credit_issuances i
     where i.ecosystem_id = _ecosystem_id
  ) rows
  where (select ok from allowed)
  order by occurred_at desc
  limit 200;
$$;

revoke all on function public.shop_subscription_history(uuid) from public, anon;
grant execute on function public.shop_subscription_history(uuid) to authenticated, service_role;