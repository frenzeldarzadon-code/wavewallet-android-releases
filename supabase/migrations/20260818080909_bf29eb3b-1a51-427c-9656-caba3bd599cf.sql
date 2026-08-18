do $block$
declare _event uuid;
begin
  for _event in
    select e.id
      from public.listener_events e
      join public.listener_devices d on d.id = e.device_id
     where e.outcome = 'accepted'
       and e.consumed_cash_in_id is null
       and e.match_result = 'no_pending_match'
       and d.status = 'active'
     order by e.created_at
  loop
    perform public.match_listener_event(_event);
  end loop;
end $block$;