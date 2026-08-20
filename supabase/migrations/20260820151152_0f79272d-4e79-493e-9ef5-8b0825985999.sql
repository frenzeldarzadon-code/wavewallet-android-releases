create or replace function public.reconcile_go_live_request(_request_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _req public.subscription_requests; _ev uuid; _n int; _tol numeric;
begin
  select * into _req from public.subscription_requests where id = _request_id for update;
  if _req.id is null then return 'not_found'; end if;
  if _req.status <> 'pending' then return 'not_pending'; end if;
  if _req.purpose not in ('go_live','plan_change') then return 'not_applicable'; end if;
  if _req.payer_number_key is null then return 'missing_sender_number'; end if;

  select coalesce(r.amount_tolerance_php, 0) into _tol from public.cash_in_auto_rule(null) r;

  select count(*), min(e.id::text)::uuid into _n, _ev
    from public.listener_events e
    join public.listener_devices d on d.id = e.device_id
   where e.outcome = 'accepted'
     and d.owner_role = 'platform'
     and d.status = 'active'
     and e.consumed_cash_in_id is null
     and e.consumed_subscription_request_id is null
     and e.sender_number_key = _req.payer_number_key
     and e.amount_php is not null
     and abs(e.amount_php - _req.amount_due) <= coalesce(_tol, 0)
     and coalesce(e.posted_at, e.created_at)
           between _req.created_at - interval '3 days' and _req.created_at + interval '3 days'
     and not exists (
       select 1 from public.cash_in_requests c
        where c.status = 'pending' and c.listener_event_id is null
          and public.listener_event_fits_cash_in(e, c));

  if _n = 0 then
    update public.subscription_requests
       set auto_state = 'pending',
           auto_reason = 'Waiting for the GCash notification for this amount and sending number'
     where id = _request_id;
    return 'no_match';
  end if;
  if _n > 1 then
    update public.subscription_requests
       set auto_state = 'ambiguous',
           auto_reason = 'More than one GCash notification matches — held for the platform owner to review'
     where id = _request_id;
    return 'ambiguous';
  end if;

  update public.listener_events
     set consumed_subscription_request_id = _request_id,
         match_result = 'matched:subscription', review_state = 'matched'
   where id = _ev and consumed_subscription_request_id is null and consumed_cash_in_id is null;
  if not found then
    update public.subscription_requests set auto_state = 'pending',
           auto_reason = 'The matching GCash notification was already used elsewhere'
     where id = _request_id;
    return 'already_consumed';
  end if;

  update public.subscription_requests
     set listener_event_id = _ev, auto_state = 'verified',
         auto_reason = 'Payment confirmed by the platform GCash listener'
   where id = _request_id;

  return public.activate_go_live_request(_request_id);
end $$;