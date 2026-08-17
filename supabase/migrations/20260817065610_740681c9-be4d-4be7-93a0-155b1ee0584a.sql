REVOKE EXECUTE ON FUNCTION public.register_push_device(text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_push_device_enabled(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.remove_push_device(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_push_device(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_push_devices() FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_notifications(integer) FROM anon;