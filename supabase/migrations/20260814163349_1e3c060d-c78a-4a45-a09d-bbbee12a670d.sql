DO $$
DECLARE
  _u uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e';
  _a uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205';
  _b uuid := '394abeef-c545-443c-bf1d-1eaca3c4d356';
  _c uuid;
  _wa numeric; _wb numeric; _wa2 numeric; _wb2 numeric;
  _eco uuid; _role app_role; _ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);

  SELECT balance INTO _wa FROM public.credit_accounts WHERE user_id=_u AND ecosystem_id=_a;
  SELECT balance INTO _wb FROM public.credit_accounts WHERE user_id=_u AND ecosystem_id=_b;

  -- A) Admin of A switches into shop B where they are also admin.
  PERFORM public.switch_ecosystem(_b);
  SELECT ecosystem_id INTO _eco FROM public.profiles WHERE id=_u;
  IF _eco <> _b THEN RAISE EXCEPTION 'switch into second shop did not take effect'; END IF;
  SELECT role INTO _role FROM public.user_roles WHERE user_id=_u AND ecosystem_id=_b;
  IF _role <> 'admin' THEN RAISE EXCEPTION 'role in second shop wrong: %', _role; END IF;

  -- F) Wallets stay shop-specific.
  SELECT balance INTO _wa2 FROM public.credit_accounts WHERE user_id=_u AND ecosystem_id=_a;
  SELECT balance INTO _wb2 FROM public.credit_accounts WHERE user_id=_u AND ecosystem_id=_b;
  IF _wa2 IS DISTINCT FROM _wa OR _wb2 IS DISTINCT FROM _wb THEN
    RAISE EXCEPTION 'switching moved credits: % -> %, % -> %', _wa, _wa2, _wb, _wb2;
  END IF;

  -- C) A shop they do not belong to stays refused.
  SELECT id INTO _c FROM public.ecosystems
   WHERE archived_at IS NULL AND id NOT IN (_a,_b)
     AND NOT EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.user_id=_u AND m.ecosystem_id=ecosystems.id)
   LIMIT 1;
  IF _c IS NOT NULL THEN
    _ok := false;
    BEGIN
      PERFORM public.switch_ecosystem(_c);
    EXCEPTION WHEN others THEN _ok := true;
    END;
    IF NOT _ok THEN RAISE EXCEPTION 'a non-member was able to enter a foreign shop'; END IF;
  END IF;

  -- Restore the original active shop.
  PERFORM public.switch_ecosystem(_a);
  SELECT ecosystem_id INTO _eco FROM public.profiles WHERE id=_u;
  IF _eco <> _a THEN RAISE EXCEPTION 'switch back to first shop failed'; END IF;
  SELECT balance INTO _wa2 FROM public.credit_accounts WHERE user_id=_u AND ecosystem_id=_a;
  SELECT balance INTO _wb2 FROM public.credit_accounts WHERE user_id=_u AND ecosystem_id=_b;
  IF _wa2 IS DISTINCT FROM _wa OR _wb2 IS DISTINCT FROM _wb THEN
    RAISE EXCEPTION 'switching back moved credits';
  END IF;

  RAISE NOTICE 'shop switch verification passed';
END $$;