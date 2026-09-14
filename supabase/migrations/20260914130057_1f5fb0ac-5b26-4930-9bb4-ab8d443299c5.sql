DROP FUNCTION IF EXISTS public.record_expense(numeric, text, text, uuid, text, timestamp with time zone);

GRANT EXECUTE ON FUNCTION public.record_expense(numeric, text, text, uuid, text, timestamp with time zone, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_expense(numeric, text, text, uuid, text, timestamp with time zone, text, text) FROM anon;