-- Cash In: receipt (screenshot) reference verification as SECONDARY protection,
-- and duplicate references become a side-by-side review record instead of a
-- silent rejection. The PRIMARY payment match (sending GCash number + exact
-- amount + the shop's configured receiving account, seen by a paired listener
-- phone, in either order) is unchanged.

-- 1. Receipt verification columns -------------------------------------------
alter table public.cash_in_requests
  add column if not exists receipt_reference text,
  add column if not exists receipt_reference_key text,
  add column if not exists receipt_amount_php numeric(14,2),
  add column if not exists receipt_sender_number text,
  add column if not exists receipt_check text not null default 'pending',
  add column if not exists receipt_checked_at timestamptz,
  add column if not exists receipt_details jsonb,
  add column if not exists duplicate_reference boolean not null default false,
  add column if not exists duplicate_of uuid references public.cash_in_requests(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_in_requests_receipt_check_chk') then
    alter table public.cash_in_requests
      add constraint cash_in_requests_receipt_check_chk
      check (receipt_check in ('pending', 'matched', 'mismatch', 'unreadable', 'error', 'skipped'));
  end if;
end $$;

-- 2. Only ONE request may ever be credited on a given reference. A second
--    request keeps its reference key (so it can be compared) but can never be
--    approved automatically.
drop index if exists public.cash_in_requests_reference_key_uniq;
create unique index if not exists cash_in_requests_reference_approved_uniq
  on public.cash_in_requests (payer_reference_key)
  where payer_reference_key is not null and status = 'approved';
create index if not exists cash_in_requests_reference_key_idx
  on public.cash_in_requests (payer_reference_key)
  where payer_reference_key is not null;

-- 3. Duplicate-reference comparison records ----------------------------------
create table if not exists public.cash_in_reference_conflicts (
  id uuid primary key default gen_random_uuid(),
  reference_key text not null,
  reference text,
  new_request_id uuid not null references public.cash_in_requests(id) on delete cascade,
  old_request_id uuid references public.cash_in_requests(id) on delete set null,
  ecosystem_id uuid references public.ecosystems(id) on delete set null,
  credited_first text,
  credited_at timestamptz,
  status text not null default 'open',
  old_snapshot jsonb not null default '{}'::jsonb,
  new_snapshot jsonb not null default '{}'::jsonb,
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (new_request_id)
);

grant select on public.cash_in_reference_conflicts to authenticated;
grant all on public.cash_in_reference_conflicts to service_role;
alter table public.cash_in_reference_conflicts enable row level security;

drop policy if exists "conflicts readable by reviewers" on public.cash_in_reference_conflicts;
create policy "conflicts readable by reviewers"
  on public.cash_in_reference_conflicts for select to authenticated
  using (
    public.is_super_admin(auth.uid())
    or (ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), ecosystem_id))
  );

create index if not exists cash_in_reference_conflicts_open_idx
  on public.cash_in_reference_conflicts (status, created_at desc);

-- 4. Snapshot + conflict recording -------------------------------------------
create or replace function public.cash_in_conflict_snapshot(_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'cash_in_id', c.id,
    'reference', c.reference,
    'payment_reference', c.payer_reference,
    'receipt_reference', c.receipt_reference,
    'receipt_check', c.receipt_check,
    'amount_php', c.amount_php,
    'credits', c.credits,
    'sender_number', coalesce(c.sender_number, c.payer_number),
    'sender_name', nullif(btrim(coalesce(ev.sender_name, '')), ''),
    'receiving_number', public.cash_in_receiving_number(c.ecosystem_id, c.method_id),
    'ecosystem_id', c.ecosystem_id,
    'shop_name', eco.name,
    'credited_to_user_id', c.user_id,
    'credited_to_name', c.requester_name,
    'status', c.status,
    'approval_method', c.approval_method,
    'decision_reason', c.decision_reason,
    'requested_at', c.created_at,
    'reviewed_at', c.reviewed_at,
    'credits_released_at', case when c.status = 'approved' then c.reviewed_at end,
    'listener_event_id', c.listener_event_id,
    'payment_seen_at', coalesce(ev.posted_at, ev.created_at),
    'has_screenshot', c.proof_path is not null,
    'request_key', c.request_key
  )
  from public.cash_in_requests c
  left join public.ecosystems eco on eco.id = c.ecosystem_id
  left join public.listener_events ev on ev.id = c.listener_event_id
  where c.id = _id
$$;

