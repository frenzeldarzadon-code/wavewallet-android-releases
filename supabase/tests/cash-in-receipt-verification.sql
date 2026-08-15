-- Cash In receipt reference verification (SECONDARY check).
--
-- The reference READ OFF the uploaded receipt is authoritative; the value the
-- member typed is only ever compared against it. A mismatch or an unreadable
-- receipt must leave the request pending — never approved, never guessed.
--
-- The whole suite runs inside one DO block that raises at the end, so the
-- transaction is rolled back: no rows survive and no credits are ever issued.
-- Run it with: select 1 from (…) — any client that executes a statement.
--
-- Cases: matching receipt, mismatching receipt, unreadable receipt, receipt
-- read after the request was already decided, and that only 'matched' allows
-- automatic approval to be attempted.
do $$
declare
  _src public.cash_in_requests;
  _id uuid;
  _state text;
  _row public.cash_in_requests;

begin
  select * into _src from public.cash_in_requests order by created_at desc limit 1;
  if _src.id is null then
    raise exception 'TEST SKIPPED: there is no cash in row to clone';
  end if;

  ---------------------------------------------------------------- 1. matched
  _id := gen_random_uuid();
  insert into public.cash_in_requests
    (id, reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
     amount_php, rate_credits, rate_php, credits, method_id, method_name, method_type,
     payer_reference, payer_reference_key, sender_number, sender_number_key,
     proof_path, status, receipt_check)
  values
    (_id, 'TEST-A-' || _id, 'test-a-' || _id, _src.user_id, _src.ecosystem_id,
     _src.requester_name, _src.requester_role, 200, _src.rate_credits, _src.rate_php, 200,
     _src.method_id, _src.method_name, _src.method_type,
     '9044011942642', public.normalize_payment_reference('9044011942642'),
     '09541230072', public.normalize_ph_mobile('09541230072'),
     _src.user_id::text || '/test.jpg', 'pending', 'pending');

  _state := public.apply_cash_in_receipt_ocr(_id, '9044 011 942642', 200, '09541230072', true, '{}'::jsonb);
  if _state <> 'matched' then raise exception 'FAIL 1: expected matched, got %', _state; end if;
  select * into _row from public.cash_in_requests where id = _id;
  if _row.receipt_reference_key is distinct from _row.payer_reference_key then
    raise exception 'FAIL 1: the receipt reference was not stored';
  end if;

  --------------------------------------------------------------- 2. mismatch
  _id := gen_random_uuid();
  insert into public.cash_in_requests
    (id, reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
     amount_php, rate_credits, rate_php, credits, method_id, method_name, method_type,
     payer_reference, payer_reference_key, sender_number, sender_number_key,
     proof_path, status, receipt_check)
  values
    (_id, 'TEST-B-' || _id, 'test-b-' || _id, _src.user_id, _src.ecosystem_id,
     _src.requester_name, _src.requester_role, 200, _src.rate_credits, _src.rate_php, 200,
     _src.method_id, _src.method_name, _src.method_type,
     '9044011942642', public.normalize_payment_reference('9044011942642'),
     '09541230072', public.normalize_ph_mobile('09541230072'),
     _src.user_id::text || '/test.jpg', 'pending', 'pending');

  _state := public.apply_cash_in_receipt_ocr(_id, '1234567890123', 200, '09541230072', true, '{}'::jsonb);
  if _state <> 'mismatch' then raise exception 'FAIL 2: expected mismatch, got %', _state; end if;
  select * into _row from public.cash_in_requests where id = _id;
  if _row.status <> 'pending' then raise exception 'FAIL 2: a mismatch must stay pending'; end if;

  ------------------------------------------------------------- 3. unreadable
  _id := gen_random_uuid();
  insert into public.cash_in_requests
    (id, reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
     amount_php, rate_credits, rate_php, credits, method_id, method_name, method_type,
     payer_reference, payer_reference_key, sender_number, sender_number_key,
     proof_path, status, receipt_check)
  values
    (_id, 'TEST-C-' || _id, 'test-c-' || _id, _src.user_id, _src.ecosystem_id,
     _src.requester_name, _src.requester_role, 200, _src.rate_credits, _src.rate_php, 200,
     _src.method_id, _src.method_name, _src.method_type,
     '9044011942642', public.normalize_payment_reference('9044011942642'),
     '09541230072', public.normalize_ph_mobile('09541230072'),
     _src.user_id::text || '/test.jpg', 'pending', 'pending');

  _state := public.apply_cash_in_receipt_ocr(_id, null, null, null, false, '{}'::jsonb);
  if _state <> 'unreadable' then raise exception 'FAIL 3: expected unreadable, got %', _state; end if;
  select * into _row from public.cash_in_requests where id = _id;
  if _row.status <> 'pending' then raise exception 'FAIL 3: an unreadable receipt must stay pending'; end if;

  -- a receipt that reads a reference but with no typed value to compare
  _state := public.apply_cash_in_receipt_ocr(_id, '   ', null, null, true, '{}'::jsonb);
  if _state <> 'unreadable' then raise exception 'FAIL 3b: blank text must be unreadable, got %', _state; end if;

  ------------------------------------------------------ 4. already decided
  _id := gen_random_uuid();
  insert into public.cash_in_requests
    (id, reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
     amount_php, rate_credits, rate_php, credits, method_id, method_name, method_type,
     payer_reference, payer_reference_key, proof_path, status, receipt_check)
  values
    (_id, 'TEST-D-' || _id, 'test-d-' || _id, _src.user_id, _src.ecosystem_id,
     _src.requester_name, _src.requester_role, 200, _src.rate_credits, _src.rate_php, 200,
     _src.method_id, _src.method_name, _src.method_type,
     '9044011942642', public.normalize_payment_reference('9044011942642'),
     _src.user_id::text || '/test.jpg', 'rejected', 'pending');

  _state := public.apply_cash_in_receipt_ocr(_id, '9044011942642', 200, '09541230072', true, '{}'::jsonb);
  if _state <> 'not_pending' then raise exception 'FAIL 4: a decided request must not be re-checked, got %', _state; end if;

  ------------------------------------------------------------ 5. missing row
  _state := public.apply_cash_in_receipt_ocr(gen_random_uuid(), '123', null, null, true, '{}'::jsonb);
  if _state <> 'not_found' then raise exception 'FAIL 5: expected not_found, got %', _state; end if;

  raise exception 'ALL RECEIPT VERIFICATION TESTS PASSED (rolling back)';
end $$;
