-- Super Admin Credit Issuance: the platform owner MINTS credits.
--
-- Replace the ids below with real rows, then run:
--   BEGIN; \i supabase/tests/superadmin-credit-issuance.sql ROLLBACK;
--
-- Proves:
--   * a platform owner with a ZERO balance can still issue credits
--   * the recipient balance grows by exactly the issued amount
--   * the operator's own wallet is untouched (no debit, no requirement)
--   * one immutable 'superadmin_credit_issuance' ledger row is written
--   * the platform issuance supply grows by the same amount
--   * the issuance record carries the full audit payload
--   * a repeated request key issues nothing twice (duplicate/concurrency guard)
--   * non-super-admin callers are refused

BEGIN;

DO $$
DECLARE
  _super uuid := '00000000-0000-0000-0000-000000000001'; -- platform owner
  _target uuid := '00000000-0000-0000-0000-000000000002'; -- any account
  _tx text; _tx2 text; _key text := 'QA-ISSUE-' || gen_random_uuid()::text;
  _op_before numeric; _op_after numeric;
  _bal_before numeric; _bal_after numeric;
  _supply_before numeric; _supply_after numeric;
  _rec public.platform_credit_issuances;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);

  -- Platform owner starts from zero: issuance must not need any balance.
  UPDATE public.credit_accounts SET balance = 0 WHERE user_id = _super;
  SELECT balance INTO _op_before FROM public.credit_accounts WHERE user_id = _super;
  ASSERT _op_before = 0, 'operator wallet is empty';

  SELECT balance INTO _bal_before FROM public.credit_accounts WHERE user_id = _target;
  SELECT total_issued INTO _supply_before FROM public.platform_credit_supply();

  _tx := public.superadmin_issue_credits(_target, 10000, 'QA issuance', 'Goodwill', 'QA-REF', _key);

  SELECT balance INTO _bal_after FROM public.credit_accounts WHERE user_id = _target;
  SELECT balance INTO _op_after FROM public.credit_accounts WHERE user_id = _super;
  SELECT total_issued INTO _supply_after FROM public.platform_credit_supply();

  ASSERT _bal_after = _bal_before + 10000, 'recipient gained exactly the issued amount';
  ASSERT _op_after = 0, 'operator wallet never debited';
  ASSERT _supply_after = _supply_before + 10000, 'platform issuance supply incremented';

  ASSERT (SELECT count(*) FROM public.credit_ledger
           WHERE tx_id = _tx AND direction = 'credit'
             AND entry_kind = 'superadmin_credit_issuance'
             AND user_id = _target AND actor_id = _super) = 1,
         'one immutable issuance ledger entry';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_ledger
                      WHERE tx_id = _tx AND user_id = _super),
         'no counter-entry against the operator wallet';

  SELECT * INTO _rec FROM public.platform_credit_issuances WHERE tx_id = _tx;
  ASSERT _rec.operator_id = _super AND _rec.recipient_id = _target, 'both identities recorded';
  ASSERT _rec.amount = 10000 AND _rec.reason = 'QA issuance', 'amount and reason recorded';
  ASSERT _rec.category = 'Goodwill' AND _rec.reference = 'QA-REF', 'category and reference recorded';
  ASSERT _rec.balance_before = _bal_before AND _rec.balance_after = _bal_after,
         'before/after balances recorded';
  ASSERT _rec.ecosystem_id IS NOT NULL AND _rec.recipient_role IS NOT NULL,
         'ecosystem and role recorded';
  ASSERT (SELECT count(*) FROM public.audit_logs
           WHERE metadata->>'tx_id' = _tx AND actor_id = _super) = 1, 'issuance audited';

  -- No voucher side effects.
  ASSERT NOT EXISTS (SELECT 1 FROM public.voucher_sales WHERE tx_id = _tx), 'no voucher sale';

  ---------------------------------------------------------- duplicate request
  _tx2 := public.superadmin_issue_credits(_target, 10000, 'QA issuance', 'Goodwill', 'QA-REF', _key);
  ASSERT _tx2 = _tx, 'repeated request key returns the original transaction';
  ASSERT (SELECT balance FROM public.credit_accounts WHERE user_id = _target) = _bal_after,
         'duplicate submission credits nothing twice';

  ------------------------------------------------------------- input guards
  BEGIN
    PERFORM public.superadmin_issue_credits(_target, 0, 'zero');
    RAISE EXCEPTION 'zero must be refused';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'zero must be refused', 'zero refused';
  END;
  BEGIN
    PERFORM public.superadmin_issue_credits(_target, 10.5, 'fraction');
    RAISE EXCEPTION 'fraction must be refused';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'fraction must be refused', 'fractional refused';
  END;
  BEGIN
    PERFORM public.superadmin_issue_credits(_target, 10000001, 'overflow');
    RAISE EXCEPTION 'overflow must be refused';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'overflow must be refused', 'overflow refused';
  END;

  ------------------------------------------------------------ authorization
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _target)::text, true);
  BEGIN
    PERFORM public.superadmin_issue_credits(_target, 100, 'unauthorized issuance');
    RAISE EXCEPTION 'non-super-admin must not issue credits';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm <> 'non-super-admin must not issue credits',
           'issuance is platform-owner only';
  END;

  RAISE NOTICE 'super admin credit issuance checks passed';
END $$;

ROLLBACK;
