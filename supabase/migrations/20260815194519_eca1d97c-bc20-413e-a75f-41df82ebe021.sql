create or replace function public.cash_in_conflict_snapshot(_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'cash_in_id', c.id,
    'reference', c.reference,
    'payment_reference', c.payer_reference,
    'submitted_reference', c.payer_reference,
    'receipt_reference', c.receipt_reference,
    'receipt_check', c.receipt_check,
    'receipt_read_at', c.receipt_checked_at,
    'duplicate_reference', c.duplicate_reference,
    'amount_php', c.amount_php,
    'credits', c.credits,
    'sender_number', coalesce(c.sender_number, c.payer_number),
    'sender_name', nullif(btrim(coalesce(ev.sender_name, '')), ''),
    'receiving_number', public.cash_in_receiving_number(c.ecosystem_id, c.method_id),
    'ecosystem_id', c.ecosystem_id,
    'shop_name', eco.name,
    'credited_to_user_id', c.user_id,
    'credited_to_name', c.requester_name,
    'reseller_name', up.full_name,
    'status', c.status,
    'approval_method', c.approval_method,
    'approved_by_name', c.reviewer_name,
    'approved_at', c.reviewed_at,
    'decision_reason', c.decision_reason,
    'requested_at', c.created_at,
    'reviewed_at', c.reviewed_at,
    'ledger_id', c.ledger_id,
    'credits_released', led.id is not null,
    'credits_released_amount', led.amount,
    'credits_released_at', led.created_at,
    'listener_event_id', c.listener_event_id,
    'payment_seen_at', coalesce(ev.posted_at, ev.created_at),
    'has_screenshot', c.proof_path is not null,
    'request_key', c.request_key
  )
  from public.cash_in_requests c
  left join public.ecosystems eco on eco.id = c.ecosystem_id
  left join public.listener_events ev on ev.id = c.listener_event_id
  left join public.credit_ledger led on led.id = c.ledger_id
  left join public.profiles p on p.id = c.user_id
  left join public.profiles up on up.id = p.reseller_id
  where c.id = _id
$function$;

create or replace function public.record_cash_in_reference_conflict(_new uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _old public.cash_in_requests; _id uuid; _first text;
        _old_at timestamptz; _new_at timestamptz; _at timestamptz;
begin
  select * into _row from public.cash_in_requests where id = _new;
  if _row.id is null or _row.payer_reference_key is null then return null; end if;

  select * into _old from public.cash_in_requests c
   where c.payer_reference_key = _row.payer_reference_key
     and c.id <> _row.id
   order by (c.status = 'approved') desc, c.created_at asc
   limit 1;
  if _old.id is null then return null; end if;

  -- "Credited first" is decided ONLY by the real credit ledger entry, never by
  -- reference, screenshot upload order or review time.
  select l.created_at into _old_at from public.credit_ledger l where l.id = _old.ledger_id;
  select l.created_at into _new_at from public.credit_ledger l where l.id = _row.ledger_id;

  _first := case
              when _old_at is not null and _new_at is not null
                then case when _old_at <= _new_at then 'old' else 'new' end
              when _old_at is not null then 'old'
              when _new_at is not null then 'new'
              else 'none'
            end;
  _at := case _first when 'old' then _old_at when 'new' then _new_at else null end;

  insert into public.cash_in_reference_conflicts (
    reference_key, reference, new_request_id, old_request_id, ecosystem_id,
    credited_first, credited_at, old_snapshot, new_snapshot)
  values (_row.payer_reference_key, coalesce(_row.payer_reference, _old.payer_reference),
          _row.id, _old.id, _row.ecosystem_id, _first, _at,
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
                             'credited_first', _first, 'credited_at', _at));
  return _id;
end $function$;