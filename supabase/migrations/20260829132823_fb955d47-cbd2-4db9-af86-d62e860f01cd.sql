DROP FUNCTION IF EXISTS public.superadmin_set_shop_plan(uuid, uuid, integer, numeric, text);
REVOKE EXECUTE ON FUNCTION public.superadmin_set_shop_plan(uuid, uuid, integer, numeric, text, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.superadmin_set_shop_plan(uuid, uuid, integer, numeric, text, integer) TO authenticated;