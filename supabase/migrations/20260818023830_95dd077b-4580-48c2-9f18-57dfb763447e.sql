
-- 1. Evidence columns: the ORIGINAL screenshot reading is kept for ever and is
--    never overwritten by anything the customer edits.
alter table public.cash_in_requests
  add column if not exists ocr_reference text,
  add column if not exists ocr_reference_key text,
  add column if not exists ocr_amount_php numeric(14,2),
  add column if not exists ocr_sender_number text,
  add column if not exists ocr_sender_number_key text,
  add column if not exists ocr_paid_at timestamptz,
  add column if not exists ocr_details jsonb,
  add column if not exists receipt_paid_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists reference_source text,
  add column if not exists reference_edited boolean not null default false,
  add column if not exists paid_at_edited boolean not null default false;

create index if not exists cash_in_requests_receipt_ref_key_idx
  on public.cash_in_requests (receipt_reference_key);
create index if not exists cash_in_requests_ocr_ref_key_idx
  on public.cash_in_requests (ocr_reference_key);

-- 2. The established payment reference of a request: what the customer
--    confirmed, else what the receipt reader read, else the original OCR read.
create or replace function public.cash_in_established_reference_key(_row public.cash_in_requests)
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(_row.payer_reference_key, _row.receipt_reference_key, _row.ocr_reference_key)
$$;

grant execute on function public.cash_in_established_reference_key(public.cash_in_requests)
  to authenticated, service_role;

-- 3. request_cash_in — screenshot-first.
drop function if exists public.request_cash_in(uuid, numeric, text, text, text, text, text, text);

create or replace function public.request_cash_in(
  _method_id uuid,
  _amount_php numeric,
  _payer_reference text default null,
  _notes text default null,
  _request_key text default null,
  _proof_path text default null,
  _payer_number text default null,
  _funding_source text default 'platform',
  _paid_at timestamptz default null,
  _ocr jsonb default null)
returns cash_in_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _fee numeric(14,2); _net numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text; _proof text; _folder text;
        _ref_key text; _num text; _num_key text; _dup boolean := false; _prev uuid;
        _fund text; _admin uuid; _admin_acct uuid; _avail numeric(14,2);
        _ocr_ref text; _ocr_ref_key text; _ocr_amount numeric(14,2); _ocr_sender text;
        _ocr_sender_key text; _ocr_paid timestamptz; _est_key text; _paid timestamptz;
        _prev_row public.cash_in_requests; _src text; _ref_edited boolean := false;
        _paid_edited boolean := false;
        _dupe_reason constant text :=
          'This GCash reference was already submitted. Held for manual investigation — '
          || 'the earlier transaction was left untouched.';
