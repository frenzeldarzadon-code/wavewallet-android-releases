revoke execute on function public.money_settings() from public;
revoke execute on function public.universe_profile(text) from public;
revoke execute on function public.set_platform_money_settings(integer, integer, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function public.money_settings() to authenticated;
grant execute on function public.universe_profile(text) to authenticated;
grant execute on function public.set_platform_money_settings(integer, integer, numeric, numeric, numeric, numeric, numeric) to authenticated;