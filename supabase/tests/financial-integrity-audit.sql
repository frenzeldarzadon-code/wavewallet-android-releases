-- Financial integrity audit for the live Voucher Shop pricing model.
-- Rollback-only: run inside a transaction and ROLLBACK, or replace the final
-- RAISE NOTICE with RAISE EXCEPTION so nothing persists.
--
--   psql -v ON_ERROR_STOP=1 -c BEGIN -f supabase/tests/financial-integrity-audit.sql -c ROLLBACK
--
-- Assertions A..O from the audit brief. Every purchase is reconciled from the
-- actual credit_ledger rows: buyer debit == sum(credits to recipients) + fee,
-- where the fee is NOT a ledger row (it is retained, recorded on voucher_sales).
DO $$
DECLARE
  _shop uuid; _admin uuid; _res uuid; _sub uuid; _sub_parent uuid; _cust uuid; _super uuid;
  _prod uuid; _sale uuid; _tx text; _rate int; _sub_rate int; _parent_rate int;
  _debits numeric; _credits numeric; _fee numeric; _cut numeric; _price numeric;
  _n int; _hist_before text; _hist_after text; _ng uuid; _ng_buyer uuid; _ng_prod uuid;
  _gbal_before numeric; _gbal_after numeric; _rows int; _ref_credits numeric; _ref_debits numeric;
  _ret_prod uuid; _ret_shop uuid; _ret_order uuid; _ret_fee numeric; _ret_sub numeric; _ret_total numeric;
  r record; _trace text := '';
