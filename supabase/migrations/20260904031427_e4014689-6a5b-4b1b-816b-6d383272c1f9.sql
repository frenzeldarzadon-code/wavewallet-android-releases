REVOKE EXECUTE ON FUNCTION public.retail_checkout_quote(uuid, jsonb, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retail_is_self_purchase(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retail_peso(numeric) FROM PUBLIC, anon;