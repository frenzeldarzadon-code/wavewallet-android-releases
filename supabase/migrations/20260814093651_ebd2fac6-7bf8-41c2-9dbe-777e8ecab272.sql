CREATE OR REPLACE FUNCTION public.public_support_contact()
 RETURNS TABLE(support_page_name text, support_page_url text, support_message text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.support_page_name, s.support_page_url, s.support_message
  from public.platform_settings s
  where s.id = 1;
$function$;

REVOKE ALL ON FUNCTION public.public_support_contact() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_support_contact() TO anon, authenticated, service_role;