revoke all on function public.set_cash_in_provider() from public;
revoke all on function public.set_cash_in_provider() from anon;
revoke all on function public.set_cash_in_provider() from authenticated;
grant execute on function public.set_cash_in_provider() to service_role;
revoke all on function public.payment_provider_by_name(text) from anon;
grant execute on function public.payment_provider_by_name(text) to authenticated;
grant execute on function public.payment_provider_by_name(text) to service_role;