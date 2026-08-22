revoke execute on function public.payment_reference_hash(text, text) from anon, authenticated;
revoke execute on function public.remember_payment_reference(text, text, uuid, uuid) from anon, authenticated;
revoke execute on function public.payment_reference_used_elsewhere(uuid, text, text) from anon, authenticated;
revoke execute on function public.payment_provider_for(text, text) from anon;
revoke execute on function public.cash_in_duplicate_indicator(uuid) from anon;
revoke execute on function public.listener_match_signals(public.listener_events, public.cash_in_requests) from anon;
revoke execute on function public.listener_has_strong_signal(public.listener_events, public.cash_in_requests) from anon;