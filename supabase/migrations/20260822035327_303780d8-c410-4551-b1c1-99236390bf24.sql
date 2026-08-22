-- Cleanup: the unmatched-payments review list still described the retired
-- "strong identity signal" rule. Automatic approval needs only two agreeing
-- details, so the list now reports exactly that. No matching behaviour changes.
create or replace function public.listener_unmatched_events(_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _super boolean;
begin
  _super := public.is_super_admin(_actor);
  if not _super and not exists (
      select 1 from public.ecosystem_memberships m
       where m.user_id = _actor and m.role = 'admin' and m.membership_state = 'active'
         and m.status = 'active') then
    raise exception 'Only the platform owner or a shop admin can read incoming payment events';
  end if;

  return coalesce((
    select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
        'id', v.id, 'device_id', v.device_id, 'device_label', d.label,
        'receiving_number', d.receiving_number,
        'ecosystem_id', d.ecosystem_id, 'ecosystem_name', e.name,
        'provider_id', v.provider_id, 'app_label', v.app_label,
        'amount_php', v.amount_php, 'sender_number', v.sender_number,
        'sender_name', v.sender_name, 'gcash_reference', v.gcash_reference,
        'posted_at', v.posted_at, 'created_at', v.created_at,
        'outcome', v.outcome, 'match_result', v.match_result,
        'review_state', v.review_state, 'review_note', v.review_note,
        'raw_text', case when _super then v.raw_text else null end,
        'candidates', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'cash_in_id', c.id, 'reference', c.reference,
                   'amount_php', c.amount_php, 'created_at', c.created_at,
                   'ecosystem_name', ce.name,
                   'member_name', p.full_name, 'member_handle', p.handle,
                   'signals', public.listener_match_signals(v, c),
                   'auto_matchable', public.listener_match_signals(v, c) >= 2)
                 order by public.listener_match_signals(v, c) desc, c.created_at desc)
            from public.cash_in_requests c
            left join public.ecosystems ce on ce.id = c.ecosystem_id
            left join public.profiles p on p.id = c.user_id
           where c.status = 'pending' and c.listener_event_id is null
             and public.listener_serves_destination(d.id, c.ecosystem_id, c.method_id)), '[]'::jsonb)
      ) as x
        from public.listener_events v
        join public.listener_devices d on d.id = v.device_id
        left join public.ecosystems e on e.id = d.ecosystem_id
       where v.review_state = 'pending'
         and v.consumed_cash_in_id is null
         and coalesce(v.outcome, '') <> 'non_payment'
         and (_super or (d.ecosystem_id is not null and public.is_ecosystem_admin(_actor, d.ecosystem_id)))
       order by v.created_at desc
       limit greatest(1, least(coalesce(_limit, 100), 300))) s), '[]'::jsonb);
end $function$;

comment on function public.listener_has_strong_signal(public.listener_events, public.cash_in_requests)
  is 'Metadata only: recorded on payment_match_records for reporting. It is NOT part of the approval rule — two agreeing details are enough.';