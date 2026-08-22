-- Provider-agnostic receipts: provider identity on the cash in, bank-friendly
-- signals, and receipt reuse protection.
--
-- NON-NEGOTIABLE and unchanged: automatic approval still needs >= 2 independent
-- agreeing signals with at least one STRONG identity signal, amount alone is
-- never enough, a reference disagreement is a hard veto, and capture time is
-- metadata only.

alter table public.cash_in_requests
  add column if not exists provider_id text,
  add column if not exists provider_source text,
  add column if not exists receipt_sender_name text,
  add column if not exists receipt_sender_account_masked text,
  add column if not exists receipt_receiving_account_masked text,
  add column if not exists proof_hash text,
  add column if not exists duplicate_receipt boolean not null default false,
  add column if not exists duplicate_receipt_of uuid references public.cash_in_requests(id);

create index if not exists cash_in_requests_proof_hash_idx
  on public.cash_in_requests (proof_hash) where proof_hash is not null;

create or replace function public.payment_provider_by_name(_name text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select r.id
    from public.payment_provider_registry r
   where r.enabled
     and nullif(btrim(coalesce(_name, '')), '') is not null
     and (lower(btrim(_name)) = lower(r.id)
          or lower(btrim(_name)) = lower(r.name)
          or exists (select 1 from unnest(coalesce(r.text_markers, '{}'::text[])) m
                      where lower(btrim(_name)) like '%' || lower(m) || '%'))
   order by (lower(btrim(_name)) = lower(r.id)) desc,
            (lower(btrim(_name)) = lower(r.name)) desc
   limit 1
$$;

create or replace function public.set_cash_in_provider()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _p text;
begin
  if new.provider_id is not null then return new; end if;
  select m.provider_id into _p from public.payment_methods m where m.id = new.method_id;
  if _p is not null then
    new.provider_id := _p; new.provider_source := 'method'; return new;
  end if;
  _p := public.payment_provider_by_name(coalesce(new.ocr_details->>'provider_name',
                                                 new.ocr_details->>'provider'));
  if _p is not null then
    new.provider_id := _p; new.provider_source := 'receipt';
  end if;
  return new;
end $$;

drop trigger if exists set_cash_in_provider on public.cash_in_requests;
create trigger set_cash_in_provider
  before insert on public.cash_in_requests
  for each row execute function public.set_cash_in_provider();

create or replace function public.payment_account_tail(_value text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when length(regexp_replace(coalesce(_value, ''), '[^0-9]', '', 'g')) >= 4
    then right(regexp_replace(coalesce(_value, ''), '[^0-9]', '', 'g'), 4)
  end
$$;

create or replace function public.cash_in_account_tail(_row public.cash_in_requests)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(
    public.payment_account_tail(_row.receipt_sender_account_masked),
    public.payment_account_tail(_row.receipt_sender_number),
    public.payment_account_tail(public.cash_in_sender_key(_row)))
$$;

create or replace function public.listener_event_account_tail(_ev public.listener_events)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(
    public.payment_account_tail(_ev.sender_number),
    public.payment_account_tail(_ev.sender_number_key))
$$;

create or replace function public.payment_name_key(_value text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(regexp_replace(lower(coalesce(_value, '')), '[^a-z]', '', 'g'), '')
$$;

create or replace function public.listener_match_signals(_ev public.listener_events,
                                                         _row public.cash_in_requests)
returns integer
language sql
stable
set search_path to 'public'
as $$
  with c as (
    select public.cash_in_sender_key(_row) as sender_key,
           coalesce(_row.receipt_reference_key, _row.payer_reference_key) as ref_key,
           public.cash_in_account_tail(_row) as tail,
           public.listener_event_account_tail(_ev) as ev_tail,
           public.payment_name_key(_row.receipt_sender_name) as name_key,
           public.payment_name_key(_ev.sender_name) as ev_name_key,
           coalesce((select r.amount_tolerance_php
                       from public.cash_in_auto_rule(_row.ecosystem_id) r), 0) as tol
  )
  select case
    when _ev.reference_key is not null and c.ref_key is not null
         and _ev.reference_key <> c.ref_key then 0
    else
      (case when _ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key = c.ref_key then 1 else 0 end)
    + (case when _ev.sender_number_key is not null and c.sender_key is not null
                 and _ev.sender_number_key = c.sender_key then 1 else 0 end)
    + (case when not (_ev.sender_number_key is not null and c.sender_key is not null)
                 and c.tail is not null and c.ev_tail is not null
                 and c.tail = c.ev_tail then 1 else 0 end)
    + (case when c.name_key is not null and c.ev_name_key is not null
                 and c.name_key = c.ev_name_key then 1 else 0 end)
    + (case when _ev.amount_php is not null
                 and abs(_ev.amount_php - _row.amount_php) <= c.tol then 1 else 0 end)
  end
  from c
$$;

create or replace function public.listener_has_strong_signal(_ev public.listener_events,
                                                             _row public.cash_in_requests)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select (_ev.reference_key is not null
          and coalesce(_row.receipt_reference_key, _row.payer_reference_key) = _ev.reference_key)
      or (_ev.sender_number_key is not null
          and public.cash_in_sender_key(_row) = _ev.sender_number_key)
      or (public.cash_in_account_tail(_row) is not null
          and public.listener_event_account_tail(_ev) is not null
          and public.cash_in_account_tail(_row) = public.listener_event_account_tail(_ev))
$$;

create or replace function public.listener_match_signal_details(_ev public.listener_events,
                                                                _row public.cash_in_requests)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with c as (
    select public.cash_in_sender_key(_row) as sender_key,
           coalesce(_row.receipt_reference_key, _row.payer_reference_key) as ref_key,
           public.cash_in_account_tail(_row) as tail,
           public.listener_event_account_tail(_ev) as ev_tail,
           public.payment_name_key(_row.receipt_sender_name) as name_key,
           public.payment_name_key(_ev.sender_name) as ev_name_key,
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
      'signal', 'account_tail', 'strength', 'strong',
      'receipt', c.tail, 'notification', c.ev_tail,
      'agreed', (not (_ev.sender_number_key is not null and c.sender_key is not null)
                 and c.tail is not null and c.ev_tail is not null and c.tail = c.ev_tail)),
    jsonb_build_object(
      'signal', 'payer_name', 'strength', 'weak',
      'receipt', c.name_key, 'notification', c.ev_name_key,
      'agreed', (c.name_key is not null and c.ev_name_key is not null
                 and c.name_key = c.ev_name_key)),
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
$$;

drop function if exists public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean,
                                                         jsonb, timestamptz, text);

create or replace function public.apply_cash_in_receipt_ocr(
  _id uuid,
  _reference text default null,
  _amount numeric default null,
  _sender text default null,
  _readable boolean default true,
  _details jsonb default null,
  _paid_at timestamptz default null,
  _receiving text default null,
  _provider text default null,
  _sender_name text default null,
  _sender_account text default null,
  _receiving_account text default null,
  _proof_hash text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _key text; _state text; _other uuid; _prov text;
        _reuse uuid;
        _dupe_reason constant text :=
          'This payment reference was already used by another payment on the platform. Held for '
          || 'manual investigation - the earlier transaction was left untouched.';
        _reuse_reason constant text :=
          'This payment screenshot was already used by another cash in. Held for manual '
          || 'investigation - the earlier transaction was left untouched.';
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  _key := public.normalize_payment_reference(_reference);
  _prov := public.payment_provider_by_name(_provider);

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
         receipt_sender_number = coalesce(nullif(btrim(coalesce(_sender, '')), ''),
                                          receipt_sender_number),
         receipt_sender_number_key = coalesce(public.normalize_ph_mobile(_sender),
                                              receipt_sender_number_key),
         receipt_sender_name = coalesce(nullif(btrim(coalesce(_sender_name, '')), ''),
                                        receipt_sender_name),
         receipt_sender_account_masked = coalesce(nullif(btrim(coalesce(_sender_account, '')), ''),
                                                  receipt_sender_account_masked),
         receipt_receiving_account_masked = coalesce(
                                              nullif(btrim(coalesce(_receiving_account, '')), ''),
                                              receipt_receiving_account_masked),
         receipt_receiving_number = coalesce(receipt_receiving_number,
                                             nullif(btrim(coalesce(_receiving, '')), '')),
         receipt_receiving_number_key = coalesce(receipt_receiving_number_key,
                                                 public.normalize_ph_mobile(_receiving)),
         receipt_paid_at = coalesce(_paid_at, receipt_paid_at),
         receipt_check = _state,
         receipt_checked_at = now(),
         receipt_details = _details,
         proof_hash = coalesce(nullif(btrim(coalesce(_proof_hash, '')), ''), proof_hash),
         provider_id = coalesce(provider_id, _prov),
         provider_source = case when provider_id is null and _prov is not null
                                then 'receipt' else provider_source end,
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

  if nullif(btrim(coalesce(_proof_hash, '')), '') is not null then
    select c.id into _reuse
      from public.cash_in_requests c
     where c.proof_hash = _proof_hash
       and c.id <> _id
       and c.status in ('pending', 'approved')
     order by (c.status = 'approved') desc, c.created_at asc
     limit 1;
    if _reuse is not null and not coalesce(_row.duplicate_receipt, false) then
      update public.cash_in_requests
         set duplicate_receipt = true, duplicate_receipt_of = _reuse,
             decision_reason = _reuse_reason,
             authentication_reason = _reuse_reason, authentication_checked_at = now()
       where id = _id;
      return 'duplicate_receipt';
    end if;
  end if;

  if _state = 'matched' then
    _other := public.cash_in_reference_duplicate(_id, _key, _paid_at);
    if _other is not null and not coalesce(_row.duplicate_reference, false) then
      update public.cash_in_requests
         set duplicate_reference = true, duplicate_of = _other, decision_reason = _dupe_reason,
             authentication_reason = _dupe_reason, authentication_checked_at = now()
       where id = _id;
      perform public.record_cash_in_reference_conflict(_id);
      return 'duplicate_reference';
    end if;
  end if;
  perform public.reconcile_cash_in(_id);
  return _state;
end $function$;

revoke all on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb,
  timestamptz, text, text, text, text, text, text) from public;
revoke all on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb,
  timestamptz, text, text, text, text, text, text) from anon;
revoke all on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb,
  timestamptz, text, text, text, text, text, text) from authenticated;
