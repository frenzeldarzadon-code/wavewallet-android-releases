-- Shop memberships are self-contained: a parent reseller in Shop A can never
-- block, replace or leak into the same person's membership in Shop B.
--
--   \i supabase/tests/multi-shop-parent-independence.sql
--
-- Expectations:
--   a. a subreseller in Shop A can become a subreseller in Shop B under a
--      different parent
--   b. the Shop A parent does not block pointing the profile at Shop B
--   c. the Shop B membership keeps its own parent/discount/commission
--   d. switching the profile back to Shop A restores Shop A's mirror values
--   e. a parent with no reseller membership in the target shop is rejected
--   f. a plain customer joining a second shop is unaffected

DO $$
DECLARE
  _ecoA uuid; _ecoB uuid; _y uuid; _z uuid; _x uuid; _c uuid; _p uuid; _n int;
BEGIN
 BEGIN
  SELECT id INTO _ecoA FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _ecoB FROM public.ecosystems WHERE id <> _ecoA ORDER BY created_at LIMIT 1;
  IF _ecoB IS NULL THEN RAISE NOTICE 'SKIP: need two shops'; RETURN; END IF;

  SELECT id INTO _y FROM public.profiles WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO _z FROM public.profiles WHERE deleted_at IS NULL AND id <> _y ORDER BY created_at LIMIT 1;
  SELECT id INTO _x FROM public.profiles WHERE deleted_at IS NULL AND id NOT IN (_y,_z) ORDER BY created_at LIMIT 1;
  SELECT id INTO _c FROM public.profiles WHERE deleted_at IS NULL AND id NOT IN (_y,_z,_x) ORDER BY created_at LIMIT 1;
  IF _c IS NULL THEN RAISE NOTICE 'SKIP: need four profiles'; RETURN; END IF;

  -- Y is a reseller in shop A only, Z a reseller in shop B only.
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state,
                                            reseller_discount_percent, sale_commission_percent)
  VALUES (_y, _ecoA, 'reseller', 'active', 'active', 20, 20)
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE
    SET role='reseller', membership_state='active', reseller_discount_percent=20, sale_commission_percent=20;
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state,
                                            reseller_discount_percent, sale_commission_percent)
  VALUES (_z, _ecoB, 'reseller', 'active', 'active', 30, 30)
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE
    SET role='reseller', membership_state='active', reseller_discount_percent=30, sale_commission_percent=30;

  -- a. X is a subreseller under Y in A and under Z in B.
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state,
                                            reseller_id, reseller_discount_percent, sale_commission_percent)
  VALUES (_x, _ecoA, 'subreseller', 'active', 'active', _y, 10, 10)
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE
    SET role='subreseller', membership_state='active', reseller_id=_y,
        reseller_discount_percent=10, sale_commission_percent=10;
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state,
                                            reseller_id, reseller_discount_percent, sale_commission_percent)
  VALUES (_x, _ecoB, 'subreseller', 'active', 'active', _z, 25, 25)
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE
    SET role='subreseller', membership_state='active', reseller_id=_z,
        reseller_discount_percent=25, sale_commission_percent=25;

  -- b. Pointing the profile at shop B with a stale shop A parent must not fail.
  UPDATE public.profiles SET reseller_id = _y, ecosystem_id = _ecoA WHERE id = _x;
  UPDATE public.profiles SET ecosystem_id = _ecoB WHERE id = _x;

  -- c. The mirror follows shop B's membership, not shop A's parent.
  SELECT reseller_id INTO _p FROM public.profiles WHERE id = _x;
  IF _p IS DISTINCT FROM _z THEN
    RAISE EXCEPTION 'FAIL c: profile mirror kept the wrong shop parent (%)', _p;
  END IF;
  SELECT reseller_discount_percent INTO _n FROM public.profiles WHERE id = _x;
  IF _n <> 25 THEN RAISE EXCEPTION 'FAIL c: mirror discount is % not 25', _n; END IF;

  SELECT count(*) INTO _n FROM public.ecosystem_memberships
   WHERE user_id = _x AND ((ecosystem_id=_ecoA AND reseller_id=_y AND sale_commission_percent=10)
                        OR (ecosystem_id=_ecoB AND reseller_id=_z AND sale_commission_percent=25));
  IF _n <> 2 THEN RAISE EXCEPTION 'FAIL c: memberships lost their own parent/discount'; END IF;

  -- d. Switching back restores shop A's values.
  UPDATE public.profiles SET ecosystem_id = _ecoA WHERE id = _x;
  SELECT reseller_id INTO _p FROM public.profiles WHERE id = _x;
  SELECT reseller_discount_percent INTO _n FROM public.profiles WHERE id = _x;
  IF _p IS DISTINCT FROM _y OR _n <> 10 THEN
    RAISE EXCEPTION 'FAIL d: switching back did not restore shop A mirror';
  END IF;

  -- e. A parent that is not a reseller in the target shop is refused.
  BEGIN
    UPDATE public.ecosystem_memberships SET reseller_id = _y
     WHERE user_id = _x AND ecosystem_id = _ecoB;
    RAISE EXCEPTION 'FAIL e: accepted a parent from another shop';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL e%' THEN RAISE; END IF;
  END;

  -- f. A plain customer joining a second shop is untouched.
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
  VALUES (_c, _ecoB, 'customer', 'active', 'active')
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE SET role='customer', membership_state='active';
  UPDATE public.profiles SET ecosystem_id = _ecoB WHERE id = _c;
  SELECT reseller_id INTO _p FROM public.profiles WHERE id = _c;
  IF _p IS NOT NULL THEN RAISE EXCEPTION 'FAIL f: customer gained a parent reseller'; END IF;

  RAISE NOTICE 'PASS: shop memberships are independent and the profile mirror follows the active shop';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'ROLLBACK:%' THEN RAISE NOTICE '%', SQLERRM; ELSE RAISE; END IF;
 END;
END $$;
