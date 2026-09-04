-- 1. Match records can record an automatic duplicate rejection
alter table public.payment_match_records drop constraint if exists payment_match_records_decision_check;
alter table public.payment_match_records add constraint payment_match_records_decision_check
  check (decision in ('auto_approved','staged','manual_approved','duplicate_rejected'));

-- 2. Which earlier cash in was CREDITED with the same receipt image or reference?
create or replace function public.cash_in_credited_duplicate(_id uuid, _refkey text, _proof_hash text, _provider text)
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select c.id
    from public.cash_in_requests c
   where c.id is distinct from _id
     and c.status = 'approved'
     and (
          (_proof_hash is not null and c.proof_hash = _proof_hash)
       or (_refkey is not null and _refkey in (coalesce(c.payer_reference_key,''), coalesce(c.receipt_reference_key,'')))
       or (_refkey is not null and exists (
             select 1 from public.payment_reference_seen s
              where s.reference_hash = public.payment_reference_hash(coalesce(_provider,'gcash'), _refkey)
                and s.cash_in_id = c.id))
       or (_refkey is not null and exists (
             select 1 from public.listener_events e
              where e.reference_key = _refkey and e.consumed_cash_in_id = c.id))
     )
   order by c.created_at asc
   limit 1
$$;
revoke all on function public.cash_in_credited_duplicate(uuid,text,text,text) from public, anon;
grant execute on function public.cash_in_credited_duplicate(uuid,text,text,text) to authenticated, service_role;

-- 3. Automatic disapproval: never credits, keeps a full audit trail
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
    perform public.record_payment_match(_row.id, 'duplicate_rejected', _provider, null);
  exception when others then null; -- the audit log below is the authoritative record
  end;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic verification', 'Disapproved duplicate cash in',
          _row.requester_name,
          jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                             'kind', _kind, 'duplicate_of', _duplicate_of,
                             'reference', _row.reference, 'requester_id', _row.user_id,
                             'proof_hash', _row.proof_hash,
                             'reference_key', coalesce(_row.receipt_reference_key, _row.payer_reference_key),
                             'listener_event_id', _row.listener_event_id, 'reason', _reason));
  return _row;
end $$;
revoke all on function public.auto_disapprove_cash_in(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.auto_disapprove_cash_in(uuid,text,uuid,text) to service_role;

-- 4. Receipt reading: duplicate check BEFORE anything else can credit
create or replace function public.apply_cash_in_receipt_ocr(_id uuid, _reference text DEFAULT NULL::text, _amount numeric DEFAULT NULL::numeric, _sender text DEFAULT NULL::text, _readable boolean DEFAULT true, _details jsonb DEFAULT NULL::jsonb, _paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _receiving text DEFAULT NULL::text, _provider text DEFAULT NULL::text, _sender_name text DEFAULT NULL::text, _sender_account text DEFAULT NULL::text, _receiving_account text DEFAULT NULL::text, _proof_hash text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Canonical receipt metadata is stored first, so the reviewer always sees
  -- what was read even when the request is disapproved right after.
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

  -- Duplicate check comes FIRST. A duplicate that was already credited is
  -- disapproved outright; one that is merely pending is recorded for
  -- side-by-side review and verification continues.
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
end $function$;

-- 5. Automatic approval: credited duplicates are disapproved, pending duplicates continue
CREATE OR REPLACE FUNCTION public.try_auto_approve_cash_in(_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text; _sender text;
        _ev public.listener_events; _receipt text; _refkey text; _paid timestamptz;
        _provider text; _hash text; _credited uuid;
        _credited_reason constant text :=
          'Duplicate: this receipt (or its reference) was already used by a cash in that was credited. '
          || 'Disapproved automatically - the wallet was not credited a second time.';
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

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

  -- Duplicate protection always takes precedence and is serialised per
  -- reference so two identical references can never both be credited.
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
    -- NON-NEGOTIABLE: at least two independent details must agree between the
    -- receipt and the notification. Amount alone is one signal.
    if public.listener_match_signals(_ev, _row) < 2 then
      return 'insufficient_match_signals';
    end if;
    if coalesce(_rule.layer2_require_sender_match, true)
       and (_ev.sender_number_key is null or _ev.sender_number_key is distinct from _sender) then
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
  if _row.receipt_receiving_number_key is not null and _row.receipt_receiving_number_key <> _recv then
    return 'receiving_mismatch';
  end if;

  if coalesce(_rule.verification_mode, 'active') = 'staged' then
    update public.cash_in_requests set staged_result = 'would_approve', staged_at = now() where id = _row.id;
    perform public.record_payment_match(_row.id, 'staged', _provider, null);
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_row.ecosystem_id, null, 'Automatic matching (staged)', 'Cash in would be approved',
            _row.requester_name,
            jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                               'listener_event_id', _row.listener_event_id, 'provider_id', _provider,
                               'receipt_check', _row.receipt_check, 'receipt_paid_at', _row.receipt_paid_at));
    return 'staged';
  end if;

  _hash := public.remember_payment_reference(_provider, _refkey, _row.id, _row.ecosystem_id);
  perform public.record_payment_match(_row.id, 'auto_approved', _provider, _hash);

  _note := 'A captured payment notification agrees with this receipt on at least two independent '
        || 'details, and neither the receipt nor its reference was credited before.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real payment notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                             'listener_event_id', _row.listener_event_id, 'provider_id', _provider,
                             'receipt_check', _row.receipt_check, 'sender_number_key', _sender,
                             'match_signals', public.listener_match_signals(_ev, _row)));
  return 'approved';
