-- The blanket PUBLIC grant on these helpers overrode the role-level revokes,
-- so anonymous callers still reached them. Remove PUBLIC, then grant explicitly.

-- Internal-only: called from other SECURITY DEFINER functions, never by clients.
revoke execute on function public.countable_members(uuid) from public;
revoke execute on function public.ecosystem_monthly_rate(uuid) from public;
revoke execute on function public.ecosystem_last_activity(uuid) from public;
revoke execute on function public.upline_commission_rate_for(uuid) from public;
grant execute on function public.countable_members(uuid) to service_role;
grant execute on function public.ecosystem_monthly_rate(uuid) to service_role;
grant execute on function public.ecosystem_last_activity(uuid) to service_role;
grant execute on function public.upline_commission_rate_for(uuid) to service_role;

-- Signed-in only: each function still enforces its own admin/owner check.
revoke execute on function public.platform_overview() from public;
revoke execute on function public.ecosystem_dashboard(uuid) from public;
revoke execute on function public.earnings_history(uuid, uuid, timestamptz, timestamptz) from public;
revoke execute on function public.ecosystem_cleanup_check(uuid) from public;
revoke execute on function public.customer_deletion_check(uuid) from public;
revoke execute on function public.voucher_discount_percent_for(uuid) from public;
revoke execute on function public.adjust_ecosystem_expiration(uuid, timestamptz, text, text, boolean) from public;
revoke execute on function public.archive_ecosystem(uuid, text) from public;
revoke execute on function public.delete_customer_account(uuid, text) from public;
revoke execute on function public.run_ecosystem_cleanup(boolean) from public;
revoke execute on function public.set_ecosystem_rates(uuid, integer, integer, integer, integer, integer) from public;
revoke execute on function public.wallet_integrity_check() from public;

grant execute on function public.platform_overview() to authenticated, service_role;
grant execute on function public.ecosystem_dashboard(uuid) to authenticated, service_role;
grant execute on function public.earnings_history(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.ecosystem_cleanup_check(uuid) to authenticated, service_role;
grant execute on function public.customer_deletion_check(uuid) to authenticated, service_role;
grant execute on function public.voucher_discount_percent_for(uuid) to authenticated, service_role;
grant execute on function public.adjust_ecosystem_expiration(uuid, timestamptz, text, text, boolean) to authenticated, service_role;
grant execute on function public.archive_ecosystem(uuid, text) to authenticated, service_role;
grant execute on function public.delete_customer_account(uuid, text) to authenticated, service_role;
grant execute on function public.run_ecosystem_cleanup(boolean) to authenticated, service_role;
grant execute on function public.set_ecosystem_rates(uuid, integer, integer, integer, integer, integer) to authenticated, service_role;
grant execute on function public.wallet_integrity_check() to authenticated, service_role;