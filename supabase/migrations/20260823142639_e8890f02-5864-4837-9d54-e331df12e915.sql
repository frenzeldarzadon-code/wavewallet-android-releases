create or replace function public.cancel_go_live_payment(_request_id uuid)
returns public.subscription_requests
language plpgsql
security definer
set search_path = public
as $$
declare _req public.subscription_requests; _eco public.ecosystems; _actor text;
begin
  select * into _req from public.subscription_requests where id = _request_id for update;
  if _req.id is null then raise exception 'Request not found'; end if;

  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _req.ecosystem_id)) then
    raise exception 'Only this shop admin can withdraw its subscription payment';
  end if;
  if _req.status <> 'pending' then
    raise exception 'This payment has already been decided';
  end if;
  if coalesce(_req.auto_state, 'pending') in ('verified', 'activated') then
    raise exception 'This payment has already been verified — it can no longer be withdrawn';
  end if;

  select * into _eco from public.ecosystems where id = _req.ecosystem_id;
  select coalesce(full_name, 'Shop operator') into _actor from public.profiles where id = auth.uid();

  update public.subscription_requests set
    status = 'rejected',
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    reviewed_by_name = coalesce(_actor, 'Shop operator'),
    decision_reason = 'Withdrawn by the shop admin',
    auto_state = 'cancelled',
    auto_reason = 'Withdrawn by the shop admin before verification'
  where id = _request_id
  returning * into _req;

  update public.ecosystems
     set subscription_state = case when coalesce(is_review, false)
                                   then 'pending'::public.subscription_state
                                   else 'active'::public.subscription_state end
   where id = _req.ecosystem_id
     and subscription_state = 'awaiting_approval';

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_req.ecosystem_id, auth.uid(), coalesce(_actor, 'Shop operator'),
          'Withdrew pending subscription payment', coalesce(_eco.name, 'Shop'),
          jsonb_build_object('request_id', _req.id, 'reference', _req.payment_reference,
                             'amount_paid', _req.amount_paid, 'plan', _req.plan_name));

  return _req;
end;
$$;

revoke all on function public.cancel_go_live_payment(uuid) from public, anon;
grant execute on function public.cancel_go_live_payment(uuid) to authenticated;