end $function$;

-- 6. Blockers: two independent signals, credited duplicates only
CREATE OR REPLACE FUNCTION public.cash_in_auth_blockers(_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.cash_in_requests; _rule record; _ev public.listener_events;
        _out text[] := '{}'::text[]; _recv text; _sender text; _provider text;
begin
  select * into _row from public.cash_in_requests where id = _id;
  if _row.id is null then return array['not_found']::text[]; end if;
  if _row.status <> 'pending' then return '{}'::text[]; end if;

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

  _recv := public.normalize_ph_mobile(public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _recv is null then _out := _out || 'shop_has_no_receiving_number'::text; end if;
  if _row.receipt_receiving_number_key is not null and _recv is not null
     and _row.receipt_receiving_number_key <> _recv then
    _out := _out || 'receiving_mismatch'::text;
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
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then
      _out := _out || 'no_listener_event'::text;
    else
      if _sender is not null and _ev.sender_number_key is distinct from _sender then
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
end $function$;

-- 7. Registration: a listener phone is registered, never paired to one account
CREATE OR REPLACE FUNCTION public.register_listener_device(_label text, _ecosystem uuid DEFAULT NULL::uuid, _window_minutes integer DEFAULT 60, _offline_minutes integer DEFAULT 15, _package text DEFAULT 'com.globe.gcash.android'::text, _receiving_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _actor uuid := auth.uid(); _secret text; _row public.listener_devices;
        _super boolean; _number text; _key text; _owner text;
begin
  _super := public.is_super_admin(_actor);
  if not (_super or (_ecosystem is not null and public.is_ecosystem_admin(_actor, _ecosystem))) then
    raise exception 'You cannot register a listener device for this shop';
  end if;
  _owner := case when _ecosystem is null then 'platform' else 'admin' end;
  if nullif(trim(_label), '') is null then raise exception 'Give the device a name'; end if;

  -- Optional: an account note. Matching never depends on it; the phone
  -- captures every supported payment notification it receives.
  _number := nullif(trim(coalesce(_receiving_number, '')), '');
  _key := public.normalize_ph_mobile(_number);
  if _number is not null and _key is null then
    raise exception 'That receiving account number is not a valid mobile number';
  end if;
  if not _super and _key is not null
     and _key is distinct from public.normalize_ph_mobile(
           (select e.cash_in_gcash_number from public.ecosystems e where e.id = _ecosystem)) then
    raise exception 'If you state a receiving number it must be the one configured for your shop';
  end if;

  _secret := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.listener_devices (label, ecosystem_id, secret_key_hash, status, package_name,
                                       match_window_minutes, offline_after_minutes, created_by,
                                       receiving_number, receiving_number_key, owner_role)
  values (trim(_label), _ecosystem, encode(extensions.digest(_secret, 'sha256'), 'hex'), 'pending',
          coalesce(nullif(trim(_package), ''), 'com.globe.gcash.android'),
          greatest(coalesce(_window_minutes, 60), 1), greatest(coalesce(_offline_minutes, 15), 1), _actor,
          _number, _key, _owner)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor, coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          'Registered payment listener device', _row.label,
          jsonb_build_object('device_id', _row.id, 'ecosystem_id', _ecosystem,
                             'owner_role', _owner, 'receiving_number', _number));
  return jsonb_build_object('device_id', _row.id, 'label', _row.label,
                            'pairing_secret', _secret, 'package_name', _row.package_name,
                            'receiving_number', _row.receiving_number);
end $function$;

-- 8. Platform readiness: any active platform phone covers every platform account
CREATE OR REPLACE FUNCTION public.platform_cash_in_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _actor uuid := auth.uid(); _rule public.cash_in_auto_rules; _watching boolean; _online boolean;
begin
  if _actor is null or not exists (select 1 from public.profiles p where p.id = _actor and p.status = 'active') then
    raise exception 'Sign in to read the platform cash in status';
  end if;
  select * into _rule from public.cash_in_auto_rules where ecosystem_id is null;
  _watching := exists (select 1 from public.listener_devices d where d.status = 'active' and d.ecosystem_id is null);
  _online := exists (select 1 from public.listener_devices d
                      where d.status = 'active' and d.ecosystem_id is null
                        and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes)
                        and coalesce(d.listener_connected, true) and coalesce(d.notification_access, true));
  return jsonb_build_object(
    'auto_enabled', coalesce(_rule.enabled, false),
    'require_listener_match', coalesce(_rule.require_listener_match, true),
    'max_auto_amount_php', _rule.max_auto_amount_php,
    'listener_watching', _watching,
    'listener_online', _online,
    'methods', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'method_type', m.method_type,
        'account_tail', right(regexp_replace(coalesce(m.account_number, ''), '\D', '', 'g'), 4),
        'listener_watching', _watching, 'listener_online', _online
      ) order by m.sort_order, m.name)
      from public.payment_methods m where m.ecosystem_id is null and m.active), '[]'::jsonb)
  );
