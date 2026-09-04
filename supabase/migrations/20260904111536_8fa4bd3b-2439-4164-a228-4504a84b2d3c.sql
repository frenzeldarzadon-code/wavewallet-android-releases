-- Trigger functions are never called by API roles.
revoke all on function public.tg_listener_source_rule_audit() from public, anon, authenticated;