begin
  _op := auth.uid(); _subject := public.effective_uid();
  _fund := lower(coalesce(nullif(trim(_funding_source),''), 'platform'));
  if _fund not in ('platform','admin') then raise exception 'Choose a valid cash in destination'; end if;

  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if public.is_super_admin(_subject) then
    raise exception 'The platform owner does not hold a member credit balance and cannot cash in';
  end if;
  _role := coalesce(public.top_role(_subject), 'customer');

  if _amount_php is null or _amount_php <= 0 then raise exception 'Enter how much you are paying'; end if;
  if _amount_php > 10000000 then raise exception 'A single cash in is limited to 10,000,000'; end if;

  select * into _m from public.payment_methods where id = _method_id;
  if _m.id is null or not _m.active then raise exception 'Choose an available payment method'; end if;

  -- Original screenshot reading (evidence). Never treated as proof of payment.
  _ocr_ref := nullif(btrim(coalesce(_ocr->>'reference','')), '');
  _ocr_ref_key := public.normalize_payment_reference(_ocr_ref);
  _ocr_amount := nullif(_ocr->>'amount_php','')::numeric;
  _ocr_sender := nullif(btrim(coalesce(_ocr->>'sender_number','')), '');
  _ocr_sender_key := public.normalize_ph_mobile(_ocr_sender);
  begin
    _ocr_paid := nullif(_ocr->>'paid_at','')::timestamptz;
  exception when others then _ocr_paid := null;
  end;

  -- A reference is no longer demanded from the customer: the screenshot may
  -- supply it. Anything missing simply keeps the request in manual review.
  _ref_key := public.normalize_payment_reference(_payer_reference);
  _est_key := coalesce(_ref_key, _ocr_ref_key);
  _ref_edited := _ref_key is not null and _ocr_ref_key is not null and _ref_key <> _ocr_ref_key;
  _src := case
            when _ref_edited then 'customer_edited'
            when _ref_key is not null then 'customer'
            when _ocr_ref_key is not null then 'ocr'
            else null end;

  -- Same for the sending number: use the customer's value when given, else the
  -- number read off the receipt.
  _num := coalesce(nullif(trim(_payer_number), ''), _ocr_sender);
  _num_key := public.normalize_ph_mobile(_num);

  _paid := coalesce(_paid_at, _ocr_paid);
  _paid_edited := _paid_at is not null and _ocr_paid is not null
                  and abs(extract(epoch from (_paid_at - _ocr_paid))) > 60;

  _proof := nullif(trim(_proof_path), '');
  if _proof is null then raise exception 'Attach your payment screenshot'; end if;
  _folder := split_part(_proof, '/', 1);
  if _folder is null or _folder = '' or (_folder <> _subject::text and _folder <> _op::text) then
    raise exception 'That payment screenshot does not belong to this member';
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);
  select * into _row from public.cash_in_requests where request_key = _key;
  if _row.id is not null then return _row; end if;

  select * into _s from public.money_settings();
  _fee := round(_amount_php * coalesce(_s.cash_in_fee_percent,0) / 100.0, 2);
  _net := round(_amount_php - _fee, 2);
  if _net <= 0 then raise exception 'That amount is too small to cash in'; end if;
  _credits := round(_net * _s.credits_per_unit / _s.php_per_unit, 2);
  if _credits <= 0 then raise exception 'That amount is too small to cash in'; end if;

  if _fund = 'admin' then
    if _eco is null then raise exception 'Choose a shop before cashing in with your shop admin'; end if;
    _admin := public.shop_funding_admin(_eco);
    if _admin is null then raise exception 'This shop has no active admin to fund a cash in'; end if;
    if _admin = _subject then
      raise exception 'A shop admin cannot cash in against their own wallet';
    end if;
    _admin_acct := public.ensure_credit_account(_admin, _eco);
    if _admin_acct is null then raise exception 'The shop admin has no wallet in this shop'; end if;
    perform 1 from public.credit_accounts where id = _admin_acct for update;
    select c.available into _avail from public.admin_cash_in_capacity(_eco) c;
    if coalesce(_avail,0) < _credits then
      raise exception 'Your shop admin can only fund % credits right now', trunc(coalesce(_avail,0));
    end if;
  end if;

  _ref := 'CI-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  -- Duplicate protection on the ESTABLISHED reference, whatever supplied it.
  if _est_key is not null then
    select * into _prev_row from public.cash_in_requests c
     where _est_key in (coalesce(c.payer_reference_key,''),
                        coalesce(c.receipt_reference_key,''),
                        coalesce(c.ocr_reference_key,''))
     order by (c.status = 'approved') desc, c.created_at asc
     limit 1;
  end if;

  if _prev_row.id is not null then
    if _prev_row.user_id = _subject and _prev_row.status = 'approved' then
      raise exception 'Payment Already Submitted. This GCash payment was already processed and credited to your WaveWallet account. Nothing was added to your account from this submission.';
    elsif _prev_row.user_id = _subject and _prev_row.status = 'pending' then
      raise exception 'Payment Already Submitted. This GCash payment is already waiting for review as %. Nothing new was created — check that request instead.', _prev_row.reference;
    elsif _prev_row.status in ('rejected','cancelled') then
      -- A safe correction is allowed; a duplicate/fraud rejection stays in
      -- manual review instead of being permanently blocked.
      _dup := coalesce(_prev_row.decision_reason,'') ilike '%duplicate%'
              or coalesce(_prev_row.decision_reason,'') ilike '%fraud%';
      _prev := case when _dup then _prev_row.id else null end;
    else
      _dup := true; _prev := _prev_row.id;
    end if;
  end if;

  insert into public.cash_in_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
    amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
    method_id, method_name, method_type,
    method_details, payer_reference, payer_reference_key, payer_number, payer_number_key,
    sender_number, sender_number_key, duplicate_reference, duplicate_of,
    notes, proof_path, status, decision_reason,
    funding_source, funding_admin_id, funding_account_id,
    ocr_reference, ocr_reference_key, ocr_amount_php, ocr_sender_number,
    ocr_sender_number_key, ocr_paid_at, ocr_details,
    paid_at, reference_source, reference_edited, paid_at_edited)
  values (_ref, _key, _subject, _eco, _name, _role::text,
          _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
          coalesce(_s.cash_in_fee_percent,0), _fee, _net,
          _m.id, _m.name, _m.method_type,
          jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                             'account_number', _m.account_number, 'notes', _m.notes),
          nullif(trim(_payer_reference),''), _ref_key, _num, _num_key, _num, _num_key,
          _dup, _prev,
          nullif(trim(_notes),''), _proof,
          'pending', case when _dup then _dupe_reason else null end,
          _fund, _admin, _admin_acct,
          _ocr_ref, _ocr_ref_key, _ocr_amount, _ocr_sender,
          _ocr_sender_key, _ocr_paid, _ocr,
          _paid, _src, _ref_edited, _paid_edited)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          case when _dup then 'Flagged duplicate cash in' else 'Requested cash in' end, _name,
          jsonb_build_object('reference', _ref, 'amount_php', _amount_php, 'credits', _credits,
                             'fee_percent', coalesce(_s.cash_in_fee_percent,0), 'fee_php', _fee,
                             'net_php', _net,
                             'method', _m.name, 'requester_id', _subject, 'status', _row.status,
                             'payer_reference', nullif(trim(_payer_reference),''),
                             'ocr_reference', _ocr_ref,
                             'reference_source', _src,
                             'reference_edited', _ref_edited,
                             'paid_at', _paid,
                             'paid_at_edited', _paid_edited,
                             'funding_source', _fund, 'funding_admin_id', _admin,
                             'duplicate', _dup,
                             'has_proof', true));

  if _dup then
    perform public.record_cash_in_reference_conflict(_row.id);
  else
    perform public.link_cash_in_listener_event(_row.id);
    perform public.try_auto_approve_cash_in(_row.id);
  end if;

  select * into _row from public.cash_in_requests where id = _row.id;
  return _row;
