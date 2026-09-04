-- The shared debit writer must only run inside purchase RPCs (SECURITY DEFINER
-- callers), never directly from a signed-in session.
revoke all on function public.universe_purchase_debit(uuid, uuid, uuid, uuid, text, text, uuid, text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.universe_purchase_debit(uuid, uuid, uuid, uuid, text, text, uuid, text, text, text, numeric, numeric) to service_role;