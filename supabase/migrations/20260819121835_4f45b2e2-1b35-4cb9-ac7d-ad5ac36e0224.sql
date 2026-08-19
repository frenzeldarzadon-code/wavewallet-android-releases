-- Username + password sign-in: a dedicated, globally unique login name that is
-- neither an email nor a phone number. Passwords are never stored here: they
-- stay inside the authentication provider as salted hashes.

CREATE TABLE public.login_usernames (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  username text NOT NULL,
  ecosystem_id uuid REFERENCES public.ecosystems(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_usernames_format CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$')
);

CREATE UNIQUE INDEX login_usernames_lower_key ON public.login_usernames (lower(username));

GRANT SELECT ON public.login_usernames TO authenticated;
GRANT ALL ON public.login_usernames TO service_role;

ALTER TABLE public.login_usernames ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own login username"
  ON public.login_usernames FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Platform owner reads every login username"
  ON public.login_usernames FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Shop admins read login usernames in their shop"
  ON public.login_usernames FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ecosystem_memberships m
      WHERE m.user_id = login_usernames.user_id
        AND public.is_ecosystem_admin(auth.uid(), m.ecosystem_id)
    )
  );

-- Failed sign-in throttling. Server-side only: no role but the service role
-- may read or write it, so attempts can never be enumerated from a browser.
CREATE TABLE public.login_attempts (
  id bigserial PRIMARY KEY,
  username text NOT NULL,
  succeeded boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_recent_idx ON public.login_attempts (lower(username), attempted_at DESC);
GRANT ALL ON public.login_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.login_attempts_id_seq TO service_role;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Who may manage another member's login credential: the platform owner
-- anywhere, a shop admin only inside a shop the target actually belongs to.
CREATE OR REPLACE FUNCTION public.can_manage_login_credential(_actor uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _actor IS NOT NULL AND _target IS NOT NULL AND (
    public.is_super_admin(_actor)
    OR EXISTS (
      SELECT 1 FROM public.ecosystem_memberships m
      WHERE m.user_id = _target
        AND public.is_ecosystem_admin(_actor, m.ecosystem_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = _target
        AND p.ecosystem_id IS NOT NULL
        AND public.is_ecosystem_admin(_actor, p.ecosystem_id)
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_login_credential(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_login_credential(uuid, uuid) TO authenticated, service_role;

-- Sets (or changes) the login username. Case-insensitively unique platform-wide.
CREATE OR REPLACE FUNCTION public.set_login_username(_target uuid, _username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor uuid := auth.uid();
  _clean text := lower(btrim(coalesce(_username, '')));
  _eco uuid;
BEGIN
  IF NOT public.can_manage_login_credential(_actor, _target) THEN
    RAISE EXCEPTION 'You can only manage login credentials for members of your own shop.';
  END IF;

  IF _clean !~ '^[a-z0-9][a-z0-9_.-]{2,31}$' THEN
    RAISE EXCEPTION 'Usernames are 3-32 characters: letters, numbers, dot, dash or underscore.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.login_usernames l
    WHERE lower(l.username) = _clean AND l.user_id <> _target
  ) THEN
    RAISE EXCEPTION 'That username is already taken.';
  END IF;

  SELECT p.ecosystem_id INTO _eco FROM public.profiles p WHERE p.id = _target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found.';
  END IF;

  INSERT INTO public.login_usernames (user_id, username, ecosystem_id, created_by)
  VALUES (_target, _clean, _eco, _actor)
  ON CONFLICT (user_id) DO UPDATE
    SET username = EXCLUDED.username,
        ecosystem_id = EXCLUDED.ecosystem_id,
        updated_at = now();

  PERFORM public.log_operator_action(
    _target, _eco, 'Login username set', 'login_username', _target,
    jsonb_build_object('username', _clean)
  );

  RETURN _clean;
END;
$$;

REVOKE ALL ON FUNCTION public.set_login_username(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_login_username(uuid, text) TO authenticated, service_role;

-- Removes the username login without touching any other sign-in method.
CREATE OR REPLACE FUNCTION public.clear_login_username(_target uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor uuid := auth.uid();
  _eco uuid;
BEGIN
  IF NOT public.can_manage_login_credential(_actor, _target) THEN
    RAISE EXCEPTION 'You can only manage login credentials for members of your own shop.';
  END IF;

  SELECT p.ecosystem_id INTO _eco FROM public.profiles p WHERE p.id = _target;
  DELETE FROM public.login_usernames WHERE user_id = _target;

  PERFORM public.log_operator_action(
    _target, _eco, 'Login username removed', 'login_username', _target, '{}'::jsonb
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_login_username(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_login_username(uuid) TO authenticated, service_role;