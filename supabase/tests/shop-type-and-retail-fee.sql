-- Shop type management + Retail platform fee source of truth. Rollback-only:
-- the DO block ends with RAISE EXCEPTION so nothing persists.
-- Success = final error text "SHOP_TYPE_TESTS_PASSED". Fixtures are live ids.

DO $$
DECLARE
  _u    uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- Sagada Wave (Universe voucher shop)
  _adm  uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- its shop admin
  _cus  uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- ordinary member of _u
  _s    uuid := '1ba85735-e5df-4fbe-bf5f-71dff985e824'; -- SW DEMO (New Generation)
  _cus2 uuid := '617ef79a-e3d6-4a6f-9dcc-b09414a35336'; -- NG member
  c_adm text; c_cus text; c_cus2 text;
  _v public.ecosystems; _r public.ecosystems; _r2 public.ecosystems; _t text; _n int; _ok boolean;
  _snap0 jsonb; _snap1 jsonb; _p uuid; _fee0 numeric; _o record; _ord public.retail_orders;
BEGIN
  c_adm  := json_build_object('sub', _adm,  'role', 'authenticated')::text;
  c_cus  := json_build_object('sub', _cus,  'role', 'authenticated')::text;
  c_cus2 := json_build_object('sub', _cus2, 'role', 'authenticated')::text;

  -- ===== A. Platform fee source of truth =====
  ASSERT (SELECT retail_platform_fee_percent FROM public.platform_settings WHERE id = 1) = 1, 'A1 live retail fee is 1';
  ASSERT public.retail_platform_fee_percent() = 1, 'A1 fee function returns 1';
  ASSERT (SELECT column_default FROM information_schema.columns WHERE table_name='platform_settings' AND column_name='retail_platform_fee_percent') = '1', 'A1 column default is 1';
  ASSERT (SELECT voucher_platform_fee_percent FROM public.platform_settings WHERE id = 1) = 1, 'A1 voucher fee unchanged at 1';
  -- Locked example: seller cut 100 -> customer 101 through the customer-facing listing.
  PERFORM set_config('request.jwt.claims', c_adm, true);
  UPDATE public.ecosystems SET store_voucher_enabled = false, store_retail_enabled = true WHERE id = _u;
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, public_visible)
  VALUES (_u, 'FEE TEST 100', 100, 0, 0, 5, true, true, true) RETURNING id INTO _p;
  ASSERT (SELECT price FROM public.list_retail_products(_u) WHERE id = _p) = 101, 'A2 seller cut 100 -> retail 101 at 1 %';
  -- Historical snapshots: an order placed now snapshots 1 %; a later fee change never alters it.
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _p, 'quantity', 1)), 'pickup', 'cash');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.platform_fee_percent = 1 AND _ord.platform_fee_amount = 1, 'A3 order snapshots 1 % / 1.00';
  UPDATE public.platform_settings SET retail_platform_fee_percent = 2 WHERE id = 1;
  ASSERT (SELECT platform_fee_percent FROM public.retail_orders WHERE id = _o.order_id) = 1, 'A4 historical order untouched by fee change';
  ASSERT (SELECT price FROM public.list_retail_products(_u) WHERE id = _p) = 102, 'A4 new listing follows the configured fee (admin-configurable)';
  UPDATE public.platform_settings SET retail_platform_fee_percent = 1 WHERE id = 1;
  -- Non-owner cannot change money settings.
  BEGIN
    PERFORM public.set_platform_money_settings(0, 0, 1, 1, 1, null, null, 5, null);
    RAISE EXCEPTION 'A5 should not reach';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%platform owner%', 'A5 only owner: ' || SQLERRM;
  END;
  -- Restore the fixture shop before B.
  UPDATE public.ecosystems SET store_voucher_enabled = true, store_retail_enabled = false WHERE id = _u;

  -- ===== B. Shop type derivation on existing shops (unchanged) =====
  ASSERT public.shop_type(_u) = 'universe_voucher', 'B1 Sagada Wave is Universe voucher';
  ASSERT public.shop_type(_s) = 'new_generation', 'B1 SW DEMO is New Generation';
  ASSERT (SELECT count(*) FROM public.ecosystems WHERE public.shop_type(id) IN ('universe_mixed','universe_unset')) = 0, 'B1 no shop needs reclassification';
  SELECT to_jsonb(e) - 'updated_at' INTO _snap0 FROM public.ecosystems e WHERE id = _s;

  -- ===== C. Multiple shops per member, explicit type =====
  PERFORM set_config('request.jwt.claims', c_cus, true);
  SELECT * INTO _v FROM public.create_universe_shop('Type Test Vouchers', 'universe_voucher', null);
  SELECT * INTO _r FROM public.create_universe_shop('Type Test Retail', 'universe_retail', 'goods');
  SELECT * INTO _r2 FROM public.create_universe_shop('Type Test Retail', 'universe_retail', null);
  ASSERT _v.shop_kind = 'universe' AND _v.store_voucher_enabled AND NOT _v.store_retail_enabled, 'C1 voucher shop flags';
  ASSERT _r.shop_kind = 'universe' AND _r.store_retail_enabled AND NOT _r.store_voucher_enabled, 'C1 retail shop flags';
  ASSERT _r2.slug <> _r.slug, 'C1 second same-type shop gets its own slug (no one-shop limit)';
  ASSERT public.shop_type(_v.id) = 'universe_voucher' AND public.shop_type(_r.id) = 'universe_retail', 'C2 derived types';
  ASSERT (SELECT count(*) FROM public.ecosystem_memberships WHERE user_id = _cus AND role = 'admin' AND ecosystem_id IN (_v.id, _r.id, _r2.id)) = 3, 'C3 member admins all three';
  ASSERT public.is_ecosystem_admin(_cus, _r.id), 'C3 admin helper agrees';
  ASSERT (SELECT count(*) FROM public.retail_products WHERE ecosystem_id = _r.id) > 0, 'C4 retail shop seeded with starter drafts';
  ASSERT (SELECT count(*) FROM public.retail_products WHERE ecosystem_id = _v.id) = 0, 'C4 voucher shop has no retail products';
  ASSERT (SELECT count(*) FROM public.retail_products WHERE ecosystem_id = _r.id AND published) = 0, 'C4 seeded products are unpublished';
  ASSERT public.is_universe_shop(_r.id) AND public.is_universe_shop(_v.id), 'C5 both are Universe shops (global wallet)';
  ASSERT (SELECT count(*) FROM public.credit_accounts WHERE user_id = _cus AND ecosystem_id IN (_v.id,_r.id,_r2.id)) = 0, 'C5 no shop-scoped wallets created for Universe shops';
  BEGIN
    PERFORM public.create_universe_shop('Bad', 'new_generation', null);
    RAISE EXCEPTION 'C6 should not reach';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%Universe Voucher or Universe Retail%', 'C6 NG not creatable via universe path: ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.create_universe_shop('Anon', 'universe_voucher', null);
    RAISE EXCEPTION 'C7 should not reach';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%Sign in%', 'C7 anonymous blocked: ' || SQLERRM;
  END;

  -- ===== D. Type isolation: routing behaviour =====
  -- Voucher shop: customer-facing retail listing empty / retail order refused.
  PERFORM set_config('request.jwt.claims', c_cus, true);
  ASSERT NOT (SELECT retail_enabled FROM public.shop_store_settings(_v.id)), 'D1 voucher shop exposes no retail store';
  ASSERT (SELECT voucher_enabled FROM public.shop_store_settings(_v.id)), 'D1 voucher shop exposes voucher store';
  ASSERT NOT (SELECT voucher_enabled FROM public.shop_store_settings(_r.id)), 'D1 retail shop exposes no voucher store';
  ASSERT (SELECT retail_enabled FROM public.shop_store_settings(_r.id)), 'D1 retail shop exposes retail store';
  ASSERT NOT (SELECT cod_enabled FROM public.shop_store_settings(_s)), 'D2 NG never exposes COD';
  -- Cross-type via update_store_settings is refused for Universe shops.
  BEGIN
    PERFORM public.update_store_settings(_v.id, true, true, true, true, true, true, true);
    RAISE EXCEPTION 'D3 should not reach';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%either a Voucher shop or a Retail shop%', 'D3 both stores refused: ' || SQLERRM;
  END;
  ASSERT public.shop_type(_v.id) = 'universe_voucher', 'D3 type unchanged after refusal';

  -- ===== E. set_shop_type =====
  SELECT public.set_shop_type(_v.id, 'universe_retail') INTO _t;
  ASSERT _t = 'universe_retail' AND public.shop_type(_v.id) = 'universe_retail', 'E1 voucher -> retail';
  ASSERT (SELECT count(*) FROM public.retail_products WHERE ecosystem_id = _v.id) > 0, 'E1 catalog seeded on first switch';
  ASSERT (SELECT count(*) FROM public.audit_logs WHERE ecosystem_id = _v.id AND action = 'Changed shop type') = 1, 'E1 audited';
  SELECT public.set_shop_type(_v.id, 'universe_voucher') INTO _t;
  ASSERT public.shop_type(_v.id) = 'universe_voucher', 'E2 retail -> voucher (no open orders)';
  ASSERT (SELECT count(*) FROM public.retail_products WHERE ecosystem_id = _v.id) > 0, 'E2 retail products kept, only hidden';
  -- Idempotent same-type call.
  ASSERT public.set_shop_type(_v.id, 'universe_voucher') = 'universe_voucher', 'E3 idempotent';
  -- Retail shop with an open order cannot switch away.
  UPDATE public.retail_products SET published = true, price = 10, stock = 5 WHERE ecosystem_id = _r.id AND id = (SELECT id FROM public.retail_products WHERE ecosystem_id = _r.id LIMIT 1) RETURNING id INTO _p;
  PERFORM set_config('request.jwt.claims', c_adm, true);  -- _adm is not a member of _r
  BEGIN
    PERFORM public.set_shop_type(_r.id, 'universe_voucher');
    RAISE EXCEPTION 'E4 should not reach';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%Not authorized%', 'E4 outsider admin cannot change another shop''s type: ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', c_cus, true);
  -- The owner switches the member into the new retail shop to place an order? Not needed:
  -- place an open order as the shop's own admin-member is blocked by RLS on self-purchase rules,
  -- so insert a pending order row directly (fixture) and check the guard.
  INSERT INTO public.retail_orders (order_no, ecosystem_id, customer_id, customer_name, status, fulfillment_status, payment_method, fulfillment, total, seller_total, platform_fee_percent, platform_fee_amount)
  VALUES ('TYPE-TEST-1', _r.id, _cus2, 'Fixture', 'pending', 'awaiting', 'cash', 'pickup', 10, 10, 1, 0.10);
  BEGIN
    PERFORM public.set_shop_type(_r.id, 'universe_voucher');
    RAISE EXCEPTION 'E5 should not reach';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%open retail order%', 'E5 open orders block switching away from Retail: ' || SQLERRM;
  END;
  -- New Generation never converts.
  PERFORM set_config('request.jwt.claims', c_cus2, true);
  BEGIN
    PERFORM public.set_shop_type(_s, 'universe_retail');
    RAISE EXCEPTION 'E6 should not reach';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%Not authorized%' OR SQLERRM LIKE '%New Generation%', 'E6 NG blocked: ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.set_shop_type(_s, 'universe_retail');
    RAISE EXCEPTION 'E6b should not reach';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  -- Super Admin path: NG stays NG even for the platform owner.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM public.user_roles WHERE role = 'super_admin' LIMIT 1), 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.set_shop_type(_s, 'universe_retail');
    RAISE EXCEPTION 'E7 should not reach';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%New Generation%', 'E7 NG isolation is absolute: ' || SQLERRM;
  END;
  -- Super Admin creation with explicit type; catalog only for retail.
  SELECT * INTO _r2 FROM public.create_ecosystem('SA Voucher', null, null, null, null, 'Starter', 0, 5, true, 'universe_voucher');
  ASSERT public.shop_type(_r2.id) = 'universe_voucher' AND (SELECT count(*) FROM public.retail_products WHERE ecosystem_id = _r2.id) = 0, 'E8 SA voucher shop, no catalog';
  SELECT * INTO _r2 FROM public.create_ecosystem('SA NG', null, null, null, null, 'Starter', 0, 5, true);
  ASSERT public.shop_type(_r2.id) = 'new_generation' AND _r2.shop_code IS NOT NULL, 'E8 SA default is New Generation with Shop ID';

  -- ===== F. Existing shop unchanged; RLS least privilege =====
  SELECT to_jsonb(e) - 'updated_at' INTO _snap1 FROM public.ecosystems e WHERE id = _s;
  ASSERT _snap0 = _snap1, 'F1 New Generation shop row untouched';
  PERFORM set_config('request.jwt.claims', c_cus2, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) FROM public.shop_seller_authorizations WHERE ecosystem_id IN (_v.id, _r.id)) = 0, 'F2 outsider reads no seller authorizations of new shops';
  ASSERT (SELECT count(*) FROM public.ecosystems WHERE id IN (_v.id, _r.id)) = 0, 'F2 outsider cannot read another member''s new shops';
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'SHOP_TYPE_TESTS_PASSED';
END $$;