grant execute on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb,
  timestamptz, text, text, text, text, text, text) to service_role;

create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  if coalesce(_row.duplicate_receipt, false) then return 'duplicate_receipt'; end if;
  if _row.proof_hash is not null
     and exists (select 1 from public.cash_in_requests c
                  where c.proof_hash = _row.proof_hash and c.id <> _row.id
                    and c.status = 'approved') then
    return 'duplicate_receipt';
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

  _provider := coalesce(_provider, _row.provider_id, 'gcash');
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
                               'provider_id', _provider,
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

create or replace function public.record_payment_match(_cash_in uuid, _decision text,
                                                       _provider text,
                                                       _reference_hash text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    _row.id, _ev.id, _row.ecosystem_id,
    coalesce(_provider, _ev.provider_id, _row.provider_id), _decision,
    _count, _strong, _signals,
    jsonb_strip_nulls(jsonb_build_object(
      'amount_php', _row.amount_php,
      'provider_id', _row.provider_id,
      'provider_source', _row.provider_source,
      'reference', coalesce(_row.receipt_reference, _row.payer_reference, _row.reference),
      'reference_key', coalesce(_row.receipt_reference_key, _row.payer_reference_key),
      'sender_number', coalesce(_row.receipt_sender_number, _row.sender_number),
      'sender_number_key', public.cash_in_sender_key(_row),
      'sender_name', _row.receipt_sender_name,
      'sender_account_masked', _row.receipt_sender_account_masked,
      'account_tail', public.cash_in_account_tail(_row),
      'receiving_number_key', _row.receipt_receiving_number_key,
      'receiving_account_masked', _row.receipt_receiving_account_masked,
      'receipt_check', _row.receipt_check,
      'receipt_amount_php', _row.receipt_amount_php,
      'proof_hash', _row.proof_hash,
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
      'account_tail', public.listener_event_account_tail(_ev),
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
        provider_id = excluded.provider_id,
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