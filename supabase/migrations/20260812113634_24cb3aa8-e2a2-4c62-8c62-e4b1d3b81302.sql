DROP FUNCTION IF EXISTS public.platform_overview();

CREATE OR REPLACE FUNCTION public.platform_overview()
RETURNS TABLE(id uuid, name text, slug text, description text, contact_email text, contact_phone text,
              signup_enabled boolean, signup_token text, plan_name text, plan_price numeric,
              subscription_state subscription_state, grace_period_days integer,
              current_period_end timestamp with time zone, payment_reference text,
              submitted_at timestamp with time zone, reviewed_at timestamp with time zone,
              created_at timestamp with time zone, admin_count bigint, member_count bigint,
              reseller_count bigint, operations_frozen boolean, frozen_reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can read the platform overview';
  end if;
  return query
    select e.id, e.name, e.slug, e.description, e.contact_email, e.contact_phone,
           e.signup_enabled, e.signup_token, e.plan_name, e.plan_price,
           e.subscription_state, e.grace_period_days, e.current_period_end,
           e.payment_reference, e.submitted_at, e.reviewed_at, e.created_at,
           (select count(*) from public.user_roles r where r.ecosystem_id = e.id and r.role = 'admin'),
           (select count(*) from public.profiles p where p.ecosystem_id = e.id),
           (select count(*) from public.user_roles r where r.ecosystem_id = e.id and r.role = 'reseller'),
           e.operations_frozen, e.frozen_reason
    from public.ecosystems e
    order by e.created_at desc;
end;
$function$;

REVOKE ALL ON FUNCTION public.platform_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_overview() TO authenticated;