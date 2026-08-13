REVOKE ALL ON FUNCTION public.admin_voucher_discount_percent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_voucher_discount_percent() TO authenticated, service_role;