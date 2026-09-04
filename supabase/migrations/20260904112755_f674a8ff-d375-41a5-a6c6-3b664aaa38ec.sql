-- ---------------------------------------------------------------------------
-- Mandatory receiving-account protection layer for Cash In.
-- Source of truth for the expected (payee) account: existing saved payment
-- details — payment_methods.account_number (method chosen on the request) and
-- ecosystems.cash_in_gcash_number (legacy shop number). No new config table.
-- ---------------------------------------------------------------------------

alter table public.payment_match_records drop constraint if exists payment_match_records_decision_check;
alter table public.payment_match_records add constraint payment_match_records_decision_check
  check (decision = any (array['auto_approved','staged','manual_approved','duplicate_rejected','receiver_mismatch_rejected']));

-- Does an account value seen on evidence (full or masked) agree with a configured account?
create or replace function public.payment_account_matches(_evidence text, _configured text)
returns boolean
language sql immutable set search_path to 'public'
as $$
  with e as (
    select
      case when coalesce(_evidence, '') ~ '[*xX•#]'
           then (regexp_match(coalesce(_evidence, ''), '([0-9]{3,})[^0-9]*$'))[1]
           else regexp_replace(coalesce(_evidence, ''), '[^0-9]', '', 'g') end as ev,
      regexp_replace(coalesce(_configured, ''), '[^0-9]', '', 'g') as conf
  )
  select case
    when coalesce(e.ev, '') = '' or e.conf = '' then false
    when public.normalize_ph_mobile(e.ev) = public.normalize_ph_mobile(e.conf) then true
    when length(e.ev) >= 3 and length(e.ev) <= length(e.conf) and right(e.conf, length(e.ev)) = e.ev then true
    else false end
  from e
$$;

-- Every receiving account the responsible Admin / Super Admin saved for this destination.
create or replace function public.cash_in_expected_receiving_accounts(_row public.cash_in_requests)
returns table(source text, label text, account text)
language sql stable security definer set search_path to 'public'
as $$
  select * from (
    select 'method'::text, coalesce(m.label, m.name), nullif(trim(m.account_number), '')
      from public.payment_methods m where m.id = _row.method_id
    union
    select 'shop_legacy', 'Shop receiving number', nullif(trim(e.cash_in_gcash_number), '')
      from public.ecosystems e where e.id = _row.ecosystem_id and _row.method_id is null
    union
    select 'shop_method', coalesce(m.label, m.name), nullif(trim(m.account_number), '')
      from public.payment_methods m
     where _row.method_id is null and _row.ecosystem_id is not null and m.ecosystem_id = _row.ecosystem_id and m.active
    union
    select 'platform_method', coalesce(m.label, m.name), nullif(trim(m.account_number), '')
      from public.payment_methods m
     where _row.method_id is null and _row.ecosystem_id is null and m.ecosystem_id is null and m.active
  ) x(source, label, account)
  where x.account is not null
$$;

-- Receiver-account check. Only RECEIVER-side fields are compared: the receipt's
-- "Sent to / Paid to" account and the notification's "Received by" account.
-- The payer's own account ("Paid from" / "Received from") is never used here.
create or replace function public.cash_in_receiver_account_check(_row public.cash_in_requests, _ev public.listener_events)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare _expected jsonb; _n int; _r_vals text[]; _n_vals text[]; _v text;
        _r_match boolean := null; _n_match boolean := null; _status text; _source text;
