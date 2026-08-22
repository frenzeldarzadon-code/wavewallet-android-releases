-- 1. Durable, self-contained record of why a payment was matched -------------
CREATE TABLE IF NOT EXISTS public.payment_match_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_in_id uuid NOT NULL REFERENCES public.cash_in_requests(id) ON DELETE CASCADE,
  listener_event_id uuid REFERENCES public.listener_events(id) ON DELETE SET NULL,
  ecosystem_id uuid,
  provider_id text,
  decision text NOT NULL CHECK (decision IN ('auto_approved','staged','manual_approved')),
  signal_count integer NOT NULL DEFAULT 0,
  strong_signal boolean NOT NULL DEFAULT false,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  receipt_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notification_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  timing jsonb NOT NULL DEFAULT '{}'::jsonb,
  reference_hash text,
  matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cash_in_id, decision)
);

GRANT SELECT ON public.payment_match_records TO authenticated;
GRANT ALL ON public.payment_match_records TO service_role;
ALTER TABLE public.payment_match_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner and shop admins read match records"
  ON public.payment_match_records FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (ecosystem_id IS NOT NULL AND public.is_ecosystem_admin(auth.uid(), ecosystem_id)));

CREATE INDEX IF NOT EXISTS payment_match_records_cash_in_idx
  ON public.payment_match_records (cash_in_id);
CREATE INDEX IF NOT EXISTS payment_match_records_ecosystem_idx
  ON public.payment_match_records (ecosystem_id, matched_at DESC);

-- 2. Signal detail, mirroring listener_match_signals exactly -----------------
-- Time is never a signal here: it appears only in the timing metadata written
-- by record_payment_match. Amount alone can never satisfy the rule.
CREATE OR REPLACE FUNCTION public.listener_match_signal_details(
  _ev public.listener_events, _row public.cash_in_requests)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  with c as (
    select public.cash_in_sender_key(_row) as sender_key,
           coalesce(_row.receipt_reference_key, _row.payer_reference_key) as ref_key,
           coalesce((select r.amount_tolerance_php
                       from public.cash_in_auto_rule(_row.ecosystem_id) r), 0) as tol
  )
  select jsonb_build_array(
    jsonb_build_object(
      'signal', 'reference', 'strength', 'strong',
      'receipt', c.ref_key, 'notification', _ev.reference_key,
      'agreed', (_ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key = c.ref_key)),
    jsonb_build_object(
      'signal', 'sender_account', 'strength', 'strong',
      'receipt', c.sender_key, 'notification', _ev.sender_number_key,
      'agreed', (_ev.sender_number_key is not null and c.sender_key is not null
                 and _ev.sender_number_key = c.sender_key)),
    jsonb_build_object(
      'signal', 'amount', 'strength', 'weak',
      'receipt', _row.amount_php, 'notification', _ev.amount_php,
      'tolerance_php', c.tol,
      'agreed', (_ev.amount_php is not null
                 and abs(_ev.amount_php - _row.amount_php) <= c.tol)),
    jsonb_build_object(
      'signal', 'reference_conflict_veto', 'strength', 'veto',
      'receipt', c.ref_key, 'notification', _ev.reference_key,
      'agreed', (_ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key <> c.ref_key))
  )
  from c
$function$;

REVOKE ALL ON FUNCTION public.listener_match_signal_details(public.listener_events, public.cash_in_requests) FROM public, anon, authenticated;

