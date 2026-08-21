-- Reseller hierarchy is strictly per shop.
--
-- Everything runs inside a sub-block that is ALWAYS aborted:
--
--   \i supabase/tests/reseller-hierarchy-per-shop.sql
--
-- Expectations:
--   1. a member may be a subreseller under reseller Y in shop A and, at the
--      same time, a subreseller under a different reseller Z in shop B
--   2. reseller Y does NOT need any membership in shop B
--   3. a parent that is not an active reseller in THAT shop is refused
--   4. a member cannot be their own parent, and loops are refused

DO $$
DECLARE
  _ecoA uuid; _ecoB uuid; _y uuid; _z uuid; _x uuid; _n int;
BEGIN
 BEGIN
  SELECT id INTO _ecoA FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id INTO _ecoB FROM public.ecosystems WHERE id <> _ecoA ORDER BY created_at LIMIT 1;
  IF _ecoA IS NULL OR _ecoB IS NULL THEN
    RAISE NOTICE 'SKIP: need two shops'; RETURN;
  END IF;

  SELECT id INTO _y FROM public.profiles WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO _z FROM public.profiles WHERE deleted_at IS NULL AND id <> _y ORDER BY created_at LIMIT 1;
  SELECT id INTO _x FROM public.profiles WHERE deleted_at IS NULL AND id NOT IN (_y, _z) ORDER BY created_at LIMIT 1;
  IF _x IS NULL THEN RAISE NOTICE 'SKIP: need three profiles'; RETURN; END IF;

  -- Y is a reseller in shop A only; Z is a reseller in shop B only.
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
  VALUES (_y, _ecoA, 'reseller', 'active', 'active')
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE SET role = 'reseller', membership_state = 'active';
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
  VALUES (_z, _ecoB, 'reseller', 'active', 'active')
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE SET role = 'reseller', membership_state = 'active';

  -- 1 + 2. X is a subreseller under Y in A and under Z in B.
  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state, reseller_id)
  VALUES (_x, _ecoA, 'subreseller', 'active', 'active', _y)
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE
    SET role = 'subreseller', membership_state = 'active', reseller_id = _y;

  INSERT INTO public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state, reseller_id)
  VALUES (_x, _ecoB, 'subreseller', 'active', 'active', _z)
  ON CONFLICT (user_id, ecosystem_id) DO UPDATE
    SET role = 'subreseller', membership_state = 'active', reseller_id = _z;

  SELECT count(*) INTO _n FROM public.ecosystem_memberships
   WHERE user_id = _x AND ((ecosystem_id = _ecoA AND reseller_id = _y)
                        OR (ecosystem_id = _ecoB AND reseller_id = _z));
  IF _n <> 2 THEN
    RAISE EXCEPTION 'FAIL 1: a member must keep an independent parent per shop';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ecosystem_memberships
              WHERE user_id = _y AND ecosystem_id = _ecoB AND membership_state = 'active') THEN
    RAISE EXCEPTION 'FAIL 2: shop A parent should not need shop B membership';
  END IF;

  -- 3. a parent with no reseller membership in that shop is refused
  BEGIN
    UPDATE public.ecosystem_memberships SET reseller_id = _y
     WHERE user_id = _x AND ecosystem_id = _ecoB;
    RAISE EXCEPTION 'FAIL 3: accepted a parent from another shop';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL 3%' THEN RAISE; END IF;
  END;

  -- 4. self-parenting is refused
  BEGIN
    UPDATE public.ecosystem_memberships SET reseller_id = _x
     WHERE user_id = _x AND ecosystem_id = _ecoA;
    RAISE EXCEPTION 'FAIL 4: accepted self as parent';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL 4%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: reseller hierarchy is independent per shop';
  RAISE EXCEPTION 'ROLLBACK: test complete';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'ROLLBACK:%' THEN RAISE NOTICE '%', SQLERRM; ELSE RAISE; END IF;
 END;
END $$;