begin
  select jsonb_agg(jsonb_build_object('source', a.source, 'label', a.label,
                                      'masked', '····' || public.payment_account_tail(a.account))), count(*)
    into _expected, _n
    from public.cash_in_expected_receiving_accounts(_row) a;
  if coalesce(_n, 0) = 0 then
    return jsonb_build_object('status', 'not_configured', 'expected', '[]'::jsonb);
  end if;

  _r_vals := array_remove(array[nullif(btrim(coalesce(_row.receipt_receiving_number, '')), ''),
                                nullif(btrim(coalesce(_row.receipt_receiving_account_masked, '')), '')], null);
  if _ev.id is not null then
    _n_vals := array_remove(array[nullif(btrim(coalesce(_ev.details->>'receiving_account', '')), ''),
                                  nullif(btrim(coalesce(_ev.details->>'receiving_number', '')), '')], null);
  end if;

  if coalesce(array_length(_r_vals, 1), 0) > 0 then
    _r_match := exists (select 1 from unnest(_r_vals) v, public.cash_in_expected_receiving_accounts(_row) a
                         where public.payment_account_matches(v, a.account));
  end if;
  if coalesce(array_length(_n_vals, 1), 0) > 0 then
    _n_match := exists (select 1 from unnest(_n_vals) v, public.cash_in_expected_receiving_accounts(_row) a
                         where public.payment_account_matches(v, a.account));
  end if;

  if _r_match is false and _n_match is true or _r_match is true and _n_match is false then
    _status := 'conflict';
  elsif _r_match is false or _n_match is false then
    _status := 'mismatch';
  elsif _r_match is true or _n_match is true then
    _status := 'matched';
  else
    _status := 'absent';
  end if;
  _source := case when _r_match and _n_match then 'both' when _r_match then 'receipt' when _n_match then 'notification' end;

  return jsonb_build_object(
    'status', _status,
    'matched_source', _source,
    'receipt', jsonb_build_object('label', 'Sent to / Paid to', 'value', _r_vals[1], 'matches', _r_match),
    'notification', jsonb_build_object('label', 'Received by', 'value', _n_vals[1], 'matches', _n_match),
    'expected', _expected,
    'note', 'The expected account is the configured RECEIVER (payee) account for this destination. Direction wording is normalised: the payer''s own account is never compared here.');
end $$;

-- Disapproval helper now distinguishes receiver-account rejections from duplicates.
create or replace function public.auto_disapprove_cash_in(_id uuid, _reason text, _duplicate_of uuid default null, _kind text default 'duplicate')
returns public.cash_in_requests
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.cash_in_requests; _provider text;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then raise exception 'Cash in request not found'; end if;
  if _row.status <> 'pending' then return _row; end if;

  update public.cash_in_requests
     set status = 'rejected', reviewed_by = null, reviewer_name = 'Automatic verification',
         decision_reason = _reason, reviewed_at = now(), approval_method = 'automatic',
         duplicate_receipt = case when _kind = 'duplicate_receipt' then true else duplicate_receipt end,
         duplicate_receipt_of = coalesce(duplicate_receipt_of, case when _kind = 'duplicate_receipt' then _duplicate_of end),
         duplicate_reference = case when _kind = 'duplicate_reference' then true else duplicate_reference end,
         duplicate_of = coalesce(duplicate_of, case when _kind = 'duplicate_reference' then _duplicate_of end),
         authentication_reason = _reason, authentication_checked_at = now(),
         payment_authenticated = false
   where id = _id returning * into _row;

  _provider := coalesce(_row.provider_id, 'gcash');
  begin
    perform public.record_payment_match(_row.id,
              case when _kind = 'receiver_mismatch' then 'receiver_mismatch_rejected' else 'duplicate_rejected' end,
              _provider, null);
  exception when others then null;
  end;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic verification',
          case when _kind = 'receiver_mismatch' then 'Disapproved cash in: receiving account mismatch'
               else 'Disapproved duplicate cash in' end,
          _row.requester_name,
          jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                             'kind', _kind, 'duplicate_of', _duplicate_of,
                             'reference', _row.reference, 'requester_id', _row.user_id,
                             'proof_hash', _row.proof_hash,
                             'reference_key', coalesce(_row.receipt_reference_key, _row.payer_reference_key),
                             'listener_event_id', _row.listener_event_id, 'reason', _reason,
                             'receiver_account_check', case when _kind = 'receiver_mismatch'
                               then public.cash_in_receiver_account_check(_row,
                                      (select e from public.listener_events e where e.id = _row.listener_event_id)) end));
  return _row;
end $$;

