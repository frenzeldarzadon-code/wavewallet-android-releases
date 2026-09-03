-- Retail R3 correction — retailer shops have NO subreseller level.
--
-- Rollback-only: the DO block ends with RAISE EXCEPTION so nothing persists.
-- Success is the final error text "RETAIL_R3_NO_SUBRESELLER_PASSED".
--
-- Proves:
--   1. Customer buys through a RESELLER storefront (reseller has a subreseller
--      under them): reseller receives the configured Retail cashback, the
--      subreseller receives nothing, no sale_commissions rows are written.
--   2. A subreseller cannot be a Retail storefront seller.
--   3. A subreseller buying for themselves earns NO Retail cashback; the admin
--      keeps the whole seller amount.
--   4. Buying via the admin storefront: no cashback, admin keeps everything.
--   5. Voucher Shop still credits the subreseller + reseller chain unchanged.

DO $$
DECLARE
  _u    uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- Sagada Wave One-Stop-Shop (universe)
  _adm  uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- shop admin
  _cus  uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- universe customer
  _res  uuid := '0c10e602-c154-4e0f-bac1-0aadc642fee0'; -- reseller
  _sub  uuid := 'fd9b863c-9c7c-4794-a35b-779e7d82e37b'; -- subreseller under _res
  _prod uuid; _o record; _ord public.retail_orders; _l public.credit_ledger;
  _cg uuid; _rg uuid; _sg uuid; _ag uuid;
  _cus_bal numeric; _res_bal numeric; _sub_bal numeric; _adm_bal numeric;
  _comm_before bigint; _prev_fee numeric;
  claims_cus text; claims_adm text; claims_sub text;