end $function$;

grant execute on function public.request_cash_in(uuid, numeric, text, text, text, text, text, text, timestamptz, jsonb)
  to authenticated, service_role;

-- 4. Receipt reading (Layer 2). The reference READ OFF the receipt is the
--    authoritative one; a customer value only ever contradicts it.
drop function if exists public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb);

create or replace function public.apply_cash_in_receipt_ocr(
  _id uuid,
  _reference text default null,
  _amount numeric default null,
  _sender text default null,
  _readable boolean default true,
  _details jsonb default null,
  _paid_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _key text; _state text; _other uuid;
        _dupe_reason constant text :=
          'This GCash reference was already submitted. Held for manual investigation — '
          || 'the earlier transaction was left untouched.';
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  _key := public.normalize_payment_reference(_reference);

  if coalesce(_readable, false) is false or _key is null then
    _state := 'unreadable';
  elsif _row.payer_reference_key is null then
    -- Screenshot-first submission: the receipt supplies the reference.
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
         receipt_sender_number = nullif(btrim(coalesce(_sender, '')), ''),
         receipt_paid_at = _paid_at,
         receipt_check = _state,
         receipt_checked_at = now(),
         receipt_details = _details,
         -- Original evidence is only ever filled in, never overwritten.
         ocr_reference = coalesce(ocr_reference, nullif(btrim(coalesce(_reference, '')), '')),
         ocr_reference_key = coalesce(ocr_reference_key, _key),
         ocr_amount_php = coalesce(ocr_amount_php, _amount),
         ocr_sender_number = coalesce(ocr_sender_number, nullif(btrim(coalesce(_sender, '')), '')),
         ocr_sender_number_key = coalesce(ocr_sender_number_key, public.normalize_ph_mobile(_sender)),
         ocr_paid_at = coalesce(ocr_paid_at, _paid_at),
         ocr_details = coalesce(ocr_details, _details),
         paid_at = coalesce(paid_at, _paid_at),
         -- The sending number may come from the receipt when none was typed.
         sender_number = coalesce(sender_number, nullif(btrim(coalesce(_sender, '')), '')),
         sender_number_key = coalesce(sender_number_key, public.normalize_ph_mobile(_sender))
   where id = _id;

  if _state = 'matched' then
    -- The receipt reference may itself already belong to another payment.
    select c.id into _other from public.cash_in_requests c
     where c.id <> _id
       and c.status in ('pending','approved')
       and _key in (coalesce(c.payer_reference_key,''), coalesce(c.receipt_reference_key,''))
     order by (c.status = 'approved') desc, c.created_at asc
     limit 1;
    if _other is not null and not coalesce(_row.duplicate_reference, false) then
      update public.cash_in_requests
         set duplicate_reference = true, duplicate_of = _other, decision_reason = _dupe_reason
       where id = _id;
      perform public.record_cash_in_reference_conflict(_id);
      return 'duplicate_reference';
    end if;
    perform public.try_auto_approve_cash_in(_id);
  end if;
  return _state;
end $function$;

grant execute on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb, timestamptz)
  to authenticated, service_role;