create or replace function public.record_cash_in_reference_conflict(_new uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare _row public.cash_in_requests; _old public.cash_in_requests; _id uuid; _first text;
begin
  select * into _row from public.cash_in_requests where id = _new;
  if _row.id is null or _row.payer_reference_key is null then return null; end if;

  select * into _old from public.cash_in_requests c
   where c.payer_reference_key = _row.payer_reference_key
     and c.id <> _row.id
   order by (c.status = 'approved') desc, c.created_at asc
   limit 1;
  if _old.id is null then return null; end if;

  _first := case
              when _old.status = 'approved' and _row.status = 'approved'
                then case when _old.reviewed_at <= coalesce(_row.reviewed_at, now()) then 'old' else 'new' end
              when _old.status = 'approved' then 'old'
              when _row.status = 'approved' then 'new'
              else 'none'
            end;

  insert into public.cash_in_reference_conflicts (
    reference_key, reference, new_request_id, old_request_id, ecosystem_id,
    credited_first, credited_at, old_snapshot, new_snapshot)
  values (_row.payer_reference_key, coalesce(_row.payer_reference, _old.payer_reference),
          _row.id, _old.id, _row.ecosystem_id, _first,
          case _first when 'old' then _old.reviewed_at when 'new' then _row.reviewed_at else null end,
          public.cash_in_conflict_snapshot(_old.id), public.cash_in_conflict_snapshot(_row.id))
  on conflict (new_request_id) do update
     set old_snapshot = excluded.old_snapshot,
         new_snapshot = excluded.new_snapshot,
         credited_first = excluded.credited_first,
         credited_at = excluded.credited_at
  returning id into _id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Flagged duplicate cash in reference',
          _row.requester_name,
          jsonb_build_object('conflict_id', _id, 'reference_key', _row.payer_reference_key,
                             'new_cash_in_id', _row.id, 'old_cash_in_id', _old.id,
                             'credited_first', _first));
  return _id;
end $$;

revoke all on function public.record_cash_in_reference_conflict(uuid) from public;
grant execute on function public.record_cash_in_reference_conflict(uuid) to service_role;

-- 5. Receipt OCR result ------------------------------------------------------
create or replace function public.apply_cash_in_receipt_ocr(
  _id uuid,
  _reference text default null,
  _amount numeric default null,
  _sender text default null,
  _readable boolean default true,
  _details jsonb default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare _row public.cash_in_requests; _key text; _state text;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  _key := public.normalize_payment_reference(_reference);

  if coalesce(_readable, false) is false or _key is null then
    _state := 'unreadable';
  elsif _row.payer_reference_key is not null and _key = _row.payer_reference_key then
    _state := 'matched';
  else
    _state := 'mismatch';
  end if;

  update public.cash_in_requests
     set receipt_reference = nullif(btrim(coalesce(_reference, '')), ''),
         receipt_reference_key = _key,
         receipt_amount_php = _amount,
         receipt_sender_number = nullif(btrim(coalesce(_sender, '')), ''),
         receipt_check = _state,
         receipt_checked_at = now(),
         receipt_details = _details
   where id = _id;

  if _state = 'matched' then
    perform public.try_auto_approve_cash_in(_id);
  end if;
  return _state;
end $$;

revoke all on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb) from public;
grant execute on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb) to service_role;

-- 6. Automatic approval now also requires a verified receipt reference and a
--    reference nobody else has used.
create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _rule record; _recv text; _note text;
        _ev public.listener_events;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then return 'disabled'; end if;
  if _row.payer_reference_key is null then return 'no_reference'; end if;
  if _row.proof_path is null then return 'no_proof'; end if;
  if _row.duplicate_reference
     or exists (select 1 from public.cash_in_requests c
                 where c.payer_reference_key = _row.payer_reference_key and c.id <> _row.id) then
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
  if _row.sender_number_key is null then return 'no_sender_number'; end if;

  -- A screenshot is never proof. Only a notification from a paired phone on the
  -- shop's receiving account can establish that the money actually arrived.
  if _row.listener_event_id is null then return 'awaiting_listener'; end if;
  select * into _ev from public.listener_events where id = _row.listener_event_id;
  if _ev.id is null or _ev.outcome <> 'accepted' then return 'awaiting_listener'; end if;
  if _ev.sender_number_key is null or _ev.sender_number_key <> _row.sender_number_key then
    return 'number_mismatch';
  end if;
  if _ev.amount_php is null
     or abs(_ev.amount_php - _row.amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;
  if not exists (select 1 from public.listener_devices d
                  where d.id = _ev.device_id and d.status = 'active'
                    and (d.ecosystem_id is null or d.ecosystem_id = _row.ecosystem_id)
                    and d.last_seen_at is not null
                    and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes)) then
    return 'listener_offline';
  end if;

  -- Secondary verification: the reference read off the uploaded receipt must
  -- agree with the reference the member typed. Anything else waits for a human.
  if _row.receipt_check = 'matched' then
    null;
  elsif _row.receipt_check = 'mismatch' then
    return 'receipt_reference_mismatch';
  elsif _row.receipt_check in ('unreadable', 'error') then
    return 'receipt_unreadable';
  else
    return 'awaiting_receipt_check';
  end if;

  _note := 'A GCash notification from the paired listener device on the shop''s receiving '
        || 'account confirms the amount and the sending number, the reference read from the '
        || 'uploaded receipt matches the reference the member submitted, and that reference '
        || 'had never been used. GCash itself was not contacted.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched a real GCash notification', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'cash_in_id', _row.id,
                             'amount_php', _row.amount_php, 'credits', _row.credits,
                             'approval_method', 'automatic', 'matching_result', 'matched',
                             'listener_event_id', _row.listener_event_id,
                             'payer_reference', _row.payer_reference,
                             'receipt_reference', _row.receipt_reference,
                             'requester_id', _row.user_id, 'ecosystem_id', _row.ecosystem_id));
  return 'approved';