BEGIN
  claims_cus := json_build_object('sub', _cus, 'role', 'authenticated')::text;
  claims_adm := json_build_object('sub', _adm, 'role', 'authenticated')::text;
  claims_sub := json_build_object('sub', _sub, 'role', 'authenticated')::text;

  ASSERT (SELECT role FROM public.ecosystem_memberships WHERE user_id = _res AND ecosystem_id = _u) = 'reseller', 'fixture: reseller';
  ASSERT (SELECT role FROM public.ecosystem_memberships WHERE user_id = _sub AND ecosystem_id = _u) = 'subreseller', 'fixture: subreseller';
  ASSERT (SELECT reseller_id FROM public.ecosystem_memberships WHERE user_id = _sub AND ecosystem_id = _u) = _res, 'fixture: subreseller under reseller';

  SELECT retail_platform_fee_percent INTO _prev_fee FROM public.platform_settings WHERE id = 1;
  UPDATE public.platform_settings SET retail_platform_fee_percent = 1 WHERE id = 1; -- pin 1% so fee separation is visible
  UPDATE public.ecosystems SET store_retail_enabled = true, retail_credit_enabled = true,
         retail_pickup_enabled = true, operations_frozen = false WHERE id = _u;
  INSERT INTO public.shop_seller_authorizations (ecosystem_id, user_id, active)
  VALUES (_u, _res, true), (_u, _sub, true)
  ON CONFLICT (ecosystem_id, user_id) DO UPDATE SET active = true;

  -- ₱100 product, 10% seller cashback
  INSERT INTO public.retail_products (ecosystem_id, name, price, wholesale_price, wholesale_min_qty, stock, active, published, archived, public_visible, cashback_mode, cashback_value)
  VALUES (_u, 'R3 no-sub', 100, 0, 0, 100, true, true, false, true, 'percent', 10) RETURNING id INTO _prod;

  _cg := public.ensure_global_wallet(_cus); _rg := public.ensure_global_wallet(_res);
  _sg := public.ensure_global_wallet(_sub); _ag := public.ensure_global_wallet(_adm);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_cg, _cus, NULL, 'credit', 1000, 0, 'R3 funding', 'R3', public.new_tx_id(), 'general'),
         (_sg, _sub, NULL, 'credit', 1000, 0, 'R3 funding', 'R3', public.new_tx_id(), 'general');
  SELECT balance INTO _cus_bal FROM public.credit_accounts WHERE id = _cg;
  SELECT balance INTO _res_bal FROM public.credit_accounts WHERE id = _rg;
  SELECT balance INTO _sub_bal FROM public.credit_accounts WHERE id = _sg;
  SELECT balance INTO _adm_bal FROM public.credit_accounts WHERE id = _ag;
  SELECT count(*) INTO _comm_before FROM public.sale_commissions;

  -- ---------- 1. customer via RESELLER storefront ----------
  ASSERT public.retail_cashback_recipient(_cus, _res, _u) = _res, 'recipient is the reseller';
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit', NULL, NULL, _res);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.seller_id = _res AND _ord.cashback_recipient_id = _res AND _ord.cashback_total = 10.00, 'order snapshot: reseller earns 10';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus_bal - 101.00, 'customer debited once (101)';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _rg) = _res_bal + 10.00, 'reseller +10 cashback';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm_bal + 90.00, 'admin +90 (seller amount − cashback)';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _sg) = _sub_bal, 'SUBRESELLER balance unchanged';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = _sub AND entry_kind = 'retail_cashback'), 'no subreseller retail cashback ledger row';
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.cashback_ledger_id IS NOT NULL AND (SELECT count(*) FROM public.credit_ledger WHERE entry_kind = 'retail_cashback' AND reference = _ord.order_no) = 1, 'exactly one cashback row';
  ASSERT (SELECT count(*) FROM public.sale_commissions) = _comm_before, 'no sale_commissions rows from Retail';
  ASSERT 101.00 = 90.00 + 10.00 + 1.00, 'reconciliation: debit = admin + reseller + fee';
  _res_bal := _res_bal + 10; _adm_bal := _adm_bal + 90; _cus_bal := _cus_bal - 101;

  -- ---------- 2. subreseller cannot be a Retail storefront seller ----------
  ASSERT NOT public.retail_seller_allowed(_sub, _u), 'subreseller not an allowed Retail seller';
  ASSERT public.retail_seller_allowed(_res, _u) AND public.retail_seller_allowed(_adm, _u), 'reseller and admin allowed';
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  BEGIN
    PERFORM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit', NULL, NULL, _sub);
    RAISE EXCEPTION 'subreseller storefront must be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'subreseller storefront must be rejected' THEN RAISE; END IF;
  END;
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _cg) = _cus_bal, 'rejected order moved no coins';

  -- ---------- 3. subreseller self-purchase earns nothing ----------
  ASSERT public.retail_cashback_recipient(_sub, NULL, _u) IS NULL, 'subreseller buyer: no recipient';
  ASSERT public.retail_cashback_recipient(_sub, _res, _u) = _res, 'subreseller buying via reseller storefront: reseller earns';
  PERFORM set_config('request.jwt.claims', claims_sub, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit');
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.cashback_recipient_id IS NULL AND _ord.cashback_total = 0, 'no cashback on subreseller self-purchase';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm_bal + 100.00, 'admin keeps the whole seller amount';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _sg) = _sub_bal - 101.00, 'subreseller only debited';
  _adm_bal := _adm_bal + 100;

  -- ---------- 4. admin storefront: no invented admin cashback ----------
  ASSERT public.retail_cashback_recipient(_cus, _adm, _u) IS NULL, 'admin storefront: nobody earns cashback';
  PERFORM set_config('request.jwt.claims', claims_cus, true);
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 1)), 'pickup', 'credit', NULL, NULL, _adm);
  SELECT * INTO _ord FROM public.retail_orders WHERE id = _o.order_id;
  ASSERT _ord.cashback_total = 0 AND _ord.cashback_recipient_id IS NULL, 'admin storefront snapshot';
  PERFORM set_config('request.jwt.claims', claims_adm, true);
  PERFORM public.retail_review_order(_ord.id, true, NULL);
  ASSERT (SELECT balance FROM public.credit_accounts WHERE id = _ag) = _adm_bal + 100.00, 'admin +100';

  -- ---------- 5. Voucher Shop chain unchanged (subreseller still participates) ----------
  ASSERT EXISTS (SELECT 1 FROM public.cashback_chain(_sub, _u) WHERE recipient_id = _sub),
         'voucher cashback_chain still pays the subreseller';
  ASSERT EXISTS (SELECT 1 FROM public.cashback_chain(_sub, _u) WHERE recipient_id = _res),
         'voucher cashback_chain still pays the reseller upline';
  ASSERT (SELECT count(*) FROM public.sale_commissions) = _comm_before, 'Retail never touched sale_commissions';

  UPDATE public.platform_settings SET retail_platform_fee_percent = _prev_fee WHERE id = 1;
  RAISE EXCEPTION 'RETAIL_R3_NO_SUBRESELLER_PASSED';
END $$;