-- Step 4 of the decision order: enforce the configured receiver account.
create or replace function public.cash_in_enforce_receiver_account(_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.cash_in_requests; _ev public.listener_events; _chk jsonb;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;
  if _row.listener_event_id is not null then
    select * into _ev from public.listener_events where id = _row.listener_event_id;
  end if;
  _chk := public.cash_in_receiver_account_check(_row, _ev);
  if _chk->>'status' in ('mismatch', 'conflict') then
    perform public.auto_disapprove_cash_in(_row.id,
      'Disapproved: the payment was sent to an account that is not the configured receiving account for this '
      || case when _row.ecosystem_id is null then 'platform' else 'shop' end
      || ' cash in. The wallet was not credited.', null, 'receiver_mismatch');
    return 'rejected';
  end if;
  return _chk->>'status';
end $$;

revoke all on function public.cash_in_enforce_receiver_account(uuid) from public, anon, authenticated;
revoke all on function public.cash_in_receiver_account_check(public.cash_in_requests, public.listener_events) from public, anon, authenticated;
revoke all on function public.cash_in_expected_receiving_accounts(public.cash_in_requests) from public, anon, authenticated;

-- Receipt OCR: receiver check runs right after the receipt is stored, BEFORE the duplicate check.
create or replace function public.apply_cash_in_receipt_ocr(_id uuid, _reference text default null, _amount numeric default null, _sender text default null, _readable boolean default true, _details jsonb default null, _paid_at timestamptz default null, _receiving text default null, _provider text default null, _sender_name text default null, _sender_account text default null, _receiving_account text default null, _proof_hash text default null)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.cash_in_requests; _key text; _state text; _other uuid; _prov text;
        _reuse uuid; _credited uuid; _hash text;
        _credited_reason constant text :=
          'Duplicate: this receipt (or its reference) was already used by a cash in that was credited. '
          || 'Disapproved automatically - the wallet was not credited a second time.';
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  _key := public.normalize_payment_reference(_reference);
  _prov := public.payment_provider_by_name(_provider);
  _hash := nullif(btrim(coalesce(_proof_hash, '')), '');

  if coalesce(_readable, false) is false or _key is null then
    _state := 'unreadable';
  elsif _row.payer_reference_key is null then
    _state := 'matched';
  elsif _key = _row.payer_reference_key then
    _state := 'matched';
  else
    _state := 'mismatch';
  end if;

  update public.cash_in_requests
     set receipt_reference = nullif(btrim(coalesce(_reference, '')), ''),
         receipt_reference_key = _key,
         receipt_amount_php = _amount,
         receipt_sender_number = coalesce(nullif(btrim(coalesce(_sender, '')), ''), receipt_sender_number),
         receipt_sender_number_key = coalesce(public.normalize_ph_mobile(_sender), receipt_sender_number_key),
         receipt_sender_name = coalesce(nullif(btrim(coalesce(_sender_name, '')), ''), receipt_sender_name),
         receipt_sender_account_masked = coalesce(nullif(btrim(coalesce(_sender_account, '')), ''), receipt_sender_account_masked),
         receipt_receiving_account_masked = coalesce(nullif(btrim(coalesce(_receiving_account, '')), ''), receipt_receiving_account_masked),
         receipt_receiving_number = coalesce(receipt_receiving_number, nullif(btrim(coalesce(_receiving, '')), '')),
         receipt_receiving_number_key = coalesce(receipt_receiving_number_key, public.normalize_ph_mobile(_receiving)),
         receipt_paid_at = coalesce(_paid_at, receipt_paid_at),
         receipt_check = _state,
         receipt_checked_at = now(),
         receipt_details = _details,
         proof_hash = coalesce(_hash, proof_hash),
         provider_id = coalesce(provider_id, _prov),
         provider_source = case when provider_id is null and _prov is not null then 'receipt' else provider_source end,
         ocr_reference = coalesce(ocr_reference, nullif(btrim(coalesce(_reference, '')), '')),
         ocr_reference_key = coalesce(ocr_reference_key, _key),
         ocr_amount_php = coalesce(ocr_amount_php, _amount),
         ocr_sender_number = coalesce(ocr_sender_number, nullif(btrim(coalesce(_sender, '')), '')),
         ocr_sender_number_key = coalesce(ocr_sender_number_key, public.normalize_ph_mobile(_sender)),
         ocr_paid_at = coalesce(ocr_paid_at, _paid_at),
         ocr_details = coalesce(ocr_details, _details),
         paid_at = coalesce(paid_at, _paid_at),
         sender_number = coalesce(sender_number, nullif(btrim(coalesce(_sender, '')), '')),
         sender_number_key = coalesce(sender_number_key, public.normalize_ph_mobile(_sender))
   where id = _id;
  select * into _row from public.cash_in_requests where id = _id;

  -- Step 4: configured receiver-account check comes before the duplicate check.
  if public.cash_in_enforce_receiver_account(_id) = 'rejected' then
    return 'receiving_mismatch_rejected';
  end if;

  -- Step 5: duplicate check.
  _credited := public.cash_in_credited_duplicate(_id, coalesce(_key, _row.payer_reference_key),
                                                 coalesce(_hash, _row.proof_hash),
                                                 coalesce(_row.provider_id, _prov, 'gcash'));
  if _credited is not null then
    perform public.auto_disapprove_cash_in(_id, _credited_reason, _credited,
              case when _hash is not null and exists (select 1 from public.cash_in_requests c
                                                        where c.id = _credited and c.proof_hash = _hash)
                   then 'duplicate_receipt' else 'duplicate_reference' end);
    return 'duplicate_credited';
  end if;

  if coalesce(_hash, _row.proof_hash) is not null then
    select c.id into _reuse from public.cash_in_requests c
     where c.proof_hash = coalesce(_hash, _row.proof_hash) and c.id <> _id and c.status = 'pending'
     order by c.created_at asc limit 1;
    if _reuse is not null then
      update public.cash_in_requests set duplicate_receipt_of = coalesce(duplicate_receipt_of, _reuse)
       where id = _id;
    end if;
  end if;

  if _state = 'matched' then
    _other := public.cash_in_reference_duplicate(_id, _key, _paid_at);
    if _other is not null then
      update public.cash_in_requests set duplicate_of = coalesce(duplicate_of, _other) where id = _id;
      perform public.record_cash_in_reference_conflict(_id);
    end if;
  end if;
  perform public.reconcile_cash_in(_id);
  return _state;
end $$;

-- Automatic approval: receiver check first (disapprove), then duplicates, then the 2-signal rule.
create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.cash_in_requests; _rule record; _recv text; _note text; _sender text;
        _ev public.listener_events; _receipt text; _refkey text; _paid timestamptz;
        _provider text; _hash text; _credited uuid; _rchk jsonb;
        _credited_reason constant text :=
          'Duplicate: this receipt (or its reference) was already used by a cash in that was credited. '
          || 'Disapproved automatically - the wallet was not credited a second time.';
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  -- Step 4 (mandatory, independent of the automatic-matching rule): the
  -- receiving account on the evidence must be the configured payee account.
  if public.cash_in_enforce_receiver_account(_row.id) = 'rejected' then
    return 'receiving_mismatch_rejected';
  end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then return 'disabled'; end if;
  if _row.proof_path is null then return 'no_proof'; end if;

  _receipt := coalesce(_row.receipt_check, 'pending');
  _refkey := coalesce(_row.receipt_reference_key, _row.payer_reference_key);
  _paid := coalesce(_row.receipt_paid_at, _row.paid_at);
  _sender := public.cash_in_sender_key(_row);
  if _row.listener_event_id is not null then
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    _provider := _ev.provider_id;
  end if;
  _provider := coalesce(_provider, _row.provider_id, 'gcash');

  -- Step 5: duplicate protection, serialised per reference.
  if _refkey is not null then
    perform pg_advisory_xact_lock(hashtext('cash_in_ref:' || _provider || ':' || _refkey));
  end if;
  _credited := public.cash_in_credited_duplicate(_row.id, _refkey, _row.proof_hash, _provider);
  if _credited is null and _refkey is not null
     and public.payment_reference_used_elsewhere(_row.id, _provider, _refkey) then
    select s.cash_in_id into _credited from public.payment_reference_seen s
     where s.reference_hash = public.payment_reference_hash(_provider, _refkey) limit 1;
    _credited := coalesce(_credited, _row.id);
  end if;
  if _credited is not null then
    perform public.auto_disapprove_cash_in(_row.id, _credited_reason, nullif(_credited, _row.id),
              case when _row.proof_hash is not null and exists (
                     select 1 from public.cash_in_requests c where c.id = _credited and c.proof_hash = _row.proof_hash)
                   then 'duplicate_receipt' else 'duplicate_reference' end);
    return 'duplicate_credited';
  end if;

  if _refkey is null then
    if _receipt in ('unreadable','error') then return 'receipt_unreadable'; end if;
    return 'awaiting_receipt_check';
  end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    return 'above_auto_limit';
  end if;
  if _rule.expected_amount_php is not null
     and abs(_row.amount_php - _rule.expected_amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;

  _recv := public.normalize_ph_mobile(public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _recv is null then return 'no_receiving_number'; end if;

  if coalesce(_rule.layer2_require_sender_match, true) and _sender is null then
    return 'no_sender_number';
  end if;
  if _row.receipt_sender_number_key is not null and _sender is not null
     and _row.receipt_sender_number_key <> _sender then
    return 'number_mismatch';
  end if;

  if _row.listener_event_id is null then
    if coalesce(_rule.require_listener_match, true) then return 'awaiting_listener'; end if;
  else
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    -- Step 6: at least two independent details must agree.
    if public.listener_match_signals(_ev, _row) < 2 then
      return 'insufficient_match_signals';
    end if;
    if coalesce(_rule.layer2_require_sender_match, true)
       and _ev.sender_number_key is not null and _sender is not null
       and _ev.sender_number_key <> _sender then
      return 'number_mismatch';
    end if;
    if coalesce(_rule.layer2_require_amount_match, true)
       and (_ev.amount_php is null
            or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0)) then
      return 'amount_mismatch';
    end if;
    if not public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id) then
      return 'wrong_shop';
    end if;
    if not exists (select 1 from public.listener_devices d
                    where d.id = _ev.device_id and d.status = 'active'
                      and d.last_seen_at is not null
                      and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes)) then
      return 'listener_offline';
    end if;
  end if;

  if _receipt = 'mismatch' then return 'receipt_reference_mismatch'; end if;
  if coalesce(_rule.require_receipt_match, true) then
    if _receipt in ('unreadable', 'error') then return 'receipt_unreadable'; end if;
    if _receipt <> 'matched' then return 'awaiting_receipt_check'; end if;
  end if;
  if _row.receipt_amount_php is not null
     and abs(_row.receipt_amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;

  -- Receiver-account evidence: at least one source must show the configured account.
  _rchk := public.cash_in_receiver_account_check(_row, _ev);
  if _rchk->>'status' in ('mismatch', 'conflict') then
    perform public.cash_in_enforce_receiver_account(_row.id);
    return 'receiving_mismatch_rejected';
  elsif _rchk->>'status' = 'not_configured' then
    return 'no_receiving_number';
  elsif _rchk->>'status' <> 'matched' then
    return 'no_receiving_evidence';
  end if;

  if coalesce(_rule.verification_mode, 'active') = 'staged' then
    update public.cash_in_requests set staged_result = 'would_approve', staged_at = now() where id = _row.id;
    perform public.record_payment_match(_row.id, 'staged', _provider, null);
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_row.ecosystem_id, null, 'Automatic matching (staged)', 'Cash in would be approved',
            _row.requester_name,
            jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                               'listener_event_id', _row.listener_event_id, 'provider_id', _provider,
                               'receipt_check', _row.receipt_check, 'receipt_paid_at', _row.receipt_paid_at,
                               'receiver_account_check', _rchk));
    return 'staged';
  end if;

  _hash := public.remember_payment_reference(_provider, _refkey, _row.id, _row.ecosystem_id);
  perform public.record_payment_match(_row.id, 'auto_approved', _provider, _hash);

  _note := 'A captured payment notification agrees with this receipt on at least two independent '
        || 'details, the configured receiving account was confirmed on the '
        || coalesce(_rchk->>'matched_source', 'evidence')
        || ', and neither the receipt nor its reference was credited before.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real payment notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                             'listener_event_id', _row.listener_event_id, 'provider_id', _provider,
                             'receipt_check', _row.receipt_check, 'sender_number_key', _sender,
                             'match_signals', public.listener_match_signals(_ev, _row),
                             'receiver_account_check', _rchk));
  return 'approved';
