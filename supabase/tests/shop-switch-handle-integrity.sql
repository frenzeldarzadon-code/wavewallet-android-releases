-- Switching shops must never touch a person's global @handle.
--
-- Regression for: `duplicate key value violates unique constraint
-- "profiles_handle_unique"` when a reseller switched from one shop to another.
-- switch_ecosystem used to write `handle = membership.handle` — a mirrored,
-- sometimes stale or empty copy — back onto the global profile. When that
-- mirror held a handle already owned by someone else the switch aborted; when
-- it was NULL the handle trigger silently minted a brand new handle.
--
-- Run inside a transaction and ROLLBACK: it mutates real rows.

BEGIN;

-- 1. The switch function must not assign the profile handle at all.
DO $$
DECLARE _def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'switch_ecosystem';
  IF _def ~* 'handle\s*=\s*_m\.handle' THEN
    RAISE EXCEPTION 'switch_ecosystem still copies the membership handle onto the global profile';
  END IF;
  IF _def ~* 'full_name\s*=\s*_m\.' THEN
    RAISE EXCEPTION 'switch_ecosystem must not write global name fields';
  END IF;
END $$;

-- 2. No membership mirror may point at a handle owned by a different person.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ecosystem_memberships m
     JOIN public.profiles q ON q.id <> m.user_id
      AND public.normalize_handle(q.handle) = public.normalize_handle(m.handle)
  ) THEN
    RAISE EXCEPTION 'a membership mirrors a handle belonging to another member';
  END IF;
END $$;

-- 3. Live switching, back and forth, for a real multi-shop member.
DO $$
DECLARE
  _u uuid; _a uuid; _b uuid;
  _h text; _h2 text; _rows int; _role app_role; _mrole app_role;
BEGIN
  SELECT m.user_id INTO _u
    FROM public.ecosystem_memberships m
   WHERE m.membership_state = 'active' AND m.status = 'active'
     AND NOT public.is_super_admin(m.user_id)
   GROUP BY m.user_id HAVING count(*) > 1
   LIMIT 1;
  IF _u IS NULL THEN
    RAISE NOTICE 'skipped: no multi-shop member in this database';
    RETURN;
  END IF;

  SELECT ecosystem_id INTO _a FROM public.ecosystem_memberships
   WHERE user_id = _u AND membership_state = 'active' ORDER BY ecosystem_id LIMIT 1;
  SELECT ecosystem_id INTO _b FROM public.ecosystem_memberships
   WHERE user_id = _u AND membership_state = 'active' AND ecosystem_id <> _a LIMIT 1;

  SELECT handle INTO _h FROM public.profiles WHERE id = _u;

  -- Worst case: the source membership mirrors a handle that already belongs to
  -- somebody else. The switch must still succeed and keep the real handle.
  UPDATE public.ecosystem_memberships
     SET handle = (SELECT handle FROM public.profiles
                    WHERE id <> _u AND handle IS NOT NULL LIMIT 1)
   WHERE user_id = _u AND ecosystem_id = _b;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _u, 'role', 'authenticated')::text, true);

  PERFORM public.switch_ecosystem(_b);
  PERFORM public.switch_ecosystem(_a);
  PERFORM public.switch_ecosystem(_b);
  PERFORM public.switch_ecosystem(_a);

  SELECT handle INTO _h2 FROM public.profiles WHERE id = _u;
  IF _h2 IS DISTINCT FROM _h THEN
    RAISE EXCEPTION 'switching changed the global handle: % -> %', _h, _h2;
  END IF;

  SELECT count(*) INTO _rows FROM public.profiles WHERE id = _u;
  IF _rows <> 1 THEN RAISE EXCEPTION 'switching duplicated the profile row'; END IF;

  -- Shop-scoped state still comes from the entered shop's membership.
  SELECT role INTO _mrole FROM public.ecosystem_memberships
   WHERE user_id = _u AND ecosystem_id = _a;
  SELECT role INTO _role FROM public.user_roles
   WHERE user_id = _u AND ecosystem_id = _a LIMIT 1;
  IF _role IS DISTINCT FROM _mrole THEN
    RAISE EXCEPTION 'active role does not match the membership role of the entered shop';
  END IF;

  RAISE NOTICE 'shop switch handle integrity suite passed';
END $$;

ROLLBACK;
