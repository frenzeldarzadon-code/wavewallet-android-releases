revoke execute on function public.transfer_reversal_info(text) from public, anon;
revoke execute on function public.reverse_credit_transfer(text, numeric, text, text) from public, anon;
grant execute on function public.transfer_reversal_info(text) to authenticated;
grant execute on function public.reverse_credit_transfer(text, numeric, text, text) to authenticated;