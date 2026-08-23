alter table public.subscription_requests
  add column if not exists receipt_receiving_key text;

create or replace function public.apply_go_live_receipt_ocr(
  _id uuid, _reference text, _amount numeric, _sender text,
  _readable boolean, _paid_at timestamptz default null, _details jsonb default '{}'::jsonb)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _req public.subscription_requests; _read_key text; _state text; _recv text;
begin
  select * into _req from public.subscription_requests where id = _id for update;
  if _req.id is null then return 'not_found'; end if;
  if _req.status <> 'pending' then return 'not_pending'; end if;

  _read_key := public.normalize_payment_reference(_reference);
  if not coalesce(_readable, false) or _read_key is null then
    _state := 'unreadable';
  elsif _req.payer_reference_key is null or _read_key = _req.payer_reference_key then
    _state := 'matched';
  else
    _state := 'mismatch';
  end if;

  _recv := public.normalize_sender_identifier(coalesce(
    nullif(btrim(coalesce(_details ->> 'receivingNumber', '')), ''),
    nullif(btrim(coalesce(_details ->> 'receivingAccount', '')), ''),
    nullif(btrim(coalesce(_details ->> 'receiving_number', '')), '')
  ));

  update public.subscription_requests
     set receipt_check = _state,
         receipt_reference_key = _read_key,
         receipt_sender_key = public.normalize_sender_identifier(_sender),
         receipt_receiving_key = _recv,
         receipt_amount_php = _amount,
         receipt_paid_at = _paid_at,
         receipt_details = coalesce(_details, '{}'::jsonb)
   where id = _id;

  return _state;
end $function$;

revoke all on function public.apply_go_live_receipt_ocr(uuid, text, numeric, text, boolean, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_go_live_receipt_ocr(uuid, text, numeric, text, boolean, timestamptz, jsonb)
  to service_role;

create or replace function public.go_live_receiving_matches(_ev public.listener_events, _req public.subscription_requests)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.listener_devices d
      left join public.payment_methods m on m.id = _req.payment_method_id
     where d.id = _ev.device_id
       and coalesce(m.account_number, '') <> ''
       and (
         d.receiving_number_key = public.normalize_ph_mobile(m.account_number)
         or public.normalize_sender_identifier(d.receiving_number)
              = public.normalize_sender_identifier(m.account_number)
         or (_req.receipt_receiving_key is not null
             and _req.receipt_receiving_key = public.normalize_sender_identifier(m.account_number))
       )
  )
$$;

revoke all on function public.go_live_receiving_matches(public.listener_events, public.subscription_requests)
  from public, anon;
grant execute on function public.go_live_receiving_matches(public.listener_events, public.subscription_requests)
  to authenticated, service_role;

create or replace function public.go_live_match_signals(_ev public.listener_events, _req public.subscription_requests)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  with c as (
    select coalesce(_req.receipt_reference_key, _req.payer_reference_key) as ref_key,
           coalesce(_req.receipt_sender_key, _req.payer_number_key) as sender_key,
           coalesce((select r.amount_tolerance_php from public.cash_in_auto_rule(null) r), 0) as tol
  )
  select
      (case when _ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key = c.ref_key then 1 else 0 end)
    + (case when _ev.sender_number_key is not null and c.sender_key is not null
                 and _ev.sender_number_key = c.sender_key then 1 else 0 end)
    + (case when _ev.amount_php is not null
                 and (abs(_ev.amount_php - coalesce(_req.receipt_amount_php, _req.amount_paid, _req.amount_due)) <= c.tol
                      or abs(_ev.amount_php - _req.amount_due) <= c.tol) then 1 else 0 end)
    + (case when public.go_live_receiving_matches(_ev, _req) then 1 else 0 end)
  from c
$$;

revoke execute on function public.go_live_match_signals(public.listener_events, public.subscription_requests) from anon;