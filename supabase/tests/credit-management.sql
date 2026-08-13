-- Super Admin credit management: purchase verification + manual credit.
--
-- Replace the ids below with real rows from the target database, then run:
--   BEGIN; \i supabase/tests/credit-management.sql ROLLBACK;
--
-- Expectations:
--   Approve       -> exactly one credit ledger entry, balance +credits, order approved.
--   Approve twice -> refused (no second release, no double credit).
--   Reject        -> no credit entry at all.
--   Freeze        -> approved order becomes frozen with a reversal entry + audit row.
--   Manual credit -> balance grows, one immutable 'credit_issue' entry naming the
--                    operator, an audit row, and no voucher code/sale created.
--   Non-super-admin roles are refused by every one of these RPCs.

BEGIN;

DO $$
DECLARE
  _super uuid := '00000000-0000-0000-0000-000000000001'; -- platform owner
  _admin uuid := '00000000-0000-0000-0000-000000000002'; -- shop admin (buyer)
  _pkg   uuid;
  _order public.credit_purchase_orders;
  _bal_before numeric; _bal_after numeric;
  _codes_before bigint; _sales_before bigint;
  _entries bigint;
  _tx text;
BEGIN
  SELECT id INTO _pkg FROM public.credit_packages WHERE active ORDER BY sort_order LIMIT 1;

  ---------------------------------------------------------------- approve once
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  _order := public.create_credit_purchase_order(_pkg, 1, 'QA-REF-001', 'qa');

  SELECT balance INTO _bal_before FROM public.credit_accounts WHERE user_id = _admin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  _order := public.review_credit_purchase_order(_order.id, true, NULL);

  SELECT balance INTO _bal_after FROM public.credit_accounts WHERE user_id = _admin;
  ASSERT _order.status = 'approved', 'order approved';
  ASSERT _order.credit_ledger_id IS NOT NULL, 'exactly one release ledger row linked';
  ASSERT _bal_after = _bal_before + _order.credits, 'credits released once';

  ------------------------------------------------------- second approval fails
  BEGIN
    PERFORM public.review_credit_purchase_order(_order.id, true, NULL);
    RAISE EXCEPTION 'double approval must be refused';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'double approval must be refused', 'duplicate release blocked';
  END;
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _admin) = _bal_after,
         'balance unchanged after refused re-approval';

  --------------------------------------------------------------------- freeze
  _order := public.freeze_credit_purchase_order(_order.id, 'QA: payment unverifiable');
  ASSERT _order.status = 'frozen', 'order frozen';
  ASSERT _order.freeze_ledger_id IS NOT NULL, 'freeze recorded as a reversal entry';
  ASSERT (SELECT count(*) FROM public.audit_logs
           WHERE action = 'Froze released credits' AND actor_id = _super) > 0, 'freeze audited';

  --------------------------------------------------------------------- reject
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  _order := public.create_credit_purchase_order(_pkg, 1, 'QA-REF-002', NULL);
  SELECT balance INTO _bal_before FROM public.credit_accounts WHERE user_id = _admin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  _order := public.review_credit_purchase_order(_order.id, false, 'QA: no payment found');
  ASSERT _order.status = 'rejected', 'order rejected';
  ASSERT _order.credit_ledger_id IS NULL, 'rejection releases nothing';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _admin) = _bal_before,
         'balance untouched by rejection';

  -------------------------------------------------------------- manual credit
  SELECT balance INTO _bal_before FROM public.credit_accounts WHERE user_id = _admin;
  SELECT count(*) INTO _codes_before FROM public.voucher_codes;
  SELECT count(*) INTO _sales_before FROM public.voucher_sales;

  _tx := public.admin_adjust_credits(_admin, 250, 'Superadmin Manual Credit — QA', 'QA-MANUAL');

  SELECT count(*) INTO _entries FROM public.credit_ledger
   WHERE tx_id = _tx AND direction = 'credit' AND entry_kind = 'credit_issue'
     AND actor_id = _super AND user_id = _admin;
  ASSERT _entries = 1, 'one immutable manual credit ledger entry';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _admin) = _bal_before + 250,
         'manual credit lands in the wallet';
  ASSERT (SELECT count(*) FROM public.voucher_codes) = _codes_before, 'no voucher codes created';
  ASSERT (SELECT count(*) FROM public.voucher_sales) = _sales_before, 'no voucher sale created';
  ASSERT (SELECT count(*) FROM public.audit_logs
           WHERE metadata->>'tx_id' = _tx AND actor_id = _super) = 1, 'manual credit audited';

  ------------------------------------------------------------- authorization
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  BEGIN
    PERFORM public.admin_adjust_credits(_admin, 100, 'unauthorized manual credit');
    RAISE EXCEPTION 'admin must not create credits';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'admin must not create credits', 'only the platform owner can create credits';
  END;

  BEGIN
    PERFORM public.review_credit_purchase_order(_order.id, true, NULL);
    RAISE EXCEPTION 'admin must not review purchases';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'admin must not review purchases', 'review is platform-owner only';
  END;

  BEGIN
    PERFORM public.freeze_credit_purchase_order(_order.id, 'nope');
    RAISE EXCEPTION 'admin must not freeze credits';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'admin must not freeze credits', 'freeze is platform-owner only';
  END;

  RAISE NOTICE 'credit management checks passed';
END $$;

ROLLBACK;