end $$;

-- Blockers list for reviewers.
create or replace function public.cash_in_auth_blockers(_id uuid)
returns text[]
language plpgsql stable security definer set search_path to 'public'
as $$
declare _row public.cash_in_requests; _rule record; _ev public.listener_events;
        _out text[] := '{}'::text[]; _sender text; _provider text; _rchk jsonb;
begin
  select * into _row from public.cash_in_requests where id = _id;
  if _row.id is null then return array['not_found']::text[]; end if;
  if _row.status <> 'pending' then return '{}'::text[]; end if;
  if _row.listener_event_id is not null then
    select * into _ev from public.listener_events where id = _row.listener_event_id;
  end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then _out := _out || 'automatic_matching_disabled'::text; end if;
  if _row.proof_path is null then _out := _out || 'no_receipt_uploaded'::text; end if;

  if coalesce(_row.receipt_check, 'pending') in ('unreadable', 'error') then
    _out := _out || 'receipt_unreadable'::text;
  elsif coalesce(_row.receipt_check, 'pending') = 'mismatch' then
    _out := _out || 'receipt_reference_mismatch'::text;
  elsif coalesce(_row.receipt_check, 'pending') = 'pending' then
    _out := _out || 'receipt_not_read_yet'::text;
  end if;

  if coalesce(_row.receipt_reference_key, _row.payer_reference_key) is null then
    _out := _out || 'missing_reference'::text;
  end if;
  if coalesce(_row.receipt_paid_at, _row.paid_at) is null then
    _out := _out || 'missing_receipt_time'::text;
  end if;

  _rchk := public.cash_in_receiver_account_check(_row, _ev);
  if _rchk->>'status' = 'not_configured' then _out := _out || 'shop_has_no_receiving_number'::text;
  elsif _rchk->>'status' in ('mismatch', 'conflict') then _out := _out || 'receiving_mismatch'::text;
  elsif _rchk->>'status' = 'absent' then _out := _out || 'no_receiving_evidence'::text;
  end if;

  _sender := public.cash_in_sender_key(_row);
  if _sender is null then _out := _out || 'missing_sender_number'::text; end if;
  if _row.receipt_sender_number_key is not null and _sender is not null
     and _row.receipt_sender_number_key <> _sender then
    _out := _out || 'receipt_sender_mismatch'::text;
  end if;

  if _row.listener_event_id is null then
    if _sender is null then
      _out := _out || 'no_listener_event'::text;
    elsif exists (select 1 from public.listener_events e
                   where e.consumed_cash_in_id is null and e.sender_number_key = _sender and e.outcome = 'accepted') then
      _out := _out || 'listener_amount_or_time_mismatch'::text;
    elsif exists (select 1 from public.listener_events e
                   where e.consumed_cash_in_id is null and e.outcome = 'accepted' and e.amount_php = _row.amount_php) then
      _out := _out || 'listener_sender_mismatch'::text;
    else
      _out := _out || 'no_listener_event'::text;
    end if;
  else
    if _ev.id is null or _ev.outcome <> 'accepted' then
      _out := _out || 'no_listener_event'::text;
    else
      if _sender is not null and _ev.sender_number_key is not null
         and _ev.sender_number_key <> _sender then
        _out := _out || 'listener_sender_mismatch'::text;
      end if;
      if _ev.amount_php is null
         or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
        _out := _out || 'listener_amount_mismatch'::text;
      end if;
      if public.listener_match_signals(_ev, _row) < 2 then
        _out := _out || 'insufficient_match_signals'::text;
      end if;
      if not public.listener_serves_destination(_ev.device_id, _row.ecosystem_id, _row.method_id) then
        _out := _out || 'wrong_shop'::text;
      end if;
    end if;
  end if;

  _provider := coalesce(_ev.provider_id, _row.provider_id, 'gcash');
  if coalesce(_row.duplicate_reference, false) or coalesce(_row.duplicate_receipt, false)
     or public.cash_in_credited_duplicate(_row.id,
          coalesce(_row.receipt_reference_key, _row.payer_reference_key), _row.proof_hash, _provider) is not null
     or public.payment_reference_used_elsewhere(_row.id, _provider,
          coalesce(_row.receipt_reference_key, _row.payer_reference_key)) then
    _out := _out || 'duplicate_reference'::text;
  end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    _out := _out || 'above_auto_limit'::text;
  end if;
  return _out;
