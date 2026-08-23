-- Go Live reconciliation: bank-to-wallet payments and implausible receipt dates.
--
-- 1. A receipt paid from a bank account (MariBank -> GCash via InstaPay) never
--    carries the bank account number in the receiving wallet's notification, so
--    the re-match trigger must also consider the payment reference.
-- 2. A misread receipt year (OCR read "2024" for a 2026 payment) must not push
--    the matching window years away from the real payment.
-- Neither change relaxes the >=2 independent signals rule, the strong-signal
-- requirement, single-use consumption, or the platform-scope device filter.

create or replace function public.go_live_match_anchor(_req public.subscription_requests)
returns timestamptz
language sql
stable
set search_path = public
as $$
  -- The receipt timestamp is only trusted when it is plausible for this
  -- request: a payment is made shortly before it is submitted. Anything
  -- outside that band (a misread year, a future date) falls back to the
  -- submission time. The matching window itself stays narrow either way.
  select case
    when _req.receipt_paid_at is null then _req.created_at
    when _req.receipt_paid_at between _req.created_at - interval '30 days'
                                  and _req.created_at + interval '1 day'
      then _req.receipt_paid_at
    else _req.created_at
  end
$$;

create or replace function public.reconcile_go_live_request(_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare _req public.subscription_requests; _ev uuid; _n int; _anchor timestamptz;
begin
  select * into _req from public.subscription_requests where id = _request_id for update;
  if _req.id is null then return 'not_found'; end if;
  if _req.status <> 'pending' then return 'not_pending'; end if;
  if _req.purpose not in ('go_live','plan_change') then return 'not_applicable'; end if;
  if _req.payer_number_key is null and _req.payer_reference_key is null then
    return 'missing_sender_number';
  end if;

  _anchor := public.go_live_match_anchor(_req);

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
           between _anchor - interval '3 days' and _anchor + interval '3 days'
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
end $$;

create or replace function public.tg_listener_event_subscription_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare _id uuid;
begin
  if new.outcome <> 'accepted' or new.consumed_cash_in_id is not null
     or new.consumed_subscription_request_id is not null or new.amount_php is null then
    return null;
  end if;
  -- A notification identifies the payer either by sending account or by
  -- reference. Bank-to-wallet transfers only carry the reference, so consider
  -- both; reconcile_go_live_request still decides whether the evidence is
  -- strong enough to approve anything.
  if new.sender_number_key is null and new.reference_key is null then
    return null;
  end if;
  for _id in select r.id from public.subscription_requests r
              where r.status = 'pending' and r.purpose in ('go_live','plan_change')
                and ((new.sender_number_key is not null
                      and coalesce(r.receipt_sender_key, r.payer_number_key) = new.sender_number_key)
                  or (new.reference_key is not null
                      and coalesce(r.receipt_reference_key, r.payer_reference_key) = new.reference_key))
              order by r.created_at loop
    perform public.reconcile_go_live_request(_id);
  end loop;
  return null;
end $$;

revoke all on function public.go_live_match_anchor(public.subscription_requests) from public, anon;
grant execute on function public.go_live_match_anchor(public.subscription_requests) to authenticated, service_role;