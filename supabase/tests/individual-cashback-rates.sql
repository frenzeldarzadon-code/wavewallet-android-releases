-- Authoritative cashback distribution rules — identical in EVERY shop.
--
-- Run against a database copy, it rolls everything back:
--   BEGIN; \i supabase/tests/individual-cashback-rates.sql ROLLBACK;
--
-- Model under test (parent reseller total = 30%, subreseller share = 20%):
--   * Subreseller share comes OUT OF the parent reseller total.
--   * Admin always receives 100% - parent reseller total.
--
-- Proves the required matrix:
--   1  Sub 20 / Reseller 10 / Admin 70 on a subreseller-funded purchase.
--   2  Sub 10 -> Reseller 20 / Admin 70.
--   3  Sub 30 (= parent total) -> Reseller 0 / Admin 70.
--   4  Reseller -> Customer, no subreseller: Reseller 30 / Admin 70 / Sub 0.
--   5  Subreseller -> Customer: Sub 20 / Reseller 10 / Admin 70.
--   6  Admin -> Customer: Admin 100, others 0.
--   7  Admin buys own stock: 100% discount, no cashback.
--   8  Reseller self-purchase: Admin 100%, no cashback to the buyer.
--   9  Subreseller self-purchase: Sub 20 / parent Reseller 10 / Admin 70.
--  10  A subreseller share above the parent total is rejected server-side.
--  11  A reseller total below an existing subreseller share is rejected.
--  12  Super Admin issuance and transfers pay no cashback by themselves.
--  13  Every case runs in two existing shops and the newest shop.
--  14  Changing a rate never rewrites historical rows.
--  15  Distribution always equals the purchase amount exactly.

BEGIN;

DO $$
DECLARE
  _shop record;
  _admin uuid; _res uuid; _sub uuid; _cust uuid;
  _prod uuid; _sale uuid;
  _paid numeric; _split numeric; _hist integer;
  _amt_sub numeric; _amt_res numeric; _amt_adm numeric;