end $$;

create or replace function public.cash_in_auth_explain(_codes text[])
returns text
language sql immutable set search_path to 'public'
as $$
  select nullif(string_agg(t, ' · '), '') from (
    select case c
      when 'not_found' then 'Request not found'
      when 'automatic_matching_disabled' then 'Automatic matching is switched off for this shop'
      when 'no_receipt_uploaded' then 'No payment screenshot was uploaded'
      when 'receipt_unreadable' then 'The receipt could not be read'
      when 'receipt_reference_mismatch' then 'The typed reference does not match the receipt'
      when 'receipt_not_read_yet' then 'The receipt has not been read yet'
      when 'missing_reference' then 'No payment reference could be established'
      when 'missing_sender_number' then 'The sending account number was not provided on this request'
      when 'receipt_sender_mismatch' then 'The receipt shows a different sending number'
      when 'missing_receipt_time' then 'The receipt transaction date and time is missing'
      when 'shop_has_no_receiving_number' then 'No receiving account is configured for this destination'
      when 'receiving_mismatch' then 'The payment was sent to an account that is not the configured receiving account - disapproved'
      when 'no_receiving_evidence' then 'Neither the receipt nor the notification shows the configured receiving account - manual review'
      when 'insufficient_match_signals' then 'Fewer than two independent details agree between the receipt and the notification'
      when 'no_listener_event' then 'No payment notification has been received for this payment'
      when 'listener_sender_mismatch' then 'The notification came from a different sending number'
      when 'listener_amount_mismatch' then 'The notification amount does not match'
      when 'listener_amount_or_time_mismatch' then 'A notification from that number exists, but the amount or date does not match'
      when 'wrong_shop' then 'The notification arrived on a phone registered to another shop'
      when 'duplicate_reference' then 'That payment reference was already used on the platform'
      when 'above_auto_limit' then 'The amount is above the automatic approval limit'
      else c end as t
    from unnest(coalesce(_codes, '{}'::text[])) as c) s
