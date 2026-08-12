-- Organization restructuring (Reseller <-> Subreseller) regression tests.
--
-- Everything runs inside one transaction that is ALWAYS rolled back and uses
-- freshly created fixture accounts only. No production membership, wallet,
-- ledger, sale or audit row survives this script.
--
--   BEGIN; \i supabase/tests/role-restructure.sql ROLLBACK;
--
-- Expectations:
--   1. reseller with no children demotes successfully (parent required)
--   2. reseller with children is blocked until children are reassigned
--   3. reassignment preserves the children and their identity/history
--   4. subreseller promotes successfully
--   5. old parent relationship is removed on promotion
--   6. historical upline attribution in past sales is unchanged
--   7. wallet credits and points are unchanged by any role change
--   8. cross-ecosystem operation is blocked
--   9. unauthorized roles (reseller/subreseller/customer) are blocked
--  10. no duplicate account / duplicate role rows are created
--  11. an audit entry with reason and parent details is written
--  12. admin and super_admin roles are protected
--  13. a reason is mandatory

BEGIN;

DO $$
DECLARE
  _eco uuid := '8b4fc15e-f6b3-444b-89f6-51a145fe874f';  -- demo ecosystem
  _admin uuid; _other_admin uuid; _other_eco uuid;
  _r1 uuid := gen_random_uuid();   -- reseller with children
  _r2 uuid := gen_random_uuid();   -- second reseller (receives children / parent)
  _sub uuid := gen_random_uuid();  -- subreseller under _r1
  _lone uuid := gen_random_uuid(); -- reseller with no children
  _cust uuid := gen_random_uuid(); -- plain customer
  _chk jsonb; _res jsonb;
  _bal numeric; _pts int; _n int; _sale uuid := gen_random_uuid();