-- 3. Writing the record ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment_match(
  _cash_in uuid, _decision text, _provider text, _reference_hash text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _row public.cash_in_requests; _ev public.listener_events; _id uuid;
        _signals jsonb := '[]'::jsonb; _count integer := 0; _strong boolean := false;
        _paid timestamptz;
begin
  select * into _row from public.cash_in_requests where id = _cash_in;
  if _row.id is null then return null; end if;
  if _row.listener_event_id is not null then
    select * into _ev from public.listener_events where id = _row.listener_event_id;
  end if;

  if _ev.id is not null then
    _signals := public.listener_match_signal_details(_ev, _row);
    _count := public.listener_match_signals(_ev, _row);
    _strong := public.listener_has_strong_signal(_ev, _row);
  end if;

  _paid := coalesce(_row.receipt_paid_at, _row.paid_at, _row.created_at);

  insert into public.payment_match_records (
    cash_in_id, listener_event_id, ecosystem_id, provider_id, decision,
    signal_count, strong_signal, signals, receipt_snapshot, notification_snapshot,
    timing, reference_hash)
  values (
    _row.id, _ev.id, _row.ecosystem_id, _provider, _decision,
    _count, _strong, _signals,
    jsonb_strip_nulls(jsonb_build_object(
      'amount_php', _row.amount_php,
      'reference', coalesce(_row.receipt_reference, _row.payer_reference, _row.reference),
      'reference_key', coalesce(_row.receipt_reference_key, _row.payer_reference_key),
      'sender_number', coalesce(_row.receipt_sender_number, _row.sender_number),
      'sender_number_key', public.cash_in_sender_key(_row),
      'receiving_number_key', _row.receipt_receiving_number_key,
      'receipt_check', _row.receipt_check,
      'receipt_amount_php', _row.receipt_amount_php,
      'paid_at', _paid)),
    case when _ev.id is null then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object(
      'provider_id', _ev.provider_id,
      'package_name', _ev.package_name,
      'app_label', _ev.app_label,
      'amount_php', _ev.amount_php,
      'reference', _ev.gcash_reference,
      'reference_key', _ev.reference_key,
      'sender_number_key', _ev.sender_number_key,
      'sender_name', _ev.sender_name,
      'parser_version', _ev.parser_version)) end,
    jsonb_strip_nulls(jsonb_build_object(
      'paid_at', _paid,
      'notification_posted_at', _ev.posted_at,
      'listener_received_at', _ev.created_at,
      'capture_delay_minutes',
        case when _ev.created_at is not null and _paid is not null
             then round(extract(epoch from (_ev.created_at - _paid)) / 60.0)::int end,
      'note', 'Timing is contextual evidence only and is never one of the required signals.')),
    _reference_hash)
  on conflict (cash_in_id, decision) do update
    set listener_event_id = excluded.listener_event_id,
        signal_count = excluded.signal_count,
        strong_signal = excluded.strong_signal,
        signals = excluded.signals,
        receipt_snapshot = excluded.receipt_snapshot,
        notification_snapshot = excluded.notification_snapshot,
        timing = excluded.timing,
        reference_hash = coalesce(excluded.reference_hash, public.payment_match_records.reference_hash),
        matched_at = now()
  returning id into _id;
  return _id;
end $function$;

REVOKE ALL ON FUNCTION public.record_payment_match(uuid, text, text, text) FROM public, anon, authenticated;

