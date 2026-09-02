-- Handle safety net also on UPDATE (existing valid handles are only normalized, never replaced)
DROP TRIGGER IF EXISTS profiles_assign_handle ON public.profiles;
CREATE TRIGGER profiles_assign_handle
  BEFORE INSERT OR UPDATE OF handle, full_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assign_profile_handle();

-- Backfill members who predate the auto-assignment trigger
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, full_name, email FROM public.profiles
            WHERE deleted_at IS NULL AND public.normalize_handle(handle) IS NULL
            ORDER BY created_at LOOP
    UPDATE public.profiles
       SET handle = public.unique_handle(public.handle_candidate(r.full_name, r.email), r.id),
           updated_at = now()
     WHERE id = r.id;
  END LOOP;
END $$;