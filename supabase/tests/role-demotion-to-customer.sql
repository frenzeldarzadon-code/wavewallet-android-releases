-- Role demotion to Customer (Reseller -> Customer, Subreseller -> Customer).
--
-- Everything runs inside one PL/pgSQL sub-block that is ALWAYS aborted, so every
-- fixture change is discarded. Only the demo-preview ecosystem is touched.
--
--   \i supabase/tests/role-demotion-to-customer.sql
--
-- Expectations:
--   1. a reseller with no children demotes to customer (no parent required)
--   2. a subreseller demotes to customer and keeps its reseller as owner
--   3. the same account/login survives: exactly one profile, one role row
--   4. wallet credits and points are unchanged, never negative, never duplicated
--   5. reseller privileges are stripped (discount + commission rates cleared)
--   6. the demoted user can buy vouchers as a customer right after the change
--   7. reseller-only actions are refused after demotion
--   8. a reseller that still owns subresellers is blocked until they are moved
--   9. historical sales, points and attribution are untouched
--  10. admins / super admins cannot be demoted here, customers are out of scope
--  11. unauthorized and cross-ecosystem callers are refused
--  12. an audit entry records previous role, new role, actor and reason

DO $$
DECLARE
  _eco uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205';  -- demo ecosystem
  _admin uuid; _other_admin uuid;
  _r1 uuid := 'cc8f0269-ad9b-422a-b67f-3e8ce6c1786d';   -- demo reseller (owns one subreseller)
  _sub uuid := '4e13ccab-f4cf-43ea-be98-d393240d912b';  -- demo subreseller under _r1
  _r2 uuid := 'b729ccda-9fcc-443f-810b-6ac981091225';   -- demo customer, promoted below
  _chk jsonb; _res jsonb;
  _bal numeric; _pts int; _r2_bal numeric; _r2_pts int; _sub_bal numeric; _sub_pts int;
  _n int; _prod uuid; _sale uuid := gen_random_uuid();
