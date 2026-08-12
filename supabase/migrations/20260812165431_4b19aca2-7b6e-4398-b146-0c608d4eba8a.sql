REVOKE EXECUTE ON FUNCTION public.role_restructure_check(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.restructure_member_role(uuid, app_role, text, uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.role_restructure_check(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restructure_member_role(uuid, app_role, text, uuid, jsonb) TO authenticated;