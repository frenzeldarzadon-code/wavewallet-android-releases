CREATE OR REPLACE FUNCTION public.list_signup_ecosystems()
RETURNS TABLE (id uuid, name text, slug text, description text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select e.id, e.name, e.slug, e.description
  from public.ecosystems e
  where e.signup_enabled
    and e.subscription_state = 'active'
    and not coalesce(e.operations_frozen, false)
  order by e.name
$$;

REVOKE ALL ON FUNCTION public.list_signup_ecosystems() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_signup_ecosystems() TO anon, authenticated, service_role;