end $function$;

-- 7. Submission: a duplicate reference stays PENDING for manual investigation
--    and produces a side-by-side comparison record. The older transaction is
--    never touched.
create or replace function public.request_cash_in(
  _method_id uuid, _amount_php numeric, _payer_reference text default null,
  _notes text default null, _request_key text default null,
  _proof_path text default null, _payer_number text default null)
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
        _dupe_reason constant text :=
          'This GCash reference was already submitted. Held for manual investigation — '
          || 'the earlier transaction was left untouched.';
begin
  _op := auth.uid(); _subject := public.effective_uid();
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

  _ref_key := public.normalize_payment_reference(_payer_reference);
  if _ref_key is null then raise exception 'Enter the GCash payment reference number'; end if;

  _num := nullif(trim(_payer_number), '');
  _num_key := public.normalize_ph_mobile(_num);
  if _num_key is null then raise exception 'Enter the GCash number you paid from'; end if;

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

  _ref := 'CI-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  select c.id into _prev from public.cash_in_requests c
   where c.payer_reference_key = _ref_key
   order by (c.status = 'approved') desc, c.created_at asc
   limit 1;
  _dup := _prev is not null;

  insert into public.cash_in_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
    amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
    method_id, method_name, method_type,
    method_details, payer_reference, payer_reference_key, payer_number, payer_number_key,
    sender_number, sender_number_key, duplicate_reference, duplicate_of,
    notes, proof_path, status, decision_reason)
  values (_ref, _key, _subject, _eco, _name, _role::text,
          _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
          coalesce(_s.cash_in_fee_percent,0), _fee, _net,
          _m.id, _m.name, _m.method_type,
          jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                             'account_number', _m.account_number, 'notes', _m.notes),
          nullif(trim(_payer_reference),''), _ref_key, _num, _num_key, _num, _num_key,
          _dup, _prev,
          nullif(trim(_notes),''), _proof,
          'pending', case when _dup then _dupe_reason else null end)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          case when _dup then 'Flagged duplicate cash in' else 'Requested cash in' end, _name,
          jsonb_build_object('reference', _ref, 'amount_php', _amount_php, 'credits', _credits,
                             'fee_percent', coalesce(_s.cash_in_fee_percent,0), 'fee_php', _fee,
                             'net_php', _net,
                             'method', _m.name, 'requester_id', _subject, 'status', _row.status,
                             'payer_reference', nullif(trim(_payer_reference),''),
                             'duplicate', _dup,
                             'has_proof', true));

  if _dup then
    perform public.record_cash_in_reference_conflict(_row.id);
  else
    -- The customer may have paid before submitting: look back for a real
    -- notification that nobody has used yet. Approval still waits for the
    -- receipt reference check.
    perform public.link_cash_in_listener_event(_row.id);
    perform public.try_auto_approve_cash_in(_row.id);
  end if;

  select * into _row from public.cash_in_requests where id = _row.id;
  return _row;
end $function$;

-- 8. Reviewer view of open duplicate-reference investigations -----------------
create or replace function public.cash_in_reference_conflict_list(_status text default 'open')
returns setof public.cash_in_reference_conflicts
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.* from public.cash_in_reference_conflicts c
   where (_status is null or c.status = _status)
     and (public.is_super_admin(auth.uid())
          or (c.ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), c.ecosystem_id)))
   order by c.created_at desc
$$;

create or replace function public.resolve_cash_in_reference_conflict(_id uuid, _note text default null)
returns public.cash_in_reference_conflicts
language plpgsql
security definer
set search_path to 'public'
as $$
declare _row public.cash_in_reference_conflicts;
begin
  select * into _row from public.cash_in_reference_conflicts where id = _id;
  if _row.id is null then raise exception 'That review record no longer exists'; end if;
  if not (public.is_super_admin(auth.uid())
          or (_row.ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), _row.ecosystem_id))) then
    raise exception 'You cannot review this record';
  end if;
  update public.cash_in_reference_conflicts
     set status = 'resolved', resolution_note = nullif(btrim(coalesce(_note, '')), ''),
         resolved_by = auth.uid(), resolved_at = now()
   where id = _id
  returning * into _row;
  return _row;
end $$;