BEGIN
  SELECT ur.user_id INTO _admin FROM public.user_roles ur
   WHERE ur.role = 'admin' AND ur.ecosystem_id = _eco LIMIT 1;
  IF _admin IS NULL THEN RAISE EXCEPTION 'FAIL: demo ecosystem has no admin'; END IF;

  SELECT ur.user_id, ur.ecosystem_id INTO _other_admin, _other_eco
    FROM public.user_roles ur
   WHERE ur.role = 'admin' AND ur.ecosystem_id <> _eco LIMIT 1;

  -- Fixtures --------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'qa-restructure-' || u || '@example.invalid', '', now(), now(), now()
    FROM unnest(ARRAY[_r1, _r2, _sub, _lone, _cust]) u;

  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status, is_demo)
  VALUES (_r1, _eco, 'QA Reseller One', 'qa-r1@example.invalid', '0', 'active', true),
         (_r2, _eco, 'QA Reseller Two', 'qa-r2@example.invalid', '0', 'active', true),
         (_lone, _eco, 'QA Lone Reseller', 'qa-lone@example.invalid', '0', 'active', true),
         (_sub, _eco, 'QA Subreseller', 'qa-sub@example.invalid', '0', 'active', true),
         (_cust, _eco, 'QA Customer', 'qa-cust@example.invalid', '0', 'active', true);

  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_r1, 'reseller', _eco), (_r2, 'reseller', _eco), (_lone, 'reseller', _eco),
         (_sub, 'subreseller', _eco), (_cust, 'customer', _eco);
  UPDATE public.profiles SET reseller_id = _r1 WHERE id = _sub;

  INSERT INTO public.credit_accounts (user_id, ecosystem_id, balance)
  VALUES (_sub, _eco, 250), (_lone, _eco, 90);
  INSERT INTO public.points_accounts (user_id, ecosystem_id, balance)
  VALUES (_sub, _eco, 40);

  -- A historical sale attributing upline commission to _r1
  INSERT INTO public.voucher_sales
    (id, ecosystem_id, product_id, product_name, buyer_id, buyer_role, reseller_id,
     list_price, discount_percent, sale_price, payment_method, tx_id,
     commission_recipient_id, commission_percent, commission_amount,
     upline_recipient_id, upline_commission_percent, upline_commission_amount)
  SELECT _sale, _eco, p.id, p.name, _sub, 'subreseller', _sub,
         10, 0, 10, 'credits', 'QA-' || substr(_sale::text, 1, 8),
         _sub, 5, 0.5, _r1, 3, 0.3
    FROM public.voucher_products p WHERE p.ecosystem_id = _eco LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  -- 9. unauthorized callers ------------------------------------------------
  FOR _n IN 1..3 LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', CASE _n WHEN 1 THEN _r2 WHEN 2 THEN _sub ELSE _cust END)::text, true);
    BEGIN
      PERFORM public.restructure_member_role(_lone, 'subreseller', 'unauthorized attempt', _r2);
      RAISE EXCEPTION 'FAIL: unauthorized caller % was allowed', _n;
    EXCEPTION WHEN others THEN
      IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    END;
  END LOOP;

  -- 8. cross-ecosystem admin ----------------------------------------------
  IF _other_admin IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _other_admin)::text, true);
    BEGIN
      PERFORM public.restructure_member_role(_lone, 'subreseller', 'cross ecosystem attempt', _r2);
      RAISE EXCEPTION 'FAIL: cross-ecosystem restructure was allowed';
    EXCEPTION WHEN others THEN
      IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    END;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  -- 12. protected roles ----------------------------------------------------
  BEGIN
    PERFORM public.restructure_member_role(_admin, 'reseller', 'should be blocked');
    RAISE EXCEPTION 'FAIL: admin role was changed';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  -- customers are out of scope
  BEGIN
    PERFORM public.restructure_member_role(_cust, 'reseller', 'should be blocked');
    RAISE EXCEPTION 'FAIL: customer was promoted through restructuring';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  -- 13. reason is mandatory ------------------------------------------------
  BEGIN
    PERFORM public.restructure_member_role(_lone, 'subreseller', '  ', _r2);
    RAISE EXCEPTION 'FAIL: empty reason accepted';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  -- 1. lone reseller demotes ----------------------------------------------
  _chk := public.role_restructure_check(_lone);
  IF _chk->>'current_role' <> 'reseller' OR (_chk->>'child_count')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: check payload wrong for lone reseller: %', _chk;
  END IF;
  -- a parent is required
  BEGIN
    PERFORM public.restructure_member_role(_lone, 'subreseller', 'missing parent test');
    RAISE EXCEPTION 'FAIL: demotion without a parent was allowed';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  _res := public.restructure_member_role(_lone, 'subreseller', 'Network realignment', _r2);
  IF _res->>'new_role' <> 'subreseller' THEN RAISE EXCEPTION 'FAIL: demotion result wrong'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _lone AND role = 'subreseller')
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _lone AND role = 'reseller')
  THEN RAISE EXCEPTION 'FAIL: role rows not swapped on demotion'; END IF;
  IF (SELECT reseller_id FROM public.profiles WHERE id = _lone) <> _r2 THEN
    RAISE EXCEPTION 'FAIL: demoted reseller has no parent';
  END IF;
  -- 7. wallet untouched
  SELECT balance INTO _bal FROM public.credit_accounts WHERE user_id = _lone;
  IF _bal <> 90 THEN RAISE EXCEPTION 'FAIL: wallet changed on demotion (%)', _bal; END IF;
  -- 10. no duplicate account or role rows
  SELECT count(*) INTO _n FROM public.profiles WHERE id = _lone;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate profile created'; END IF;
  SELECT count(*) INTO _n FROM public.user_roles WHERE user_id = _lone;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate role rows (%)', _n; END IF;
  IF (SELECT ecosystem_id FROM public.profiles WHERE id = _lone) <> _eco THEN
    RAISE EXCEPTION 'FAIL: ecosystem membership changed';
  END IF;

  -- 2. reseller with children is blocked ----------------------------------
  _chk := public.role_restructure_check(_r1);
  IF (_chk->>'child_count')::int <> 1 THEN RAISE EXCEPTION 'FAIL: child count wrong: %', _chk; END IF;
  BEGIN
    PERFORM public.restructure_member_role(_r1, 'subreseller', 'Demote with orphans', _r2);
    RAISE EXCEPTION 'FAIL: demotion with children was allowed';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  IF (SELECT reseller_id FROM public.profiles WHERE id = _sub) <> _r1 THEN
    RAISE EXCEPTION 'FAIL: blocked demotion still touched the child';
  END IF;
  -- the child may not be parked under the demoted reseller either
  BEGIN
    PERFORM public.restructure_member_role(_r1, 'subreseller', 'Bad reassignment', _r2,
      jsonb_build_array(jsonb_build_object('child_id', _sub, 'new_parent_id', _r1)));
    RAISE EXCEPTION 'FAIL: self-reassignment was allowed';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  -- 3. reassignment preserves children ------------------------------------
  _res := public.restructure_member_role(_r1, 'subreseller', 'Reseller stepped down', _r2,
    jsonb_build_array(jsonb_build_object('child_id', _sub, 'new_parent_id', _r2)));
  IF jsonb_array_length(_res->'reassigned_children') <> 1 THEN
    RAISE EXCEPTION 'FAIL: reassignment not recorded';
  END IF;
  IF (SELECT reseller_id FROM public.profiles WHERE id = _sub) <> _r2 THEN
    RAISE EXCEPTION 'FAIL: child was not reassigned';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _sub AND role = 'subreseller') THEN
    RAISE EXCEPTION 'FAIL: child lost its role';
  END IF;
  SELECT balance INTO _bal FROM public.credit_accounts WHERE user_id = _sub;
  SELECT balance INTO _pts FROM public.points_accounts WHERE user_id = _sub;
  IF _bal <> 250 OR _pts <> 40 THEN RAISE EXCEPTION 'FAIL: child wallet/points changed'; END IF;

  -- 6. historical attribution unchanged ------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.voucher_sales
     WHERE id = _sale AND upline_recipient_id = _r1 AND upline_commission_percent = 3
       AND upline_commission_amount = 0.3 AND commission_recipient_id = _sub)
  THEN RAISE EXCEPTION 'FAIL: historical commission attribution was rewritten'; END IF;

  -- 4/5. subreseller promotes and loses its parent -------------------------
  _res := public.restructure_member_role(_sub, 'reseller', 'Promoted to full reseller');
  IF _res->>'new_role' <> 'reseller' THEN RAISE EXCEPTION 'FAIL: promotion result wrong'; END IF;
  IF (SELECT reseller_id FROM public.profiles WHERE id = _sub) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: promoted reseller still has a parent';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _sub AND role = 'subreseller') THEN
    RAISE EXCEPTION 'FAIL: subreseller role not removed';
  END IF;
  SELECT count(*) INTO _n FROM public.user_roles WHERE user_id = _sub;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate role rows after promotion (%)', _n; END IF;
  SELECT balance INTO _bal FROM public.credit_accounts WHERE user_id = _sub;
  SELECT balance INTO _pts FROM public.points_accounts WHERE user_id = _sub;
  IF _bal <> 250 OR _pts <> 40 THEN RAISE EXCEPTION 'FAIL: wallet/points changed on promotion'; END IF;
  IF EXISTS (SELECT 1 FROM public.voucher_sales WHERE id = _sale AND upline_recipient_id IS DISTINCT FROM _r1) THEN
    RAISE EXCEPTION 'FAIL: promotion rewrote historical attribution';
  END IF;

  -- same role twice is refused
  BEGIN
    PERFORM public.restructure_member_role(_sub, 'reseller', 'already a reseller');
    RAISE EXCEPTION 'FAIL: no-op role change was allowed';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  -- 11. audit entries -------------------------------------------------------
  SELECT count(*) INTO _n FROM public.audit_logs
   WHERE ecosystem_id = _eco
     AND action IN ('Restructured reseller to subreseller','Restructured subreseller to reseller')
     AND metadata->>'reason' IS NOT NULL
     AND (metadata->>'user_id')::uuid IN (_lone, _r1, _sub);
  IF _n <> 3 THEN RAISE EXCEPTION 'FAIL: expected 3 audit entries, got %', _n; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE (metadata->>'user_id')::uuid = _r1
       AND metadata->>'previous_role' = 'reseller' AND metadata->>'new_role' = 'subreseller'
       AND (metadata->>'new_parent_id')::uuid = _r2
       AND jsonb_array_length(metadata->'reassigned_children') = 1)
  THEN RAISE EXCEPTION 'FAIL: audit metadata incomplete'; END IF;

  RAISE NOTICE 'ALL ROLE RESTRUCTURE TESTS PASSED';
END $$;

ROLLBACK;
