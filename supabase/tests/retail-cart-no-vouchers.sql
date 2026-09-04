-- Checkout rule — vouchers are never cart items.
--
-- Self-contained rollback test: one DO block that ends with RAISE EXCEPTION,
-- so nothing persists. Success is the final error text
-- "RETAIL_CART_NO_VOUCHERS_PASSED".
--
-- Expectations:
--   1. A voucher product id in the retail cart is refused with the clear voucher message.
--   2. A cart mixing a retail product and a voucher is refused the same way (no order, no stock change, no hold).
--   3. The checkout quote refuses the same payloads (it mirrors place_order).
--   4. A malformed product id is refused as an invalid cart item.
--   5. A pure retail cart still places an order exactly as before.
--   6. The normal voucher purchase flow (purchase_voucher) is untouched.

DO $$
DECLARE
  _u    uuid := '3a972878-ff7b-4dfb-8a5b-b681b1c81205'; -- Sagada Wave One-Stop-Shop (universe)
  _cus  uuid := '780a6aed-96d1-4cfe-8c8b-2b735a45487b'; -- universe customer
  _prod uuid; _vp uuid; _o record; _q record; _stock int; _orders int; _msg text;
  _cg uuid; _bal numeric; _bal2 numeric; _codes int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cus, 'role', 'authenticated')::text, true);
  ASSERT public.is_universe_shop(_u), 'fixture: Universe shop';

  UPDATE public.ecosystems SET store_retail_enabled = true, store_voucher_enabled = true, retail_credit_enabled = true,
         retail_cash_enabled = true, retail_pickup_enabled = true, operations_frozen = false WHERE id = _u;
  INSERT INTO public.retail_products (ecosystem_id, name, price, stock, active, published, archived, public_visible)
  VALUES (_u, 'Cart test soap', 25, 10, true, true, false, true) RETURNING id INTO _prod;
  -- Any voucher product of this shop (authoritative classification = voucher_products table).
  SELECT id INTO _vp FROM public.voucher_products WHERE ecosystem_id = _u LIMIT 1;
  IF _vp IS NULL THEN
    INSERT INTO public.voucher_products (ecosystem_id, name, price, active, archived)
    VALUES (_u, 'Cart test voucher', 10, true, false) RETURNING id INTO _vp;
  END IF;
  SELECT count(*) INTO _orders FROM public.retail_orders WHERE customer_id = _cus;
  _cg := public.ensure_global_wallet(_cus);
  SELECT balance INTO _bal FROM public.credit_accounts WHERE id = _cg;

  -- 1. voucher alone in the cart
  BEGIN
    PERFORM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _vp, 'quantity', 1)), 'pickup', 'cash');
    RAISE EXCEPTION 'TEST_FAIL: voucher-only cart must be refused';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg NOT LIKE 'Vouchers cannot be added to a cart%' THEN RAISE EXCEPTION '1: wrong refusal: %', _msg; END IF;
  END;

  -- 2. mixed cart
  BEGIN
    PERFORM public.retail_place_order(_u, jsonb_build_array(
      jsonb_build_object('product_id', _prod, 'quantity', 2),
      jsonb_build_object('product_id', _vp, 'quantity', 1)), 'pickup', 'credit');
    RAISE EXCEPTION 'TEST_FAIL: mixed cart must be refused';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg NOT LIKE 'Vouchers cannot be added to a cart%' THEN RAISE EXCEPTION '2: wrong refusal: %', _msg; END IF;
  END;
  SELECT stock INTO _stock FROM public.retail_products WHERE id = _prod;
  ASSERT _stock = 10, '2: stock untouched';
  ASSERT (SELECT count(*) FROM public.retail_orders WHERE customer_id = _cus) = _orders, '2: no order created';
  SELECT balance INTO _bal2 FROM public.credit_accounts WHERE id = _cg;
  ASSERT _bal2 = _bal, '2: wallet untouched';

  -- 3. quote mirrors the rule
  BEGIN
    PERFORM public.retail_checkout_quote(_u, jsonb_build_array(
      jsonb_build_object('product_id', _prod, 'quantity', 1),
      jsonb_build_object('product_id', _vp, 'quantity', 1)));
    RAISE EXCEPTION 'TEST_FAIL: mixed quote must be refused';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg NOT LIKE 'Vouchers cannot be added to a cart%' THEN RAISE EXCEPTION '3: wrong refusal: %', _msg; END IF;
  END;

  -- 4. malformed id
  BEGIN
    PERFORM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', 'not-a-uuid', 'quantity', 1)), 'pickup', 'cash');
    RAISE EXCEPTION 'TEST_FAIL: malformed id must be refused';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg <> 'Invalid cart item' THEN RAISE EXCEPTION '4: wrong refusal: %', _msg; END IF;
  END;

  -- 5. pure retail cart still works
  SELECT * INTO _q FROM public.retail_checkout_quote(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 2)));
  ASSERT _q.total > 0, '5: quote total';
  SELECT * INTO _o FROM public.retail_place_order(_u, jsonb_build_array(jsonb_build_object('product_id', _prod, 'quantity', 2)), 'pickup', 'cash');
  ASSERT _o.order_id IS NOT NULL, '5: retail order placed';
  SELECT stock INTO _stock FROM public.retail_products WHERE id = _prod;
  ASSERT _stock = 8, '5: stock reserved';

  -- 6. voucher purchase flow untouched (only when the shop has stock for this product)
  SELECT count(*) INTO _codes FROM public.voucher_codes c WHERE c.product_id = _vp AND c.status = 'available';
  IF _codes > 0 THEN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
    VALUES (_cg, _cus, NULL, 'credit', 1000, 0, 'cart test funding', 'CART', public.new_tx_id(), 'general');
    PERFORM public.purchase_voucher(_vp, 1);
  END IF;

  RAISE EXCEPTION 'RETAIL_CART_NO_VOUCHERS_PASSED';
END $$;