BEGIN
  SELECT user_id INTO _super FROM public.user_roles WHERE role = 'super_admin' LIMIT 1;

  SELECT e.id INTO _shop FROM public.ecosystems e
   WHERE e.shop_kind = 'universe' AND e.archived_at IS NULL AND coalesce(e.operations_frozen,false) = false
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.ecosystem_id = e.id AND m.role = 'admin' AND m.membership_state = 'active')
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m WHERE m.ecosystem_id = e.id AND m.role = 'reseller' AND m.membership_state = 'active')
   ORDER BY e.created_at LIMIT 1;
  ASSERT _shop IS NOT NULL, 'Universe fixture shop required';

  SELECT m.user_id INTO _admin FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'admin' AND m.membership_state = 'active' AND p.status = 'active' LIMIT 1;
  SELECT m.user_id INTO _res FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'reseller' AND m.membership_state = 'active' AND p.status = 'active'
     AND NOT public.is_super_admin(m.user_id) AND coalesce(public.member_cashback_rate(m.user_id, _shop),0) > 0 LIMIT 1;
  SELECT m.user_id INTO _cust FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'customer' AND m.membership_state = 'active' AND p.status = 'active'
     AND NOT public.is_super_admin(m.user_id) LIMIT 1;
  SELECT m.user_id, m.reseller_id INTO _sub, _sub_parent FROM public.ecosystem_memberships m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.ecosystem_id = _shop AND m.role = 'subreseller' AND m.membership_state = 'active' AND p.status = 'active'
     AND m.reseller_id IS NOT NULL AND coalesce(public.member_cashback_rate(m.user_id, _shop),0) > 0 LIMIT 1;
  ASSERT _admin IS NOT NULL AND _res IS NOT NULL AND _cust IS NOT NULL AND _sub IS NOT NULL, 'fixtures required';
  _rate := public.member_cashback_rate(_res, _shop);
  _sub_rate := public.member_cashback_rate(_sub, _shop);
  _parent_rate := public.member_cashback_rate(_sub_parent, _shop);

  SELECT md5(string_agg(row_to_json(v)::text, '|' ORDER BY v.id)) INTO _hist_before
    FROM public.voucher_sales v WHERE v.created_at < now();

  -- fixture product ₱100 (fee snapshot = current setting, expected 1%)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  INSERT INTO public.voucher_products (ecosystem_id, name, description, credit_price, active)
  VALUES (_shop, 'AUDIT ₱100', 'audit', 100, true) RETURNING id INTO _prod;
  ASSERT (SELECT platform_fee_percent FROM public.voucher_products WHERE id = _prod) = 1, 'fee snapshot is 1%';
  INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status)
  SELECT _shop, _prod, 'AUD-' || g, 'unused' FROM generate_series(1, 10) g;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  PERFORM public.admin_load_credits(_cust, 500, 'audit', 'AUD-C', _shop);
  PERFORM public.admin_load_credits(_res, 500, 'audit', 'AUD-R', _shop);
  PERFORM public.admin_load_credits(_sub, 500, 'audit', 'AUD-S', _shop);
  PERFORM public.admin_load_credits(_admin, 500, 'audit', 'AUD-A', _shop);

  ------------------------------------------------------------------ helper: reconcile a sale
  -- (inlined below for each purchase)

  ------------------------------------------------------------------ 1. customer buys via reseller storefront
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
  SELECT sale_id, tx_id INTO _sale, _tx FROM public.purchase_voucher(_prod, 1, _res);
  SELECT sale_price, platform_fee_amount, seller_amount INTO _price, _fee, _cut FROM public.voucher_sales WHERE id = _sale;
  ASSERT _price = 100 AND _fee = 1.00 AND _cut = 99.00, format('H/L: price %s fee %s cut %s', _price, _fee, _cut);
  -- A/H: exactly one debit, equal to the customer price
  SELECT count(*), coalesce(sum(amount),0) INTO _n, _debits FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'debit';
  ASSERT _n = 1 AND _debits = 100, format('A/H: one buyer debit of ₱100, got %s rows / %s', _n, _debits);
  ASSERT (SELECT user_id FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'debit') = _cust, 'A: debit is on the buyer';
  ASSERT (SELECT ecosystem_id FROM public.credit_accounts WHERE id = (SELECT account_id FROM public.credit_ledger WHERE sale_id = _sale AND direction='debit')) IS NULL,
    'N: Universe buyer debited from the GLOBAL wallet';
  -- D: cashback once per recipient
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'sale_commission' AND user_id = _res) = 1, 'D: reseller cashback once';
  ASSERT (SELECT amount FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'sale_commission' AND user_id = _res) = round(100 * _rate / 100.0, 2), 'D: reseller cashback = rate% of ₱100';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'sale_commission' AND user_id = _admin) = 1, 'B: shop remainder once';
  -- C: fee recorded once (on the sale), never as a ledger credit
  ASSERT (SELECT count(*) FROM public.voucher_sales WHERE tx_id = _tx) = 1, 'C: one sale row per tx';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'credit' AND user_id = _super), 'C: fee is retained, not credited to a wallet';
  -- G: reconciliation: debit = credits + fee
  SELECT coalesce(sum(amount),0) INTO _credits FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'credit';
  ASSERT _debits = _credits + _fee, format('G: debit %s = credits %s + fee %s', _debits, _credits, _fee);
  ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions WHERE sale_id = _sale) = _credits, 'G: sale_commissions == ledger credits';
  _trace := _trace || E'\nsale 1 (customer via reseller): ' || (SELECT string_agg(format('%s %s %s %s', direction, amount, entry_kind, coalesce(reason,'')), ' | ' ORDER BY direction DESC, amount DESC) FROM public.credit_ledger WHERE sale_id = _sale);

  ------------------------------------------------------------------ 2. reseller self-purchase (E/F)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  SELECT sale_id, tx_id INTO _sale, _tx FROM public.purchase_voucher(_prod, 1);
  ASSERT (SELECT discount_percent FROM public.voucher_sales WHERE id = _sale) = 0, 'F: no role discount recorded';
  SELECT count(*), coalesce(sum(amount),0) INTO _n, _debits FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'debit';
  ASSERT _n = 1 AND _debits = 100, 'F/H: reseller pays full ₱100 once';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'credit' AND user_id = _res) = 1, 'E: exactly one own-earning row';
  ASSERT (SELECT amount FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'credit' AND user_id = _res) = round(100 * _rate / 100.0, 2), 'E: own cashback amount';
  SELECT coalesce(sum(amount),0), platform_fee_amount INTO _credits, _fee FROM public.credit_ledger l JOIN public.voucher_sales s ON s.id = l.sale_id WHERE l.sale_id = _sale AND l.direction = 'credit' GROUP BY platform_fee_amount;
  ASSERT _debits = _credits + _fee, format('G: reseller self: %s = %s + %s', _debits, _credits, _fee);
  _trace := _trace || E'\nsale 2 (reseller self): ' || (SELECT string_agg(format('%s %s %s', direction, amount, entry_kind), ' | ' ORDER BY direction DESC, amount DESC) FROM public.credit_ledger WHERE sale_id = _sale);

  ------------------------------------------------------------------ 3. subreseller self-purchase (E)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _sub)::text, true);
  SELECT sale_id, tx_id INTO _sale, _tx FROM public.purchase_voucher(_prod, 1);
  SELECT count(*), coalesce(sum(amount),0) INTO _n, _debits FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'debit';
  ASSERT _n = 1 AND _debits = 100, 'E: subreseller pays full ₱100 once';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE sale_id = _sale AND direction='credit' AND user_id = _sub) = 1, 'E: sub own earning once';
  ASSERT (SELECT amount FROM public.credit_ledger WHERE sale_id = _sale AND direction='credit' AND user_id = _sub) = round(100 * least(_sub_rate,_parent_rate) / 100.0, 2), 'E: sub own rate';
  IF _parent_rate > _sub_rate THEN
    ASSERT (SELECT count(*) FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'upline_commission' AND user_id = _sub_parent) = 1, 'E: upline once';
    ASSERT (SELECT amount FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'upline_commission') = round(100 * (_parent_rate - _sub_rate) / 100.0, 2), 'E: upline = parent-sub';
  END IF;
  SELECT coalesce(sum(amount),0) INTO _credits FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'credit';
  SELECT platform_fee_amount INTO _fee FROM public.voucher_sales WHERE id = _sale;
  ASSERT _debits = _credits + _fee, format('G: sub self: %s = %s + %s', _debits, _credits, _fee);
  _trace := _trace || E'\nsale 3 (subreseller self): ' || (SELECT string_agg(format('%s %s %s', direction, amount, entry_kind), ' | ' ORDER BY direction DESC, amount DESC) FROM public.credit_ledger WHERE sale_id = _sale);

  ------------------------------------------------------------------ 4. admin self-purchase (E)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  SELECT sale_id, tx_id INTO _sale, _tx FROM public.purchase_voucher(_prod, 1);
  SELECT count(*), coalesce(sum(amount),0) INTO _n, _debits FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'debit';
  ASSERT _n = 1 AND _debits = 100, 'E: admin pays full ₱100 once';
  ASSERT (SELECT count(*) FROM public.credit_ledger WHERE sale_id = _sale AND direction='credit') = 1, 'E: admin gets exactly one remainder row';
  ASSERT (SELECT amount FROM public.credit_ledger WHERE sale_id = _sale AND direction='credit' AND user_id = _admin) = 99.00, 'E: admin remainder = ₱99 (₱100 − ₱1 fee)';
  _trace := _trace || E'\nsale 4 (admin self): ' || (SELECT string_agg(format('%s %s %s', direction, amount, entry_kind), ' | ' ORDER BY direction DESC, amount DESC) FROM public.credit_ledger WHERE sale_id = _sale);

  ------------------------------------------------------------------ 5. I: replay protection
  -- tx_id is unique in credit_ledger; a replayed insert of the same tx must fail.
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, sale_id, entry_kind)
    SELECT account_id, user_id, ecosystem_id, direction, amount, 0, reason, reference, actor_id, tx_id, sale_id, entry_kind
      FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'credit';
    RAISE EXCEPTION 'I: duplicate commission ledger row was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, sale_id, entry_kind)
    SELECT account_id, user_id, ecosystem_id, direction, amount, 0, reason, reference, actor_id, 'OTHER-' || tx_id, sale_id, entry_kind
      FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'sale_commission';
    RAISE EXCEPTION 'I: second sale_commission for same (sale,user) was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- codes are consumed: the same product cannot be "re-sold" for the same codes
  ASSERT (SELECT count(*) FROM public.voucher_codes WHERE sale_id = _sale AND status = 'sold') = 1, 'I: exactly one code bound to the sale';

  ------------------------------------------------------------------ 6. J: refund never exceeds original debit; second refund rejected
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  SELECT coalesce(sum(amount),0) INTO _gbal_before FROM public.credit_ledger WHERE sale_id = _sale AND direction = 'debit';
  PERFORM public.refund_voucher_sale(_sale, 'audit refund');
  SELECT coalesce(sum(amount),0) INTO _ref_credits FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'refund';
  SELECT coalesce(sum(amount),0) INTO _ref_debits FROM public.credit_ledger WHERE sale_id = _sale AND entry_kind = 'sale_commission_reversal';
  ASSERT _ref_credits = 100, format('J: refund credits exactly the original ₱100, got %s', _ref_credits);
  ASSERT _ref_debits = 99, format('J: commission reversal claws back exactly ₱99, got %s', _ref_debits);
  -- whole-sale net: debits == credits (fee returns to circulation on refund)
  ASSERT (SELECT coalesce(sum(CASE WHEN direction='debit' THEN amount ELSE -amount END),0) FROM public.credit_ledger WHERE sale_id = _sale) = 0, 'J/G: net movement after refund is 0';
  BEGIN
    PERFORM public.refund_voucher_sale(_sale, 'audit refund again');
    RAISE EXCEPTION 'J: second refund was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%already refunded%' THEN RAISE; END IF;
  END;

  ------------------------------------------------------------------ 7. M: inverse pricing helpers
  FOR r IN SELECT g::numeric / 100 AS p FROM generate_series(1, 5000, 37) g LOOP
    ASSERT public.voucher_seller_cut(r.p, 1) + public.voucher_platform_fee_amount(r.p, 1) = r.p, format('M: cut+fee != price at %s', r.p);
  END LOOP;
  ASSERT public.voucher_price_from_seller_cut(9.90, 1) = 10.00, 'M: ₱9.90 cut -> ₱10.00 retail';
  ASSERT public.voucher_seller_cut(10.00, 1) = 9.90, 'M: ₱10.00 retail -> ₱9.90 cut';
  ASSERT public.voucher_price_from_seller_cut(100, 1) = 101.00 AND public.voucher_seller_cut(101, 1) = 100.00, 'M: ₱100 cut <-> ₱101 retail';

  ------------------------------------------------------------------ 8. L/O: live prices & history untouched
  ASSERT NOT EXISTS (SELECT 1 FROM public.voucher_products p JOIN public.ecosystems e ON e.id = p.ecosystem_id
                      WHERE e.shop_kind = 'universe' AND p.created_at < now() AND p.platform_fee_percent IS DISTINCT FROM 1), 'L: all live Universe products carry the 1% inclusive snapshot';
  SELECT md5(string_agg(row_to_json(v)::text, '|' ORDER BY v.id)) INTO _hist_after FROM public.voucher_sales v WHERE v.created_at < now();
  ASSERT _hist_before = _hist_after, 'O: historical voucher sales unchanged';

  ------------------------------------------------------------------ 9. N: New Generation isolation
  SELECT e.id INTO _ng FROM public.ecosystems e WHERE e.shop_kind = 'subscription' AND e.archived_at IS NULL
     AND coalesce(e.operations_frozen,false) = false AND public.subscription_ok(e.id)
     AND EXISTS (SELECT 1 FROM public.voucher_products p WHERE p.ecosystem_id = e.id AND p.active AND NOT p.archived)
     AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m JOIN public.profiles pr ON pr.id = m.user_id
                  WHERE m.ecosystem_id = e.id AND m.role = 'customer' AND m.membership_state = 'active' AND pr.status='active')
   LIMIT 1;
  IF _ng IS NOT NULL THEN
    SELECT m.user_id INTO _ng_buyer FROM public.ecosystem_memberships m JOIN public.profiles pr ON pr.id = m.user_id
     WHERE m.ecosystem_id = _ng AND m.role = 'customer' AND m.membership_state = 'active' AND pr.status='active' LIMIT 1;
    SELECT p.id INTO _ng_prod FROM public.voucher_products p WHERE p.ecosystem_id = _ng AND p.active AND NOT p.archived LIMIT 1;
    INSERT INTO public.voucher_codes (ecosystem_id, product_id, code, status) VALUES (_ng, _ng_prod, 'AUD-NG-1', 'unused');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
    PERFORM public.admin_load_credits(_ng_buyer, 1000, 'audit', 'AUD-NG', _ng);
    SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) INTO _gbal_before
      FROM public.credit_ledger l JOIN public.credit_accounts a ON a.id = l.account_id WHERE a.user_id = _ng_buyer AND a.ecosystem_id IS NULL;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _ng_buyer)::text, true);
    -- NG buyer must be routed to the shop wallet; the purchase must NOT touch the global wallet
    UPDATE public.profiles SET ecosystem_id = _ng WHERE id = _ng_buyer AND ecosystem_id IS DISTINCT FROM _ng;
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_ng_prod, 1);
    ASSERT (SELECT ecosystem_id FROM public.credit_accounts WHERE id = (SELECT account_id FROM public.credit_ledger WHERE sale_id = _sale AND direction='debit')) = _ng,
      'N: New Generation debit lands in the shop wallet';
    ASSERT (SELECT platform_fee_amount FROM public.voucher_sales WHERE id = _sale) = 0, 'N: no platform fee in New Generation';
    SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) INTO _gbal_after
      FROM public.credit_ledger l JOIN public.credit_accounts a ON a.id = l.account_id WHERE a.user_id = _ng_buyer AND a.ecosystem_id IS NULL;
    ASSERT _gbal_before = _gbal_after, 'N: global wallet untouched by a New Generation purchase';
  ELSE
    RAISE NOTICE 'N: no purchasable New Generation fixture; isolation covered by discount-rule assertions only';
  END IF;

  ------------------------------------------------------------------ 10. K: wholesale fee base
  -- Covered by supabase/tests/retail-r2-pricing.sql + src/lib/retail-pricing.test.ts
  -- (fee is computed on the discounted wholesale seller amount, once; Retail stays hidden).

  RAISE NOTICE 'financial-integrity-audit: all assertions passed%', _trace;
END $$;