BEGIN
 BEGIN
  SELECT ur.user_id INTO _admin FROM public.user_roles ur
   WHERE ur.role = 'admin' AND ur.ecosystem_id = _eco LIMIT 1;
  IF _admin IS NULL THEN RAISE EXCEPTION 'FAIL: demo ecosystem has no admin'; END IF;

  SELECT ur.user_id INTO _other_admin FROM public.user_roles ur
   WHERE ur.role = 'admin' AND ur.ecosystem_id <> _eco LIMIT 1;

  SELECT balance INTO _r2_bal FROM public.credit_accounts WHERE user_id = _r2;
  SELECT balance INTO _r2_pts FROM public.points_accounts WHERE user_id = _r2;
  SELECT balance INTO _sub_bal FROM public.credit_accounts WHERE user_id = _sub;
  SELECT balance INTO _sub_pts FROM public.points_accounts WHERE user_id = _sub;

  SELECT p.id INTO _prod FROM public.voucher_products p
   WHERE p.ecosystem_id = _eco AND p.active AND NOT p.archived LIMIT 1;

  -- Historical sale attributed to the subreseller (must survive the demotion)
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

  -- 10. protected roles ------------------------------------------------------
  BEGIN
    PERFORM public.restructure_member_role(_admin, 'customer', 'admin must be protected');
    RAISE EXCEPTION 'FAIL: an admin was demoted to customer';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM public.restructure_member_role(_r2, 'customer', 'customer is out of scope');
    RAISE EXCEPTION 'FAIL: a plain customer was accepted by restructuring';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  -- Fixture: promote the demo customer to reseller through the normal path
  PERFORM public.promote_to_reseller(_r2, 10);

  -- 11. unauthorized callers --------------------------------------------------
  FOR _n IN 1..3 LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', CASE _n WHEN 1 THEN _r2 WHEN 2 THEN _sub ELSE _r1 END)::text, true);
    BEGIN
      PERFORM public.restructure_member_role(_sub, 'customer', 'unauthorized attempt');
      RAISE EXCEPTION 'FAIL: unauthorized caller % demoted a member', _n;
    EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  END LOOP;

  IF _other_admin IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _other_admin)::text, true);
    BEGIN
      PERFORM public.restructure_member_role(_sub, 'customer', 'cross ecosystem attempt');
      RAISE EXCEPTION 'FAIL: cross-ecosystem demotion was allowed';
    EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  -- reason is still mandatory
  BEGIN
    PERFORM public.restructure_member_role(_r2, 'customer', '   ');
    RAISE EXCEPTION 'FAIL: empty reason accepted for demotion';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  -- 8. a reseller that still owns subresellers is blocked ----------------------
  _chk := public.role_restructure_check(_r1);
  IF (_chk->>'child_count')::int <> 1 THEN RAISE EXCEPTION 'FAIL: child count wrong: %', _chk; END IF;
  IF NOT (_chk->'available_roles' ? 'customer') THEN
    RAISE EXCEPTION 'FAIL: customer is not offered as a target role: %', _chk;
  END IF;
  BEGIN
    PERFORM public.restructure_member_role(_r1, 'customer', 'Demote with orphans');
    RAISE EXCEPTION 'FAIL: reseller with children was demoted to customer';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  IF (SELECT reseller_id FROM public.profiles WHERE id = _sub) <> _r1 THEN
    RAISE EXCEPTION 'FAIL: blocked demotion still touched the child';
  END IF;

  -- 1. reseller with no children -> customer ------------------------------------
  _res := public.restructure_member_role(_r2, 'customer', 'Stopped operating as a reseller');
  IF _res->>'new_role' <> 'customer' OR _res->>'previous_role' <> 'reseller' THEN
    RAISE EXCEPTION 'FAIL: demotion result wrong: %', _res;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _r2 AND role = 'customer')
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _r2
                 AND role IN ('reseller','subreseller')) THEN
    RAISE EXCEPTION 'FAIL: role rows not swapped on demotion to customer';
  END IF;
  -- 3. same account, no duplicates
  SELECT count(*) INTO _n FROM public.profiles WHERE id = _r2;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate profile created'; END IF;
  SELECT count(*) INTO _n FROM public.user_roles WHERE user_id = _r2;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate role rows (%)', _n; END IF;
  IF (SELECT ecosystem_id FROM public.profiles WHERE id = _r2) <> _eco THEN
    RAISE EXCEPTION 'FAIL: ecosystem membership changed';
  END IF;
  -- 4. balances untouched and non-negative, wallets not duplicated
  SELECT balance INTO _bal FROM public.credit_accounts WHERE user_id = _r2;
  SELECT balance INTO _pts FROM public.points_accounts WHERE user_id = _r2;
  IF _bal <> _r2_bal OR _pts <> _r2_pts THEN
    RAISE EXCEPTION 'FAIL: balances changed on demotion (% / %)', _bal, _pts;
  END IF;
  IF _bal < 0 OR _pts < 0 THEN RAISE EXCEPTION 'FAIL: negative balance after demotion'; END IF;
  SELECT count(*) INTO _n FROM public.credit_accounts WHERE user_id = _r2;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate credit wallet'; END IF;
  SELECT count(*) INTO _n FROM public.points_accounts WHERE user_id = _r2;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate points wallet'; END IF;
  -- 5. selling privileges removed, no upline for an ex-reseller
  IF (SELECT reseller_discount_percent FROM public.profiles WHERE id = _r2) <> 0
     OR coalesce((SELECT reseller_commission_percent FROM public.profiles WHERE id = _r2), 0) <> 0
     OR (SELECT sale_commission_percent FROM public.profiles WHERE id = _r2) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: reseller privileges survived the demotion';
  END IF;
  IF (SELECT reseller_id FROM public.profiles WHERE id = _r2) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: demoted reseller kept an upline';
  END IF;
  -- no-op repeat is refused
  BEGIN
    PERFORM public.restructure_member_role(_r2, 'customer', 'already a customer');
    RAISE EXCEPTION 'FAIL: demoting a customer again was allowed';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  -- 6/7. the demoted account behaves as a customer -------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _r2)::text, true);
  IF _prod IS NOT NULL THEN
    -- can see the shop and buy as a customer (needs credits, so top up as admin first)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    PERFORM public.admin_adjust_credits(_r2, 1000, 'QA top-up for demotion test');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _r2)::text, true);
    SELECT count(*) INTO _n FROM public.list_shop_products();
    IF _n = 0 THEN RAISE EXCEPTION 'FAIL: demoted customer cannot see the voucher shop'; END IF;
    BEGIN
      PERFORM public.purchase_voucher(_prod, 1);
    EXCEPTION WHEN others THEN
      IF SQLERRM LIKE '%stock%' OR SQLERRM LIKE '%available%' OR SQLERRM LIKE '%code%' THEN
        RAISE NOTICE 'purchase skipped (no voucher stock): %', SQLERRM;
      ELSE
        RAISE EXCEPTION 'FAIL: demoted customer could not buy a voucher: %', SQLERRM;
      END IF;
    END;
  END IF;
  -- reseller-only action must now be refused
  BEGIN
    PERFORM public.transfer_credits(_sub, 1, 'should be refused');
    RAISE EXCEPTION 'FAIL: demoted customer still performed a reseller-only credit load';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  -- 2. subreseller -> customer keeps its reseller as owner -------------------------
  _res := public.restructure_member_role(_sub, 'customer', 'Subreseller stepped down');
  IF _res->>'previous_role' <> 'subreseller' OR _res->>'new_role' <> 'customer' THEN
    RAISE EXCEPTION 'FAIL: subreseller demotion result wrong: %', _res;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _sub AND role = 'customer') THEN
    RAISE EXCEPTION 'FAIL: subreseller did not become a customer';
  END IF;
  SELECT count(*) INTO _n FROM public.user_roles WHERE user_id = _sub;
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate role rows for demoted subreseller (%)', _n; END IF;
  IF (SELECT reseller_id FROM public.profiles WHERE id = _sub) <> _r1 THEN
    RAISE EXCEPTION 'FAIL: demoted subreseller lost its owning reseller';
  END IF;
  SELECT balance INTO _bal FROM public.credit_accounts WHERE user_id = _sub;
  SELECT balance INTO _pts FROM public.points_accounts WHERE user_id = _sub;
  IF _bal <> _sub_bal OR _pts <> _sub_pts THEN
    RAISE EXCEPTION 'FAIL: subreseller balances changed (% / %)', _bal, _pts;
  END IF;

  -- 9. historical attribution untouched ---------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.voucher_sales
     WHERE id = _sale AND commission_recipient_id = _sub AND upline_recipient_id = _r1
       AND upline_commission_amount = 0.3)
  THEN RAISE EXCEPTION 'FAIL: historical sale attribution was rewritten'; END IF;

  -- 12. audit entries -----------------------------------------------------------------
  SELECT count(*) INTO _n FROM public.audit_logs
   WHERE ecosystem_id = _eco
     AND action IN ('Restructured reseller to customer','Restructured subreseller to customer')
     AND (metadata->>'user_id')::uuid IN (_r2, _sub)
     AND metadata->>'reason' IS NOT NULL;
  IF _n <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 demotion audit entries, got %', _n; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE (metadata->>'user_id')::uuid = _r2
       AND metadata->>'previous_role' = 'reseller'
       AND metadata->>'new_role' = 'customer'
       AND metadata->>'reason' = 'Stopped operating as a reseller'
       AND actor_id = _admin AND created_at IS NOT NULL)
  THEN RAISE EXCEPTION 'FAIL: demotion audit metadata incomplete'; END IF;

  RAISE EXCEPTION 'ROLE_DEMOTION_TESTS_OK';
 EXCEPTION WHEN others THEN
   IF SQLERRM = 'ROLE_DEMOTION_TESTS_OK' THEN
     RAISE NOTICE 'ALL ROLE DEMOTION TESTS PASSED (all fixture changes rolled back)';
   ELSE
     RAISE;
   END IF;
 END;
END $$;