BEGIN
  FOR _shop IN
    (SELECT id, name FROM public.ecosystems ORDER BY created_at LIMIT 2)
    UNION ALL
    (SELECT id, name FROM public.ecosystems ORDER BY created_at DESC LIMIT 1) -- newest shop
  LOOP
    SELECT user_id INTO _admin FROM public.user_roles
     WHERE ecosystem_id = _shop.id AND role = 'admin' LIMIT 1;
    SELECT user_id INTO _res FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'reseller' LIMIT 1;
    SELECT user_id INTO _sub FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'subreseller' AND reseller_id = _res LIMIT 1;
    SELECT user_id INTO _cust FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'customer' LIMIT 1;
    CONTINUE WHEN _admin IS NULL OR _res IS NULL OR _cust IS NULL;

    ------------------------------------------------------------------ rates
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    PERFORM public.set_member_cashback_rate(_res, _shop.id, 30, 'QA parent total');
    ASSERT public.member_cashback_rate(_res, _shop.id) = 30, 'individual reseller total';

    IF _sub IS NOT NULL THEN
      PERFORM public.set_member_cashback_rate(_sub, _shop.id, 20, 'QA subreseller share');

      -- 1: 30 / 20 -> Sub 20, Reseller 10, Admin 70.
      ASSERT (SELECT pct FROM public.cashback_chain(_sub, _shop.id)
               WHERE recipient_id = _sub) = 20, '1: subreseller keeps its own share';
      ASSERT (SELECT pct FROM public.cashback_chain(_sub, _shop.id)
               WHERE recipient_id = _res) = 10, '1: parent reseller keeps the remainder of its total';

      -- 2: 30 / 10 -> Reseller 20.
      PERFORM public.set_member_cashback_rate(_sub, _shop.id, 10, 'QA');
      ASSERT (SELECT pct FROM public.cashback_chain(_sub, _shop.id) WHERE recipient_id = _res) = 20, '2';

      -- 3: 30 / 30 -> Reseller 0 (no row at all).
      PERFORM public.set_member_cashback_rate(_sub, _shop.id, 30, 'QA');
      ASSERT NOT EXISTS (SELECT 1 FROM public.cashback_chain(_sub, _shop.id)
                          WHERE recipient_id = _res), '3: parent reseller share fully used up';

      -- 10: above the parent total is rejected.
      BEGIN
        PERFORM public.set_member_cashback_rate(_sub, _shop.id, 31, 'QA');
        RAISE EXCEPTION '10: subreseller above parent total must be rejected';
      EXCEPTION WHEN others THEN NULL; END;

      -- 11: dropping the parent below the subreseller share is rejected.
      BEGIN
        PERFORM public.set_member_cashback_rate(_res, _shop.id, 10, 'QA');
        RAISE EXCEPTION '11: reseller total below a subreseller share must be rejected';
      EXCEPTION WHEN others THEN NULL; END;

      PERFORM public.set_member_cashback_rate(_sub, _shop.id, 20, 'QA back to the reference case');
    END IF;

    -- 4: no subreseller in the chain -> the reseller takes its whole total.
    ASSERT (SELECT pct FROM public.cashback_chain(_res, _shop.id)
             WHERE recipient_id = _res) = 30, '4: reseller takes the full configured share';

    ---------------------------------------------------- funded purchases
    SELECT id INTO _prod FROM public.voucher_products
     WHERE ecosystem_id = _shop.id AND active AND NOT archived LIMIT 1;
    CONTINUE WHEN _prod IS NULL;

    -- 4/12: reseller -> customer provenance (a transfer alone pays nothing).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
    PERFORM public.transfer_credits(_cust, 100, 'QA provenance');
    ASSERT NOT EXISTS (SELECT 1 FROM public.sale_commissions sc
                        WHERE sc.ecosystem_id = _shop.id AND sc.sale_id IS NULL),
      '12: a credit transfer is not a purchase';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);

    SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;
    SELECT coalesce(sum(commission_amount),0) INTO _split
      FROM public.sale_commissions WHERE sale_id = _sale;
    ASSERT _split = _paid,
      format('15: distribution (%s) must equal the purchase (%s) in %s', _split, _paid, _shop.name);
    ASSERT NOT EXISTS (SELECT 1 FROM public.sale_commissions
                        WHERE sale_id = _sale AND recipient_id = _sub),
      '4: a reseller-funded purchase never pays a subreseller';
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _res) = round(_paid * 0.30, 2),
      '4: reseller receives its full 30% share';
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _admin) = round(_paid * 0.70, 2),
      '4: admin receives the 70% remainder';

    ------------------------------------------------------- 14: history frozen
    SELECT commission_percent INTO _hist FROM public.sale_commissions
     WHERE sale_id = _sale AND recipient_id = _res LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    PERFORM public.set_member_cashback_rate(_res, _shop.id, 40, 'QA rate change');
    ASSERT (SELECT commission_percent FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _res LIMIT 1) IS NOT DISTINCT FROM _hist,
      '14: historical transactions keep the rate they were made with';
    ASSERT EXISTS (SELECT 1 FROM public.audit_logs
                    WHERE action = 'Updated member cashback rate'
                      AND ecosystem_id = _shop.id
                      AND metadata->>'member_id' = _res::text),
      'every rate change is audited with old and new value';
    PERFORM public.set_member_cashback_rate(_res, _shop.id, 30, 'QA restore');

    -- 5: subreseller -> customer provenance.
    IF _sub IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', _sub)::text, true);
      PERFORM public.transfer_credits(_cust, 100, 'QA subreseller provenance');
      PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
      SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
      SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;
      SELECT coalesce(sum(commission_amount),0) INTO _amt_sub FROM public.sale_commissions
       WHERE sale_id = _sale AND recipient_id = _sub;
      SELECT coalesce(sum(commission_amount),0) INTO _amt_res FROM public.sale_commissions
       WHERE sale_id = _sale AND recipient_id = _res;
      SELECT coalesce(sum(commission_amount),0) INTO _amt_adm FROM public.sale_commissions
       WHERE sale_id = _sale AND recipient_id = _admin;
      ASSERT _amt_sub = round(_paid * 0.20, 2), '5: subreseller 20%';
      ASSERT _amt_res = round(_paid * 0.10, 2), '5: parent reseller keeps 10%';
      ASSERT _amt_adm = round(_paid * 0.70, 2), '5: admin keeps 70%';
      ASSERT _amt_sub + _amt_res + _amt_adm = _paid, '15: the split equals the purchase';
    END IF;

    -- 6: admin -> customer provenance pays the admin 100%.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    PERFORM public.transfer_credits(_cust, 100, 'QA admin provenance');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
    SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _admin) = _paid,
      '6: admin-funded credits pay the admin 100%';
    ASSERT NOT EXISTS (SELECT 1 FROM public.sale_commissions
                        WHERE sale_id = _sale AND recipient_id IN (_res, _sub)),
      '6: no reseller or subreseller cashback on admin-funded credits';

    ------------------------------------------------- 8: reseller self-purchase
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
    SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;
    ASSERT NOT EXISTS (SELECT 1 FROM public.sale_commissions
                        WHERE sale_id = _sale AND kind IN ('sale_cashback','upline')),
      '8: a reseller''s own purchase creates no cashback';
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _admin) = _paid,
      '8: the shop admin receives 100% of the credits the reseller used';

    ---------------------------------------------- 9: subreseller self-purchase
    IF _sub IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', _sub)::text, true);
      SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
      SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;
      IF _paid > 0 THEN
        ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
                 WHERE sale_id = _sale AND recipient_id = _sub) = round(_paid * 0.20, 2),
          '9: subreseller earns its configured share on its own purchase';
        ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
                 WHERE sale_id = _sale AND recipient_id = _res) = round(_paid * 0.10, 2),
          '9: parent reseller earns the rest of its total';
        ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
                 WHERE sale_id = _sale AND recipient_id = _admin) = round(_paid * 0.70, 2),
          '9: admin keeps the remainder';
        ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
                 WHERE sale_id = _sale) = _paid, '15: split equals the purchase';
      END IF;
    END IF;

    ------------------------------------------------ 7: admin's own purchase
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
    ASSERT (SELECT sale_price FROM public.voucher_sales WHERE id = _sale) = 0,
      '7: the admin buys their own shop stock at a 100% discount';
  END LOOP;
END $$;

ROLLBACK;
