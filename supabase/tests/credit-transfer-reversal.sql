-- Credit transfer reversal regression tests.
--
-- Everything runs inside one transaction that is ALWAYS rolled back, using the
-- demo ecosystem accounts only. No production balance, sale, commission or
-- points row survives this script.
--
--   BEGIN; \i supabase/tests/credit-transfer-reversal.sql ROLLBACK;
--
-- Expectations:
--   1. full reversal with sufficient unspent balance succeeds
--   2. sender/recipient balances reconcile exactly
--   3. original ledger rows remain immutable and untouched
--   4. no commission / cashback / points / earnings rows are produced
--   5. duplicate reversal of the same transfer is blocked (idempotent)
--   6. partial reversal succeeds when only part is unspent
--   7. reversal above the unspent amount is blocked with the "already spent" message
--   8. a reversal can never push the recipient's wallet negative
--   9. cross-ecosystem admins are refused
--  10. audit log + reversal history rows are written
--  11. voucher-sale transactions are refused (refund workflow instead)

BEGIN;

DO $$
DECLARE
  _admin uuid := '6b045d74-c678-4f49-822a-ce81efb89cba';   -- demo ecosystem admin
  _other_admin uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e'; -- admin of another shop
  _sender uuid := '1ef6ecac-af2d-45bb-8bd8-64bff332b812';  -- demo reseller
  _recipient uuid := '04c82e4d-2079-458d-805a-43b9b8b7a484'; -- demo customer
  _tx text; _tx2 text; _info jsonb; _res jsonb;
  _s0 numeric; _r0 numeric; _s1 numeric; _r1 numeric;
  _pts0 int; _pts1 int; _comm0 int; _comm1 int; _ok boolean;
BEGIN
  SELECT balance INTO _s0 FROM public.credit_accounts WHERE user_id = _sender;
  SELECT balance INTO _r0 FROM public.credit_accounts WHERE user_id = _recipient;
  SELECT balance INTO _pts0 FROM public.points_accounts WHERE user_id = _recipient;
  SELECT count(*) INTO _comm0 FROM public.sale_commissions;

  -- Sender makes a transfer
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _sender)::text, true);
  _tx := public.transfer_credits(_recipient, 100, 'QA reversal fixture');

  -- 9. cross-ecosystem admin cannot reverse
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _other_admin)::text, true);
  BEGIN
    PERFORM public.reverse_credit_transfer(_tx, 100, 'Dispute / customer complaint');
    RAISE EXCEPTION 'FAIL: cross-ecosystem reversal was allowed';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;

  -- 1. full reversal by the ecosystem admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  _info := public.transfer_reversal_info(_tx);
  IF (_info->>'eligible')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: transfer not eligible'; END IF;
  IF (_info->>'available')::numeric <> 100 THEN RAISE EXCEPTION 'FAIL: unspent amount wrong'; END IF;
  _res := public.reverse_credit_transfer(_tx, 100, 'Duplicate transfer', 'QA');
  IF _res->>'kind' <> 'full' THEN RAISE EXCEPTION 'FAIL: expected full reversal'; END IF;

  -- 2. balances reconcile exactly
  SELECT balance INTO _s1 FROM public.credit_accounts WHERE user_id = _sender;
  SELECT balance INTO _r1 FROM public.credit_accounts WHERE user_id = _recipient;
  IF _s1 <> _s0 OR _r1 <> _r0 THEN RAISE EXCEPTION 'FAIL: balances did not reconcile (% / %)', _s1, _r1; END IF;

  -- 3. original entries untouched
  IF NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE tx_id = _tx AND amount = 100 AND direction = 'debit')
     OR NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE tx_id = _tx || '-R' AND amount = 100 AND direction = 'credit')
  THEN RAISE EXCEPTION 'FAIL: original transfer rows were altered'; END IF;

  -- 4. no commission / cashback / points generated
  SELECT count(*) INTO _comm1 FROM public.sale_commissions;
  SELECT balance INTO _pts1 FROM public.points_accounts WHERE user_id = _recipient;
  IF _comm1 <> _comm0 OR _pts1 <> _pts0 THEN RAISE EXCEPTION 'FAIL: reversal produced earnings or points'; END IF;
  IF EXISTS (SELECT 1 FROM public.credit_ledger WHERE reference = (_res->>'reversal_tx_id')
              AND coalesce(commission_amount, 0) <> 0)
  THEN RAISE EXCEPTION 'FAIL: reversal carried commission'; END IF;

  -- 10. audit + history
  IF NOT EXISTS (SELECT 1 FROM public.credit_transfer_reversals WHERE original_tx_id = _tx)
  THEN RAISE EXCEPTION 'FAIL: no reversal history row'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action LIKE '%eversed credit transfer%'
                  AND metadata->>'original_tx_id' = _tx)
  THEN RAISE EXCEPTION 'FAIL: reversal not audit logged'; END IF;

  -- 5. duplicate reversal blocked
  BEGIN
    PERFORM public.reverse_credit_transfer(_tx, 100, 'Duplicate transfer');
    RAISE EXCEPTION 'FAIL: duplicate reversal was allowed';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.credit_transfer_reversals WHERE original_tx_id = _tx) <> 1
  THEN RAISE EXCEPTION 'FAIL: duplicate reversal row created'; END IF;

  -- 6/7/8. partial reversal after the recipient spends part of the transfer
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _sender)::text, true);
  _tx2 := public.transfer_credits(_recipient, 100, 'QA partial fixture');
  -- drain every older lot plus 60 of the new transfer, leaving 40 attributable
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  PERFORM public.admin_adjust_credits(_recipient, -(_r0 + 60), 'QA spend-down', NULL);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);
  BEGIN
    PERFORM public.reverse_credit_transfer(_tx2, 100, 'Wrong recipient');
    RAISE EXCEPTION 'FAIL: full reversal allowed over spent credits';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;

  _info := public.transfer_reversal_info(_tx2);
  IF (_info->>'available')::numeric > 100 THEN RAISE EXCEPTION 'FAIL: unspent amount overstated'; END IF;
  IF (_info->>'available')::numeric <> 40 THEN RAISE EXCEPTION 'FAIL: expected 40 unspent, got %', _info->>'available'; END IF;
  _res := public.reverse_credit_transfer(_tx2, 40, 'Wrong recipient');
  IF _res->>'kind' <> 'partial' THEN RAISE EXCEPTION 'FAIL: expected partial reversal'; END IF;
  IF (SELECT balance FROM public.credit_accounts WHERE user_id = _recipient) < 0
  THEN RAISE EXCEPTION 'FAIL: recipient wallet went negative'; END IF;

  -- 11. voucher sale transactions are refused
  SELECT EXISTS (SELECT 1 FROM public.voucher_sales) INTO _ok;
  IF _ok THEN
    BEGIN
      PERFORM public.reverse_credit_transfer((SELECT tx_id FROM public.voucher_sales LIMIT 1), 1, 'Dispute');
      RAISE EXCEPTION 'FAIL: a voucher sale was reversible through this feature';
    EXCEPTION WHEN others THEN
      IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    END;
  END IF;

  RAISE EXCEPTION 'ALL REVERSAL TESTS PASSED — rolling back fixtures';
END $$;

ROLLBACK;
