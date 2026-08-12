revoke execute on function public.list_voucher_batches(uuid) from anon, public;
revoke execute on function public.delete_voucher_code(uuid) from anon, public;
revoke execute on function public.delete_voucher_batch(uuid) from anon, public;
grant execute on function public.list_voucher_batches(uuid) to authenticated;
grant execute on function public.delete_voucher_code(uuid) to authenticated;
grant execute on function public.delete_voucher_batch(uuid) to authenticated;