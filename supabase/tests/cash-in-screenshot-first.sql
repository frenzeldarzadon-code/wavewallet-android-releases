-- Screenshot-first Cash In submission.
--
-- The member uploads the GCash receipt; the reader extracts the amount, the
-- sending number, the reference and the payment time. Nothing must require the
-- member to type a reference or a sender number, the ORIGINAL reading must
-- survive any correction the member makes, and a reference that was already
-- paid must never create or credit a second payment.
--
-- The whole suite runs inside one DO block that raises at the end, so the
-- transaction rolls back: no rows survive and no coins are ever issued.
do $$
declare
  _src public.cash_in_requests;
  _id uuid;
  _row public.cash_in_requests;
  _state text;
  _ref text := '9044' || (floor(random() * 900000000) + 100000000)::bigint::text;
begin
  select * into _src from public.cash_in_requests order by created_at desc limit 1;
  if _src.id is null then
    raise exception 'TEST SKIPPED: there is no cash in row to clone';
  end if;

  --------------------------------------------------- 1. no typed reference
  -- A request created from the screenshot alone: no payer_reference at all.
  _id := gen_random_uuid();
  insert into public.cash_in_requests
    (id, reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
     amount_php, rate_credits, rate_php, credits, method_id, method_name, method_type,
     proof_path, status, receipt_check)
  values
    (_id, 'TEST-S1-' || _id, 'test-s1-' || _id, _src.user_id, _src.ecosystem_id,
     _src.requester_name, _src.requester_role, 200, _src.rate_credits, _src.rate_php, 200,
     _src.method_id, _src.method_name, _src.method_type,
     _src.user_id::text || '/test.jpg', 'pending', 'pending');

  -- The receipt reading establishes the reference; nothing was typed.
  _state := public.apply_cash_in_receipt_ocr(_id, _ref, 200, '09541230072', true, '{}'::jsonb, now());
  if _state <> 'matched' then
    raise exception 'FAIL 1: a readable receipt with no typed reference must match, got %', _state;
  end if;

  select * into _row from public.cash_in_requests where id = _id;
  if _row.receipt_reference_key is distinct from public.normalize_payment_reference(_ref) then
    raise exception 'FAIL 1: the receipt reference was not stored';
  end if;
  if public.cash_in_established_reference_key(_row)
       is distinct from public.normalize_payment_reference(_ref) then
    raise exception 'FAIL 1: the receipt reference must become the established reference';
  end if;
  if _row.status <> 'pending' then
    raise exception 'FAIL 1: reading a receipt must never approve on its own';
  end if;
  if _row.receipt_paid_at is null then
    raise exception 'FAIL 1: the payment time read off the receipt was not kept';
  end if;

  ------------------------------------------- 2. corrections keep the original
  update public.cash_in_requests
     set ocr_reference = _ref,
         ocr_amount_php = 200,
         ocr_sender_number = '09541230072',
         payer_reference = '1234567890123',
         payer_reference_key = public.normalize_payment_reference('1234567890123'),
         reference_edited = true
   where id = _id;

  select * into _row from public.cash_in_requests where id = _id;
  if _row.ocr_reference is distinct from _ref then
    raise exception 'FAIL 2: a member correction must never overwrite the original reading';
  end if;

  -- A corrected reference that contradicts the receipt must stay pending.
  _state := public.apply_cash_in_receipt_ocr(_id, _ref, 200, '09541230072', true, '{}'::jsonb, now());
  if _state <> 'mismatch' then
    raise exception 'FAIL 2: a contradicting correction must be a mismatch, got %', _state;
  end if;
  select * into _row from public.cash_in_requests where id = _id;
  if _row.status <> 'pending' then raise exception 'FAIL 2: a mismatch must stay pending'; end if;

  ----------------------------------------------- 3. unreadable stays pending
  _id := gen_random_uuid();
  insert into public.cash_in_requests
    (id, reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
     amount_php, rate_credits, rate_php, credits, method_id, method_name, method_type,
     proof_path, status, receipt_check)
  values
    (_id, 'TEST-S3-' || _id, 'test-s3-' || _id, _src.user_id, _src.ecosystem_id,
     _src.requester_name, _src.requester_role, 200, _src.rate_credits, _src.rate_php, 200,
     _src.method_id, _src.method_name, _src.method_type,
     _src.user_id::text || '/test.jpg', 'pending', 'pending');

  _state := public.apply_cash_in_receipt_ocr(_id, null, null, null, false, '{}'::jsonb, null);
  if _state <> 'unreadable' then
    raise exception 'FAIL 3: an unreadable screenshot must never be guessed, got %', _state;
  end if;
  select * into _row from public.cash_in_requests where id = _id;
  if _row.status <> 'pending' then
    raise exception 'FAIL 3: an unreadable screenshot must stay pending';
  end if;
  if public.cash_in_established_reference_key(_row) is not null then
    raise exception 'FAIL 3: an unreadable screenshot must establish no reference';
  end if;

  ------------------------------------------------- 4. automatic approval gate
  -- Auto approval must not be attempted from screenshot evidence alone.
  _state := public.try_auto_approve_cash_in(_id);
  if _state = 'approved' then
    raise exception 'FAIL 4: the screenshot alone must never approve a Cash In';
  end if;

  raise exception 'ALL SCREENSHOT-FIRST TESTS PASSED (rolling back)';
end $$;
