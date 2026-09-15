-- Admin voucher purchase accounting (Universe shops).
--
-- Run against a database copy; it rolls everything back:
--   psql -v ON_ERROR_STOP=1 -c BEGIN -f supabase/tests/admin-voucher-net-purchase.sql -c ROLLBACK
--
-- Authority: public.voucher_admin_self_net(total, fee, other, ratio) +
--            public.universe_purchase_debit(...) — the SAME net-charge mechanism
--            resellers use (public.universe_self_purchase_net).
--
-- Formula proven here, for the shop's own admin buying in their Universe shop:
--   benefit      = price − platform fee − seller cashback owed   (the admin remainder)
--   points basis = price − benefit                                (= fee + seller cashback)
--   points       = round(points basis / credits_per_point, 2)
--   self cashback= max(benefit − points, 0)                       (1 point = 1 coin cost)
--   charge       = price − self cashback = fee + seller cashback + points
--
-- Proves:
--   A1 quote mirrors the formula and reports fee + points.
--   A2 the wallet moves exactly the charge — never the face value.
--   A3 exactly ONE buyer wallet row; the sale keeps price / cashback / charge.
--   A4 points come from the ACTUAL charge basis, not the face value.
--   A5 the admin remainder is settled by the debit — never credited a second time.
--   A6 cashback + fee still total the price (no double counting).
--   A7 an admin holding less than the face value can still buy.
--   A8 reseller behaviour is unchanged.

DO $$
DECLARE
  _shop uuid; _admin uuid; _res uuid; _prod uuid; _sale uuid;
  _fee numeric; _benefit numeric; _basis numeric; _pts numeric; _cb numeric; _charge numeric;
  _ratio numeric; _before numeric; _after numeric; _acct uuid; _q record; _l public.credit_ledger;
  _n int; _split numeric; _rate int; _res_g uuid; _rnet numeric;
