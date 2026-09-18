-- Remove the redundant 2-argument dm_send wrapper. The 3-argument function has
-- a DEFAULT for _image_path, so every existing call keeps working, while the
-- overload ambiguity ("could not choose the best candidate function") is gone.
DROP FUNCTION IF EXISTS public.dm_send(uuid, text);

REVOKE EXECUTE ON FUNCTION public.dm_send(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dm_send(uuid, text, text) TO authenticated;