-- 5. Automatic approval — both layers, established reference.
create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text;
        _ev public.listener_events; _receipt text; _refkey text;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then return 'disabled'; end if;

  if _row.proof_path is null then return 'no_proof'; end if;

  _receipt := coalesce(_row.receipt_check, 'pending');
  _refkey := coalesce(_row.payer_reference_key, _row.receipt_reference_key);

  -- A missing customer-typed reference is NOT a failure any more: the
  -- screenshot supplies it. Only a receipt that has not been read yet, or
  -- could not be read, keeps the request waiting.
  if _refkey is null then
    if _receipt in ('unreadable','error') then return 'receipt_unreadable'; end if;
    return 'awaiting_receipt_check';
  end if;

  if _row.duplicate_reference
     or exists (select 1 from public.cash_in_requests c
                 where c.id <> _row.id
                   and _refkey in (coalesce(c.payer_reference_key,''),
                                   coalesce(c.receipt_reference_key,''))) then
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
  if coalesce(_rule.layer2_require_sender_match, true) and _row.sender_number_key is null then
    return 'no_sender_number';
  end if;

  -- Layer 1: the real GCash notification. A listener reference is optional;
  -- when present it must agree with the established reference.
  if _row.listener_event_id is null then
    if coalesce(_rule.require_listener_match, true) then return 'awaiting_listener'; end if;
  else
    select * into _ev from public.listener_events where id = _row.listener_event_id;
    if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
    if coalesce(_rule.layer2_require_sender_match, true)
       and (_ev.sender_number_key is null or _ev.sender_number_key <> _row.sender_number_key) then
      return 'number_mismatch';
    end if;
    if coalesce(_rule.layer2_require_amount_match, true)
       and (_ev.amount_php is null
            or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0)) then
      return 'amount_mismatch';
    end if;
    if _ev.reference_key is not null and _ev.reference_key <> _refkey then
      return 'reference_mismatch';
    end if;
    if coalesce(_rule.layer2_require_listener_reference, false) and _ev.reference_key is null then
      return 'reference_mismatch';
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

  -- Layer 2: the receipt evidence itself.
  if _receipt = 'mismatch' then return 'receipt_reference_mismatch'; end if;
  if coalesce(_rule.require_receipt_match, true) then
    if _receipt in ('unreadable', 'error') then return 'receipt_unreadable'; end if;
    if _receipt <> 'matched' then return 'awaiting_receipt_check'; end if;
  end if;
  -- Receipt evidence must not contradict the submitted amount or sender.
  if _row.receipt_amount_php is not null
     and abs(_row.receipt_amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;
  if _row.receipt_sender_number is not null and _row.sender_number_key is not null
     and public.normalize_ph_mobile(_row.receipt_sender_number) is not null
     and public.normalize_ph_mobile(_row.receipt_sender_number) <> _row.sender_number_key then
    return 'number_mismatch';
  end if;

  if coalesce(_rule.verification_mode, 'active') = 'staged' then
    update public.cash_in_requests
       set staged_result = 'would_approve', staged_at = now()
     where id = _row.id;
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_row.ecosystem_id, null, 'Automatic matching (staged)', 'Cash in would be approved',
            _row.requester_name,
            jsonb_build_object('cash_in_id', _row.id, 'amount_php', _row.amount_php,
                               'listener_event_id', _row.listener_event_id,
                               'receipt_check', _row.receipt_check));
    return 'staged';
  end if;

  _note := 'A GCash notification from a paired listener device confirms the amount and the sending '
        || 'number, and the payment reference on the receipt has never been used before.';
  perform public.approve_cash_in(_row.id, _note, 'automatic');
  return 'approved';
end $function$;