-- 4. Candidate window: prefer the payment's own time, never punish a late capture
CREATE OR REPLACE FUNCTION public.match_listener_event(_event uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _ev public.listener_events; _dev public.listener_devices;
        _candidates uuid[]; _auth_candidates uuid[]; _target uuid; _result text; _note text;
        _when timestamptz;
begin
  select * into _ev from public.listener_events where id = _event for update;
  if _ev.id is null then return 'not_found'; end if;
  if _ev.outcome = 'non_payment' then return 'non_payment'; end if;
  if _ev.outcome <> 'accepted' then return _ev.outcome; end if;
  if _ev.consumed_cash_in_id is not null then return 'already_consumed'; end if;
  if _ev.amount_php is null then return 'unparsed'; end if;
  select * into _dev from public.listener_devices where id = _ev.device_id;
  if _dev.id is null or _dev.status <> 'active' then return 'device_revoked'; end if;

  update public.listener_events
     set match_attempts = match_attempts + 1, last_match_attempt_at = now()
   where id = _ev.id;

  -- The notification's own posted time is preferred; the time the phone
  -- happened to capture/deliver it is only a fallback. The window is
  -- contextual evidence, never one of the required signals, and it is
  -- deliberately generous AFTER the payment so a late capture cannot fail an
  -- otherwise valid payment.
  _when := coalesce(_ev.posted_at, _ev.created_at);

  -- Two independent signals minimum, at least one of them not the amount.
  select array_agg(c.id) into _auth_candidates
    from public.cash_in_requests c
   where c.status = 'pending'
     and c.listener_event_id is null
     and public.listener_match_signals(_ev, c) >= 2
     and public.listener_has_strong_signal(_ev, c)
     and _when >= coalesce(c.receipt_paid_at, c.paid_at, c.created_at) - interval '3 days'
     and _when <= coalesce(c.receipt_paid_at, c.paid_at, c.created_at) + interval '7 days';

  select array_agg(c.id) into _candidates
    from public.cash_in_requests c
   where c.id = any(coalesce(_auth_candidates, '{}'::uuid[]))
     and public.listener_serves_destination(_dev.id, c.ecosystem_id, c.method_id);

  if _candidates is null or array_length(_candidates, 1) = 0 then
    if _auth_candidates is not null and array_length(_auth_candidates, 1) > 0 then
      update public.listener_events set match_result = 'wrong_shop', review_state = 'pending'
       where id = _ev.id;
      return 'wrong_shop';
    end if;
    update public.listener_events set match_result = 'no_pending_match', review_state = 'pending'
     where id = _ev.id;
    return 'no_pending_match';
  end if;
  if array_length(_candidates, 1) > 1 then
    update public.listener_events set match_result = 'ambiguous', review_state = 'pending'
     where id = _ev.id;
    return 'ambiguous';
  end if;

  _target := _candidates[1];

  if not public.listener_receiving_number_matches(
       _dev.id,
       (select ecosystem_id from public.cash_in_requests where id = _target),
       (select method_id from public.cash_in_requests where id = _target)) then
    _note := 'Informational: the payment app reported a different or masked receiving number than '
          || 'the shop''s configured number. This does not affect authentication and did not block '
          || 'matching.';
  end if;

  update public.cash_in_requests set listener_event_id = _ev.id
   where id = _target and listener_event_id is null;
  if not found then
    update public.listener_events set match_result = 'no_pending_match', review_state = 'pending'
     where id = _ev.id;
    return 'no_pending_match';
  end if;
  update public.listener_events
     set consumed_cash_in_id = _target, match_result = 'matched', review_state = 'matched',
         destination_note = coalesce(_note, destination_note)
   where id = _ev.id and consumed_cash_in_id is null;
  if not found then
    update public.cash_in_requests set listener_event_id = null
     where id = _target and listener_event_id = _ev.id;
    return 'already_consumed';
  end if;
  _result := public.reconcile_cash_in(_target);
  update public.listener_events set match_result = 'matched:' || _result where id = _ev.id;
  return _result;
end $function$;

-- 5. Write the record on every automatic decision ----------------------------
CREATE OR REPLACE FUNCTION public.try_auto_approve_cash_in(_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text; _sender text;
        _ev public.listener_events; _receipt text; _refkey text; _paid timestamptz;
        _provider text; _hash text;
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

  if _refkey is null then
    if _receipt in ('unreadable','error') then return 'receipt_unreadable'; end if;
    return 'awaiting_receipt_check';
  end if;

  if _row.duplicate_reference
     or public.cash_in_reference_duplicate(_row.id, _refkey, _paid) is not null then
    return 'duplicate_reference';
  end if;
  if exists (select 1 from public.listener_events e
              where e.reference_key = _refkey
                and e.consumed_cash_in_id is not null
                and e.consumed_cash_in_id <> _row.id) then
    return 'duplicate_reference';
  end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    return 'above_auto_limit';
  end if;
  if _rule.expected_amount_php is not null
     and abs(_row.amount_php - _rule.expected_amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;

  _recv := public.normalize_ph_mobile(
             public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
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
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    _provider := _ev.provider_id;
    -- NON-NEGOTIABLE: at least two independent pieces of information must agree
    -- between the receipt and the notification, and at least one of them must be
    -- a strong identity signal. Amount alone is never enough. The time the phone
    -- captured the notification is never one of these signals.
    if public.listener_match_signals(_ev, _row) < 2
       or not public.listener_has_strong_signal(_ev, _row) then
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

  _provider := coalesce(_provider, 'gcash');
  if public.payment_reference_used_elsewhere(_row.id, _provider, _refkey) then
    return 'duplicate_reference';
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
  if _row.receipt_receiving_number_key is not null
     and _row.receipt_receiving_number_key <> _recv then
    return 'receiving_mismatch';
  end if;

  if coalesce(_rule.verification_mode, 'active') = 'staged' then
    update public.cash_in_requests
       set staged_result = 'would_approve', staged_at = now()
     where id = _row.id;
    perform public.record_payment_match(_row.id, 'staged', _provider, null);
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_row.ecosystem_id, null, 'Automatic matching (staged)', 'Cash in would be approved',
            _row.requester_name,
            jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                               'listener_event_id', _row.listener_event_id,
                               'receipt_check', _row.receipt_check,
                               'receipt_paid_at', _row.receipt_paid_at));
    return 'staged';
  end if;

  _hash := public.remember_payment_reference(_provider, _refkey, _row.id, _row.ecosystem_id);
  perform public.record_payment_match(_row.id, 'auto_approved', _provider, _hash);

  _note := 'A payment notification from a paired listener device confirms at least two independent '
        || 'details of this payment, the receipt agrees with it, and its reference has never been '
        || 'used on any shop.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real payment notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                             'listener_event_id', _row.listener_event_id,
                             'provider_id', _provider,
                             'receipt_check', _row.receipt_check,
                             'sender_number_key', _sender));
  return 'approved';
end $function$;