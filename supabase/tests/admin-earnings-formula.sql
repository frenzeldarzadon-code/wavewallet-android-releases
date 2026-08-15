-- Test scenario: Admin income = the shop's retained remainder of a completed
-- purchase, which is the admin cashback row the purchase engine actually pays
-- into the admin wallet — counted exactly once.
--
-- Authoritative rule (100% of the collected sale value is allocated):
--   sale_price = subreseller cashback + reseller upline share + admin remainder
--
-- Expectations, on a ₱100 sale with a 20% subreseller under a 30% reseller:
--   1. earnings_history reports 20 as sale_cashback to the subreseller.
--   2. earnings_history reports 10 as upline_commission to the reseller.
--   3. earnings_history reports 70 as admin_shop_margin to the admin — from
--      the admin commission row, NOT a second derived margin row.
--   4. No sale produces two admin_shop_margin rows (no double counting).
--   5. A different configuration (10% / 40%) is followed dynamically.
--
-- Run inside a transaction and roll back so no test data is persisted:
--   BEGIN; \i supabase/tests/admin-earnings-formula.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _eco uuid;
  _admin uuid := gen_random_uuid();
  _res uuid := gen_random_uuid();
  _sub uuid := gen_random_uuid();
  _cust uuid := gen_random_uuid();
  _sale uuid;
  _cashback numeric;
  _upline numeric;
  _margin numeric;
  _margin_rows int;
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price, subscription_state)
  VALUES ('Admin Earnings Test Shop', 'admin-earnings-test', 'tok-ae', 'Test', 0, 'active')
  RETURNING id INTO _eco;

  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status)
  VALUES (_admin, _eco, 'AE Admin', 'ae-admin@test.local', '900', 'active'),
         (_res,   _eco, 'AE Reseller', 'ae-res@test.local', '901', 'active'),
         (_sub,   _eco, 'AE Subreseller', 'ae-sub@test.local', '902', 'active'),
         (_cust,  _eco, 'AE Customer', 'ae-cust@test.local', '903', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_admin, 'admin', _eco), (_res, 'reseller', _eco),
         (_sub, 'subreseller', _eco), (_cust, 'customer', _eco);

  -- ₱100 customer purchase, allocation exactly as the purchase engine writes it.
  INSERT INTO public.voucher_sales (ecosystem_id, product_name, buyer_id, buyer_role,
                                    list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, quantity, unit_price)
  VALUES (_eco, 'AE Voucher', _cust, 'customer', 100, 0, 0, 100, 'credits', 'AE-TX-1', 1, 100)
  RETURNING id INTO _sale;

  INSERT INTO public.sale_commissions (ecosystem_id, sale_id, recipient_id, credits_consumed,
                                       commission_percent, commission_amount, kind)
  VALUES (_eco, _sale, _sub,   100, 20, 20, 'sale_cashback'),
         (_eco, _sale, _res,   100, 10, 10, 'upline'),
         (_eco, _sale, _admin, 100, 70, 70, 'admin');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  SELECT COALESCE(SUM(e.earning_amount) FILTER (WHERE e.earning_type = 'sale_cashback' AND e.recipient_id = _sub), 0),
         COALESCE(SUM(e.earning_amount) FILTER (WHERE e.earning_type = 'upline_commission' AND e.recipient_id = _res), 0),
         COALESCE(SUM(e.earning_amount) FILTER (WHERE e.earning_type = 'admin_shop_margin' AND e.recipient_id = _admin), 0),
         COUNT(*) FILTER (WHERE e.earning_type = 'admin_shop_margin')
    INTO _cashback, _upline, _margin, _margin_rows
    FROM public.earnings_history(NULL, _eco) e
   WHERE e.sale_id = _sale AND e.status = 'settled';

  IF _cashback <> 20 THEN RAISE EXCEPTION 'subreseller cashback expected 20, got %', _cashback; END IF;
  IF _upline <> 10 THEN RAISE EXCEPTION 'reseller upline share expected 10, got %', _upline; END IF;
  IF _margin <> 70 THEN RAISE EXCEPTION 'admin income expected 70, got %', _margin; END IF;
  IF _margin_rows <> 1 THEN RAISE EXCEPTION 'admin income double counted: % rows', _margin_rows; END IF;
  IF _cashback + _upline + _margin <> 100 THEN
    RAISE EXCEPTION 'allocation must total the ₱100 sale, got %', _cashback + _upline + _margin;
  END IF;

  -- Same shop, different configuration: 10% subreseller under a 40% reseller.
  INSERT INTO public.voucher_sales (ecosystem_id, product_name, buyer_id, buyer_role,
                                    list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, quantity, unit_price)
  VALUES (_eco, 'AE Voucher', _cust, 'customer', 100, 0, 0, 100, 'credits', 'AE-TX-2', 1, 100)
  RETURNING id INTO _sale;

  INSERT INTO public.sale_commissions (ecosystem_id, sale_id, recipient_id, credits_consumed,
                                       commission_percent, commission_amount, kind)
  VALUES (_eco, _sale, _sub,   100, 10, 10, 'sale_cashback'),
         (_eco, _sale, _res,   100, 30, 30, 'upline'),
         (_eco, _sale, _admin, 100, 60, 60, 'admin');

  SELECT COALESCE(SUM(e.earning_amount) FILTER (WHERE e.earning_type = 'admin_shop_margin'), 0),
         COUNT(*) FILTER (WHERE e.earning_type = 'admin_shop_margin')
    INTO _margin, _margin_rows
    FROM public.earnings_history(NULL, _eco) e
   WHERE e.sale_id = _sale AND e.status = 'settled';

  IF _margin <> 60 THEN RAISE EXCEPTION 'admin income expected 60 under 10/30 split, got %', _margin; END IF;
  IF _margin_rows <> 1 THEN RAISE EXCEPTION 'admin income double counted: % rows', _margin_rows; END IF;

  -- Legacy sale with no admin commission row still reports a derived remainder.
  INSERT INTO public.voucher_sales (ecosystem_id, product_name, buyer_id, buyer_role,
                                    list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, quantity, unit_price)
  VALUES (_eco, 'AE Legacy', _cust, 'customer', 100, 0, 0, 100, 'credits', 'AE-TX-3', 1, 100)
  RETURNING id INTO _sale;

  INSERT INTO public.sale_commissions (ecosystem_id, sale_id, recipient_id, credits_consumed,
                                       commission_percent, commission_amount, kind)
  VALUES (_eco, _sale, _sub, 100, 20, 20, 'sale_cashback');

  SELECT COALESCE(SUM(e.earning_amount) FILTER (WHERE e.earning_type = 'admin_shop_margin'), 0),
         COUNT(*) FILTER (WHERE e.earning_type = 'admin_shop_margin')
    INTO _margin, _margin_rows
    FROM public.earnings_history(NULL, _eco) e
   WHERE e.sale_id = _sale AND e.status = 'settled';

  IF _margin <> 80 THEN RAISE EXCEPTION 'legacy admin remainder expected 80, got %', _margin; END IF;
  IF _margin_rows <> 1 THEN RAISE EXCEPTION 'legacy admin remainder double counted: % rows', _margin_rows; END IF;

  RAISE NOTICE 'admin earnings formula OK';
END $$;

ROLLBACK;
