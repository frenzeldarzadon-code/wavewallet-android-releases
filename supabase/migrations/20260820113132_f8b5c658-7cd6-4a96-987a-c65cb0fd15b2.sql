revoke all on function public.link_listener_event(uuid, uuid, text) from public, anon;
grant execute on function public.link_listener_event(uuid, uuid, text) to authenticated, service_role;