end;
$function$;

-- 9. Matching status: retire account-pairing warnings
CREATE OR REPLACE FUNCTION public.cash_in_auto_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _actor uuid := auth.uid();
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can read the cash in matching status';
  end if;
  return jsonb_build_object(
    'platform_rule', (select to_jsonb(r) from public.cash_in_auto_rules r where r.ecosystem_id is null),
    'shop_rules', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('ecosystem_name', e.name) order by e.name)
      from public.cash_in_auto_rules r join public.ecosystems e on e.id = r.ecosystem_id), '[]'::jsonb),
    'shops_with_number', (select count(*) from public.ecosystems where nullif(trim(cash_in_gcash_number), '') is not null),
    'shared_numbers', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('number', public.normalize_ph_mobile(cash_in_gcash_number), 'shops', count(*)) as x
          from public.ecosystems where nullif(trim(cash_in_gcash_number), '') is not null
         group by public.normalize_ph_mobile(cash_in_gcash_number) having count(*) > 1) s), '[]'::jsonb),
    'listener_devices_active', (select count(*) from public.listener_devices where status = 'active'),
    'listener_devices_proven', (select count(*) from public.listener_devices where status = 'active' and last_event_at is not null),
    'listener_devices_unscoped', 0,
    'listener_matches_30d', (select count(*) from public.listener_events
                              where consumed_cash_in_id is not null and created_at > now() - interval '30 days'),
    'listener_last_event_at', (select max(last_event_at) from public.listener_devices where status = 'active'),
    'staged_30d', (select count(*) from public.cash_in_requests where staged_result is not null and staged_at > now() - interval '30 days'),
    'duplicates_blocked_30d', (select count(*) from public.cash_in_requests
                                where status = 'rejected'
                                  and (decision_reason like 'Duplicate%' or duplicate_reference or duplicate_receipt)
                                  and created_at > now() - interval '30 days'),
    'auto_approved_30d', (select count(*) from public.cash_in_requests
                           where approval_method = 'automatic' and status = 'approved' and created_at > now() - interval '30 days'),
    'mismatched_devices', '[]'::jsonb
  );
end $function$;