$$;

-- Reviewer explanation gains the receiver-account layer.
create or replace function public.cash_in_match_explanation(_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare _row public.cash_in_requests; _ev public.listener_events; _actor uuid := auth.uid();
        _signals jsonb := '[]'::jsonb; _count integer := 0; _dup uuid;
begin
  select * into _row from public.cash_in_requests where id = _id;
  if _row.id is null then return null; end if;
  if not public.is_super_admin(_actor)
     and not (_row.ecosystem_id is not null and public.is_ecosystem_admin(_actor, _row.ecosystem_id)) then
    raise exception 'Only the platform owner or that shop''s admin can review this cash in';
  end if;
  if _row.listener_event_id is not null then
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    _signals := public.listener_match_signal_details(_ev, _row);
    _count := public.listener_match_signals(_ev, _row);
  end if;
  _dup := public.cash_in_credited_duplicate(_row.id, coalesce(_row.receipt_reference_key, _row.payer_reference_key),
                                            _row.proof_hash, _row.provider_id);
  return jsonb_build_object(
    'cash_in_id', _row.id,
    'status', _row.status,
    'viewpoints', jsonb_build_object(
      'receipt', 'sender',
      'notification', 'receiver',
      'note', 'The receipt is the customer''s (sender) view; the notification is the platform''s (receiver) view of the same transfer. "Sent to" on the receipt is compared with "Received by" on the notification, and "Paid from" with "Received from".'),
    'receipt', jsonb_strip_nulls(jsonb_build_object(
      'proof_path', _row.proof_path,
      'proof_hash', _row.proof_hash,
      'check', _row.receipt_check,
      'checked_at', _row.receipt_checked_at,
      'provider', _row.provider_id,
      'reference', _row.receipt_reference,
      'amount_php', _row.receipt_amount_php,
      'sender_number', _row.receipt_sender_number,
      'sender_name', _row.receipt_sender_name,
      'sender_account_masked', _row.receipt_sender_account_masked,
      'receiving_number', _row.receipt_receiving_number,
      'receiving_account_masked', _row.receipt_receiving_account_masked,
      'paid_at', _row.receipt_paid_at,
      'submitted_reference', _row.payer_reference,
      'submitted_sender', _row.sender_number,
      'requested_amount_php', _row.amount_php,
      'details', _row.receipt_details)),
    'notification', case when _ev.id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'event_id', _ev.id,
      'device_id', _ev.device_id,
      'provider', _ev.provider_id,
      'app_label', _ev.app_label,
      'package_name', _ev.package_name,
      'amount_php', _ev.amount_php,
      'sender_number', _ev.sender_number,
      'sender_name', _ev.sender_name,
      'reference', _ev.gcash_reference,
      'posted_at', _ev.posted_at,
      'raw_text', _ev.raw_text,
      'details', _ev.details)) end,
    'receiver_account_check', public.cash_in_receiver_account_check(_row, _ev),
    'signals', _signals,
    'independent_matches', _count,
    'auto_candidate', _count >= 2,
    'duplicate_of_credited', _dup,
    'blockers', case when _row.status = 'pending' then public.cash_in_auth_blockers(_row.id) else null end);
end $$;