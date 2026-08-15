-- Cashback credit provenance — authoritative rules for EVERY shop.
--
-- Run against a database copy; it rolls everything back:
--   BEGIN; \i supabase/tests/cashback-credit-provenance.sql ROLLBACK;
--
-- Regression covered here (production bug, Lenas Giga Surf, 2026-08-15):
--   A subreseller transferred credits to a customer while a platform operator
--   was acting on her behalf. transfer_credits_in_shop stamped the ledger with
--   auth.uid() (the operator) instead of effective_uid() (the wallet owner), so
--   track_credit_lots classified the lot as 'admin' and the customer's purchase
--   paid 100% to the shop admin. track_credit_lots also resolved reseller /
--   subreseller roles from user_roles only, so membership-only members produced
--   'system' lots with no cashback at all.
--
-- Matrix:
--   A  Subreseller -> customer -> purchase: 20 / 10 / 70 at 30% parent, 20% sub.
--   B  Reseller -> customer -> purchase: 30 / 70, subreseller 0.
--   C  Admin -> customer -> purchase: admin 100.
--   D  Shop-to-shop transfer credits: no cashback for the transfer itself.
--   E  Mixed sources in one wallet: per-lot FIFO attribution, sum = purchase.
--   F  Duplicate cashback is impossible (unique index).
--   G  Every ledger row has a non-null entry_kind.

BEGIN;

DO $$
DECLARE
  _shop record;
  _admin uuid; _res uuid; _sub uuid; _cust uuid; _prod uuid; _sale uuid;
  _paid numeric; _split numeric; _kind text;
BEGIN
  FOR _shop IN SELECT id, name FROM public.ecosystems WHERE archived_at IS NULL ORDER BY created_at LOOP
    SELECT user_id INTO _admin FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'admin' AND membership_state = 'active' LIMIT 1;
    SELECT user_id INTO _res FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'reseller' AND membership_state = 'active' LIMIT 1;
    SELECT user_id INTO _sub FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'subreseller' AND membership_state = 'active'
       AND reseller_id = _res LIMIT 1;
    SELECT user_id INTO _cust FROM public.ecosystem_memberships
     WHERE ecosystem_id = _shop.id AND role = 'customer' AND membership_state = 'active' LIMIT 1;
    CONTINUE WHEN _admin IS NULL OR _res IS NULL OR _sub IS NULL OR _cust IS NULL;

    SELECT id INTO _prod FROM public.voucher_products
     WHERE ecosystem_id = _shop.id AND active AND NOT archived
       AND coalesce(promo_price, credit_price) = 100 LIMIT 1;
    CONTINUE WHEN _prod IS NULL;

    -- Reference configuration: parent total 30%, subreseller share 20%.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    PERFORM public.set_member_cashback_rate(_res, _shop.id, 30, 'QA parent total');
    PERFORM public.set_member_cashback_rate(_sub, _shop.id, 20, 'QA subreseller share');

    ---------------------------------------------------------------- case A
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _sub)::text, true);
    PERFORM public.transfer_credits_in_shop(_shop.id, _cust, 100, 'QA A');

    -- The credits must carry the subreseller as their provenance, not the actor.
    SELECT source_kind INTO _kind FROM public.credit_lots
     WHERE user_id = _cust AND ecosystem_id = _shop.id ORDER BY seq DESC LIMIT 1;
    ASSERT _kind = 'subreseller',
      format('A: lot provenance must be subreseller in %s, got %s', _shop.name, _kind);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
    SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;

    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _sub) = round(_paid * 0.20, 2), 'A: subreseller 20%';
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _res) = round(_paid * 0.10, 2), 'A: parent keeps 10%';
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _admin) = round(_paid * 0.70, 2), 'A: admin remainder 70%';

    SELECT coalesce(sum(commission_amount),0) INTO _split
      FROM public.sale_commissions WHERE sale_id = _sale AND reversed_at IS NULL;
    ASSERT _split = _paid, format('A: split %s must equal purchase %s', _split, _paid);

    -- Cashback lands in the recipients' shop wallets as commission entries.
    ASSERT (SELECT count(*) FROM public.credit_ledger
             WHERE sale_id = _sale AND user_id = _sub
               AND entry_kind = 'sale_commission') = 1, 'A: one subreseller cashback ledger row';
    ASSERT (SELECT count(*) FROM public.credit_ledger
             WHERE sale_id = _sale AND user_id = _res
               AND entry_kind = 'upline_commission') = 1, 'A: one upline cashback ledger row';

    ---------------------------------------------------------------- case F
    -- Duplicate cashback is structurally impossible.
    BEGIN
      INSERT INTO public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                        balance_after, reason, actor_id, tx_id, sale_id, entry_kind)
      VALUES (public.wallet_id_for(_sub, _shop.id), _sub, _shop.id, 'credit', 1, 0,
              'QA duplicate', _sub, public.new_tx_id(), _sale, 'sale_commission');
      RAISE EXCEPTION 'F: duplicate cashback must be rejected';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    ---------------------------------------------------------------- case B
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
    PERFORM public.transfer_credits_in_shop(_shop.id, _cust, 100, 'QA B');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
    SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;
    ASSERT NOT EXISTS (SELECT 1 FROM public.sale_commissions
                        WHERE sale_id = _sale AND recipient_id = _sub), 'B: no subreseller cashback';
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _res) = round(_paid * 0.30, 2), 'B: reseller 30%';
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _admin) = round(_paid * 0.70, 2), 'B: admin 70%';

    ---------------------------------------------------------------- case C
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
    PERFORM public.transfer_credits_in_shop(_shop.id, _cust, 100, 'QA C');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
    SELECT sale_id INTO _sale FROM public.purchase_voucher(_prod, 1);
    SELECT sale_price INTO _paid FROM public.voucher_sales WHERE id = _sale;
    ASSERT (SELECT coalesce(sum(commission_amount),0) FROM public.sale_commissions
             WHERE sale_id = _sale AND recipient_id = _admin) = _paid, 'C: admin takes 100%';
    ASSERT NOT EXISTS (SELECT 1 FROM public.sale_commissions
                        WHERE sale_id = _sale AND recipient_id IN (_res, _sub)), 'C: no reseller cashback';

    ---------------------------------------------------------------- case D
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.credit_lots
       WHERE source_kind = 'transfer' AND source_user_id IS NOT NULL),
      'D: shop-to-shop credits carry no cashback lineage';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.sale_commissions sc WHERE sc.sale_id IS NULL),
      'D: cashback only ever comes from a sale';

    ---------------------------------------------------------------- case E
    -- Mixed provenance: each consumed lot is attributed on its own amount.
    ASSERT NOT EXISTS (
      SELECT sc.sale_id FROM public.sale_commissions sc
       JOIN public.voucher_sales vs ON vs.id = sc.sale_id
       WHERE sc.reversed_at IS NULL AND vs.ecosystem_id = _shop.id
       GROUP BY sc.sale_id, vs.sale_price
      HAVING round(sum(sc.commission_amount), 2) <> round(vs.sale_price, 2)),
      format('E: every sale in %s must distribute exactly its price', _shop.name);
  END LOOP;
END $$;

-------------------------------------------------------------------- case G
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE entry_kind IS NULL),
    'G: every ledger row carries an entry kind';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.credit_accounts ca
     WHERE ca.balance <> (SELECT coalesce(sum(case when l.direction = 'credit'
                                                   then l.amount else -l.amount end), 0)
                            FROM public.credit_ledger l WHERE l.account_id = ca.id)),
    'G: every wallet reconciles with its ledger';
END $$;

ROLLBACK;
