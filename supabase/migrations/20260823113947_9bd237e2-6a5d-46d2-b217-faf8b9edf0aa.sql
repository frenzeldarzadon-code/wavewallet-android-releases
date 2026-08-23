create or replace function public.go_live_match_signals(_ev listener_events, _req subscription_requests)
returns integer
language sql
stable
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
  from c
$$;

create or replace function public.go_live_has_strong_signal(_ev listener_events, _req subscription_requests)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select (_ev.reference_key is not null
          and coalesce(_req.receipt_reference_key, _req.payer_reference_key) = _ev.reference_key)
      or (_ev.sender_number_key is not null
          and coalesce(_req.receipt_sender_key, _req.payer_number_key) = _ev.sender_number_key)
$$;

revoke execute on function public.go_live_match_signals(listener_events, subscription_requests) from anon;
revoke execute on function public.go_live_has_strong_signal(listener_events, subscription_requests) from anon;

create or replace function public.reconcile_go_live_request(_request_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _req public.subscription_requests; _ev uuid; _n int;
begin
  select * into _req from public.subscription_requests where id = _request_id for update;
  if _req.id is null then return 'not_found'; end if;
  if _req.status <> 'pending' then return 'not_pending'; end if;
  if _req.purpose not in ('go_live','plan_change') then return 'not_applicable'; end if;
  if _req.payer_number_key is null and _req.payer_reference_key is null then
    return 'missing_sender_number';
  end if;

  -- At least two independent details must agree (reference, sending account,
  -- amount) and at least one of them must be the reference or the sending
  -- account: amount on its own can never confirm a payment. The notification
  -- timestamp is only used as a wide sanity window, never as a matching signal.
  select count(*), min(e.id::text)::uuid into _n, _ev
    from public.listener_events e
    join public.listener_devices d on d.id = e.device_id
   where e.outcome = 'accepted'
     and d.owner_role = 'platform'
     and d.status = 'active'
     and e.consumed_cash_in_id is null
     and e.consumed_subscription_request_id is null
     and e.amount_php is not null
     and public.go_live_match_signals(e, _req) >= 2
     and public.go_live_has_strong_signal(e, _req)
     and coalesce(e.posted_at, e.created_at)
           between coalesce(_req.receipt_paid_at, _req.created_at) - interval '3 days'
               and coalesce(_req.receipt_paid_at, _req.created_at) + interval '3 days'
     and not exists (
       select 1 from public.cash_in_requests c
        where c.status = 'pending' and c.listener_event_id is null
          and public.listener_event_fits_cash_in(e, c));

  if _n = 0 then
    update public.subscription_requests
       set auto_state = 'pending',
           auto_reason = 'Waiting for a payment notification that matches at least two details of this receipt'
     where id = _request_id;
    return 'no_match';
  end if;
  if _n > 1 then
    update public.subscription_requests
       set auto_state = 'ambiguous',
           auto_reason = 'More than one payment notification matches — held for the platform owner to review'
     where id = _request_id;
    return 'ambiguous';
  end if;

  update public.listener_events
     set consumed_subscription_request_id = _request_id,
         match_result = 'matched:subscription', review_state = 'matched'
   where id = _ev and consumed_subscription_request_id is null and consumed_cash_in_id is null;
  if not found then
    update public.subscription_requests set auto_state = 'pending',
           auto_reason = 'The matching payment notification was already used elsewhere'
     where id = _request_id;
    return 'already_consumed';
  end if;

  update public.subscription_requests
     set listener_event_id = _ev, auto_state = 'verified',
         auto_reason = 'Payment confirmed by the platform payment listener'
   where id = _request_id;

  return public.activate_go_live_request(_request_id);
end $function$;