-- Duplicate GCash reference review.
--
-- "Credited first" must come from the real credit ledger entry, never from the
-- reference itself, the screenshot upload order or the review timestamp.
-- Run inside a transaction and roll back; nothing here is meant to persist.
begin;

do $$
declare _src public.cash_in_requests; _old uuid; _new uuid; _c public.cash_in_reference_conflicts;
        _key text := 'TESTDUP' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
begin
  select * into _src from public.cash_in_requests
   where status = 'approved' and ledger_id is not null order by created_at desc limit 1;
  if _src.id is null then raise exception 'no approved cash in to clone'; end if;

  -- OLD: already credited, carries a ledger entry.


  insert into public.cash_in_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
    amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
    method_id, method_name, method_type, payer_reference, payer_reference_key,
    payer_number, payer_number_key, sender_number, sender_number_key,
    proof_path, status, ledger_id, reviewed_at, reviewer_name, approval_method,
    receipt_reference, receipt_reference_key, receipt_check)
  values ('CI-TESTOLD', gen_random_uuid()::text, _src.user_id, _src.ecosystem_id, _src.requester_name, 'customer',
          100, _src.rate_credits, _src.rate_php, 100, 0, 0, 100,
          _src.method_id, _src.method_name, _src.method_type, _key, _key,
          '09541230072', '09541230072', '09541230072', '09541230072',
          'proof/old.jpg', 'approved', _src.ledger_id, now(), 'Owner', 'manual',
          _key, _key, 'matched')
  returning id into _old;

  -- NEW: same reference, nothing credited.
  insert into public.cash_in_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
    amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
    method_id, method_name, method_type, payer_reference, payer_reference_key,
    payer_number, payer_number_key, sender_number, sender_number_key,
    proof_path, status, duplicate_reference, duplicate_of, receipt_check)
  values ('CI-TESTNEW', gen_random_uuid()::text, _src.user_id, _src.ecosystem_id, _src.requester_name, 'customer',
          100, _src.rate_credits, _src.rate_php, 100, 0, 0, 100,
          _src.method_id, _src.method_name, _src.method_type, _key, _key,
          '09541230072', '09541230072', '09541230072', '09541230072',
          'proof/new.jpg', 'pending', true, _old, 'pending')
  returning id into _new;

  perform public.record_cash_in_reference_conflict(_new);
  select * into _c from public.cash_in_reference_conflicts where new_request_id = _new;

  if _c.id is null then raise exception 'FAIL: no conflict record created'; end if;
  if _c.credited_first <> 'old' then raise exception 'FAIL: credited_first = %', _c.credited_first; end if;
  if _c.credited_at is null then raise exception 'FAIL: credited_at not taken from the ledger'; end if;
  if (_c.old_snapshot->>'credits_released')::boolean is not true then
    raise exception 'FAIL: old snapshot does not show released credits';
  end if;
  if (_c.new_snapshot->>'credits_released')::boolean is not false then
    raise exception 'FAIL: new snapshot must not show released credits';
  end if;
  if (select status from public.cash_in_requests where id = _old) <> 'approved' then
    raise exception 'FAIL: the older transaction was modified';
  end if;
  if (select status from public.cash_in_requests where id = _new) <> 'pending' then
    raise exception 'FAIL: the newer transaction must stay pending';
  end if;
  raise notice 'PASS: older credited transaction marked CREDITED FIRST, newer held pending';

  -- Neither credited: nothing may be assumed.
  update public.cash_in_requests set ledger_id = null, status = 'pending' where id = _old;
  perform public.record_cash_in_reference_conflict(_new);
  select * into _c from public.cash_in_reference_conflicts where new_request_id = _new;
  if _c.credited_first <> 'none' then raise exception 'FAIL: expected none, got %', _c.credited_first; end if;
  raise notice 'PASS: with no credits released neither side is assumed legitimate';
end $$;

rollback;
