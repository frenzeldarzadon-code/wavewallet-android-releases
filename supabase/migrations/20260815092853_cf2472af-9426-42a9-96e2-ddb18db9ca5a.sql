
-- Re-assigning the current admin used to raise. Make it idempotent: refresh
-- the existing shop membership, role row and wallet in place, then stop.
DO $$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'assign_shop_admin';

  _new := replace(_def,
    $old$  if _old = _user_id then
    raise exception 'That member already manages this shop';
  end if;$old$,
    $rep$  if _old = _user_id then
    -- Already the admin here: reuse the existing membership and wallet.
    update public.ecosystem_memberships
       set role = 'admin', membership_state = 'active', status = 'active'
     where user_id = _user_id and ecosystem_id = _ecosystem_id;
    insert into public.user_roles (user_id, ecosystem_id, role)
    values (_user_id, _ecosystem_id, 'admin')
    on conflict (user_id, ecosystem_id, role) do nothing;
    perform public.ensure_membership_wallets(_user_id, _ecosystem_id);
    return;
  end if;$rep$);

  IF _new = _def THEN
    RAISE EXCEPTION 'assign_shop_admin no longer contains the expected re-assignment guard';
  END IF;
  EXECUTE _new;
END $$;