BEGIN
  SELECT e.id, e.credits_per_point INTO _shop, _ratio FROM public.ecosystems e
   WHERE e.shop_kind = 'universe' AND e.archived_at IS NULL AND coalesce(e.operations_frozen,false) = false
     AND coalesce(e.credits_per_point,0) > 0
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.ecosystem_id = e.id AND m.role = 'admin' AND m.membership_state = 'active')
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.ecosystem_id = e.id AND m.role = 'reseller' AND m.membership_state = 'active')
   ORDER BY e.created_at LIMIT 1;
  ASSERT _shop IS NOT NULL, 'a Universe shop with admin + reseller + points ratio is required';

  _admin := public.shop_primary_admin(_shop);
  ASSERT _admin IS NOT NULL AND NOT public.is_super_admin(_admin), 'active shop admin fixture required';
  SELECT m.user_id INTO _res FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'reseller' AND m.membership_state = 'active' AND p.status = 'active'
     AND NOT public.is_super_admin(m.user_id) LIMIT 1;
  ASSERT _res IS NOT NULL, 'active reseller fixture required';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_shop, 'QA admin ₱10 voucher', 'qa', 10, true) RETURNING id INTO _prod;
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _shop, _prod, 'QAA-' || g, 'unused' FROM generate_series(1, 4) g;

  SELECT platform_fee_percent INTO _fee FROM public.voucher_products WHERE id = _prod;
  _fee := public.voucher_platform_fee_amount(10, round(coalesce(_fee,0),2));
  _benefit := round(10 - _fee, 2);
  _basis := round(10 - _benefit, 2);
  _pts := round(_basis / _ratio, 2);
  _cb := greatest(round(_benefit - _pts, 2), 0);
  _charge := round(10 - _cb, 2);

  ---------------------------------------------------------------- A1 quote
  SELECT * INTO _q FROM public.voucher_checkout_quote(_prod, 1);
  ASSERT _q.total = 10, format('A1: face value stays ₱10, got %s', _q.total);
  ASSERT _q.self_purchase AND _q.self_cashback = _cb, format('A1: benefit %s expected %s', _q.self_cashback, _cb);
  ASSERT _q.buyer_charge = _charge, format('A1: quote charge %s expected %s', _q.buyer_charge, _charge);
  ASSERT _q.platform_fee = _fee, format('A1: quote fee %s expected %s', _q.platform_fee, _fee);
  ASSERT _q.points_earned = _pts, format('A1: quote points %s expected %s', _q.points_earned, _pts);
  ASSERT _charge = round(_fee + _pts, 2), 'A1: charge = platform fee + point coin cost';

  ---------------------------------------------------------------- A7 fund LESS than face value
  _acct := public.ensure_global_wallet(_admin);
  UPDATE public.credit_accounts SET balance = 0 WHERE id = _acct;
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_acct, _admin, NULL, 'credit', 5, 0, 'QA fund admin', 'QA-A', public.new_tx_id(), 'general');
  SELECT balance INTO _before FROM public.credit_accounts WHERE id = _acct;
  ASSERT _before < 10, 'A7: admin deliberately holds less than the face value';

  ---------------------------------------------------------------- A2/A3 purchase
  SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
  SELECT balance INTO _after FROM public.credit_accounts WHERE id = _acct;
  ASSERT _before - _after = _charge, format('A2: wallet moved %s, expected %s', _before - _after, _charge);

  SELECT count(*) INTO _n FROM public.credit_ledger WHERE sale_id = _sale AND user_id = _admin;
  ASSERT _n = 1, format('A3/A5: exactly ONE wallet row for the admin, got %s', _n);
  SELECT * INTO _l FROM public.credit_ledger WHERE sale_id = _sale AND user_id = _admin;
  ASSERT _l.direction = 'debit' AND _l.amount = _charge AND _l.base_amount = 10 AND _l.commission_amount = _cb,
         'A3: debit carries the price / benefit breakdown';
  ASSERT (SELECT sale_price FROM public.voucher_sales WHERE id = _sale) = 10, 'A3: sale price stays the face value';
  ASSERT (SELECT self_cashback FROM public.voucher_sales WHERE id = _sale) = _cb, 'A3: sale.self_cashback';
  ASSERT (SELECT buyer_charge FROM public.voucher_sales WHERE id = _sale) = _charge, 'A3: sale.buyer_charge';

  ---------------------------------------------------------------- A4 points from the actual charge
  ASSERT (SELECT points_earned FROM public.voucher_sales WHERE id = _sale) = _pts,
         'A4: sale points come from the charge basis';
  ASSERT (SELECT amount FROM public.points_ledger WHERE sale_id = _sale AND entry_type = 'earn') = _pts,
         'A4: points ledger amount';
  ASSERT (SELECT credits_basis FROM public.points_ledger WHERE sale_id = _sale AND entry_type = 'earn') = _basis,
         'A4: points basis is the charge, never the face value';

  ---------------------------------------------------------------- A5 remainder never paid twice
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE sale_id = _sale AND user_id = _admin AND direction = 'credit'),
         'A5: the admin remainder is settled by the debit, never credited again';
  ASSERT (SELECT count(*) FROM public.sale_commissions WHERE sale_id = _sale AND recipient_id = _admin AND kind = 'admin'
            AND commission_amount = _benefit AND ledger_id = _l.id) = 1,
         'A5: one audit row for the remainder, marked settled by the debit';

  ---------------------------------------------------------------- A6 no double counting
  SELECT coalesce(sum(commission_amount),0) INTO _split FROM public.sale_commissions WHERE sale_id = _sale;
  ASSERT round(_split + (SELECT platform_fee_amount FROM public.voucher_sales WHERE id = _sale), 2) = 10,
         format('A6: cashback %s + fee must total ₱10', _split);
  ASSERT (SELECT count(*) FROM public.voucher_codes WHERE product_id = _prod AND status = 'sold') = 1, 'A6: one code issued';

  ---------------------------------------------------------------- A8 reseller unchanged
  _rate := coalesce(public.member_cashback_rate(_res, _shop), 0);
  ASSERT _rate > 0, 'fixture reseller needs a cashback rate';
  _res_g := public.ensure_global_wallet(_res);
  INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, tx_id, entry_kind)
  VALUES (_res_g, _res, NULL, 'credit', 100, 0, 'QA fund reseller', 'QA-R2', public.new_tx_id(), 'general');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  _rnet := round(10 - round(10 * _rate / 100.0, 2), 2);
  SELECT * INTO _q FROM public.voucher_checkout_quote(_prod, 1);
  ASSERT _q.self_purchase AND _q.buyer_charge = _rnet AND _q.cashback_percent = _rate,
         format('A8: reseller quote %s expected %s', _q.buyer_charge, _rnet);
  SELECT balance INTO _before FROM public.credit_accounts WHERE id = _res_g;
  SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
  SELECT balance INTO _after FROM public.credit_accounts WHERE id = _res_g;
  ASSERT _before - _after = _rnet, format('A8: reseller wallet moved %s, expected %s', _before - _after, _rnet);
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE sale_id = _sale AND user_id = _admin AND direction = 'credit') = 1,
         'A8: admin remainder is still credited on someone else''s purchase';

  RAISE NOTICE 'ADMIN_VOUCHER_NET_PURCHASE_TESTS_PASSED';
END $$;
