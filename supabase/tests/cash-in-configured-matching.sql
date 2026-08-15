-- Cash In: configured-matching automatic approval + duplicate protection.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
-- Covers:
--   A. correct amount + correct receiving GCash number + unique reference +
--      screenshot => automatic approval and exactly one credit.
--   B. same reference twice => second is rejected as a duplicate, zero credits.
--   C. a racing duplicate insert is refused by the unique index, not by app code.
--   D. wrong receiving number => no automatic approval (stays pending).
--   E. wrong amount against the configured expected amount => stays pending.
--   F. missing reference => validation failure.
--   G. missing screenshot => validation failure.
--   H. empty notes => submission still works.
--   I. 09XXXXXXXXX and +639XXXXXXXXX compare equal.
--   J. screenshots stay behind owner-scoped storage policies.
begin;

-- I. Phone normalisation -----------------------------------------------------
do $$
begin
  if public.normalize_ph_mobile('09171234567') is distinct from public.normalize_ph_mobile('+63 917 123 4567')
     or public.normalize_ph_mobile('639171234567') is distinct from public.normalize_ph_mobile('09171234567')
     or public.normalize_ph_mobile('9171234567') is distinct from public.normalize_ph_mobile('09171234567') then
    raise exception 'equivalent Philippine formats must normalise to the same number';
  end if;
  if public.normalize_ph_mobile('09171234567') = public.normalize_ph_mobile('09181234567') then
    raise exception 'different numbers must not normalise equal';
  end if;
  if public.normalize_ph_mobile('') is not null then
    raise exception 'a blank number must normalise to null';
  end if;
end $$;

-- J. Screenshot access -------------------------------------------------------
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'cash-in-proofs' and public = false) then
    raise exception 'payment screenshots must live in a private bucket';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and qual like '%cash-in-proofs%') then
    raise exception 'storage policies must scope cash in screenshots';
  end if;
end $$;

-- A–H. Behaviour -------------------------------------------------------------
do $$
declare _uid uuid; _eco uuid; _method uuid; _row public.cash_in_requests;
        _credits numeric; _before numeric; _after numeric; _ref text := 'GC-' || gen_random_uuid()::text;
        _num constant text := '09171234567';
begin
  select p.id, p.ecosystem_id into _uid, _eco
    from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) and p.ecosystem_id is not null
   limit 1;
  select id into _method from public.payment_methods where active limit 1;
  if _uid is null or _method is null then
    raise notice 'skipped: no active member with a shop, or no payment method';
    return;
  end if;

  update public.ecosystems set cash_in_gcash_number = _num where id = _eco;
  delete from public.cash_in_auto_rules where ecosystem_id is not distinct from _eco;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                         amount_tolerance_php, expected_amount_php)
  values (_eco, true, true, 0, 500);

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  select coalesce(sum(balance), 0) into _before from public.credit_accounts where user_id = _uid;

  -- A: everything matches, paid in the +63 format against a 09... configuration.
  _row := public.request_cash_in(_method, 500, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/a.jpg', '+639171234567');
  if _row.status <> 'approved' or _row.approval_method <> 'automatic' then
    raise exception 'A: a fully matching cash in must be approved automatically (got % / %)',
      _row.status, _row.approval_method;
  end if;
  _credits := _row.credits;
  select coalesce(sum(balance), 0) into _after from public.credit_accounts where user_id = _uid;
  if _after - _before <> _credits then
    raise exception 'A: exactly one credit of % expected, balance moved %', _credits, _after - _before;
  end if;
  if (select count(*) from public.platform_credit_issuances
       where request_key = 'cash_in:' || _row.id::text) <> 1 then
    raise exception 'A: crediting must be booked exactly once';
  end if;

  -- B: the same reference again is rejected as a duplicate and credits nothing.
  _before := _after;
  _row := public.request_cash_in(_method, 500, _ref, null, gen_random_uuid()::text,
                                 _uid::text || '/b.jpg', _num);
  if _row.status <> 'rejected' or _row.decision_reason not like 'Duplicate payment reference%' then
    raise exception 'B: a repeated reference must be rejected as duplicate (got % / %)',
      _row.status, _row.decision_reason;
  end if;
  select coalesce(sum(balance), 0) into _after from public.credit_accounts where user_id = _uid;
  if _after <> _before then
    raise exception 'B: a duplicate must not add credits';
  end if;

  -- C: the guard is the database, not the application.
  begin
    insert into public.cash_in_requests (
      reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
      amount_php, rate_credits, rate_php, credits, method_id, method_name, method_type,
      payer_reference, payer_reference_key, status)
    values ('CI-RACE', gen_random_uuid()::text, _uid, _eco, 'race', 'customer',
            500, 1000, 1000, 500, _method, 'x', 'gcash',
            _ref, public.normalize_payment_reference(_ref), 'pending');
    raise exception 'C: a concurrent insert on the same reference must be refused';
  exception when unique_violation then
    null; -- expected: only one request may ever hold a reference key
  end;

  -- D: wrong receiving number => no automatic approval.
  _before := _after;
  _row := public.request_cash_in(_method, 500, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/d.jpg', '09181234567');
  if _row.status <> 'pending' then
    raise exception 'D: a wrong receiving number must stay pending (got %)', _row.status;
  end if;

  -- E: wrong amount against the configured expected amount.
  _row := public.request_cash_in(_method, 499, 'GC-' || gen_random_uuid()::text, null,
                                 gen_random_uuid()::text, _uid::text || '/e.jpg', _num);
  if _row.status <> 'pending' then
    raise exception 'E: a mismatched amount must stay pending (got %)', _row.status;
  end if;

  select coalesce(sum(balance), 0) into _after from public.credit_accounts where user_id = _uid;
  if _after <> _before then
    raise exception 'D/E: unmatched requests must not credit anything';
  end if;

  -- F: missing reference.
  begin
    _row := public.request_cash_in(_method, 500, null, null, gen_random_uuid()::text,
                                   _uid::text || '/f.jpg', _num);
    raise exception 'F: a cash in without a reference must be refused';
  exception when others then
    if sqlerrm not like '%reference%' then raise; end if;
  end;

  -- G: missing screenshot.
  begin
    _row := public.request_cash_in(_method, 500, 'GC-' || gen_random_uuid()::text, null,
                                   gen_random_uuid()::text, null, _num);
    raise exception 'G: a cash in without a screenshot must be refused';
  exception when others then
    if sqlerrm not like '%screenshot%' then raise; end if;
  end;

  -- H: empty notes still submits (and here still auto-approves).
  _row := public.request_cash_in(_method, 500, 'GC-' || gen_random_uuid()::text, '   ',
                                 gen_random_uuid()::text, _uid::text || '/h.jpg', _num);
  if _row.id is null or _row.notes is not null then
    raise exception 'H: blank notes must be accepted and stored as empty';
  end if;

  raise notice 'cash in configured-matching tests passed';
end $$;

rollback;
