CREATE OR REPLACE FUNCTION public.assign_shop_admin(_ecosystem_id uuid, _user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _shop text; _old uuid; _old_name text; _new_name text; _op text;
  _price numeric; _state public.subscription_state; _activated boolean := false;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can assign a shop admin';
  end if;
  select name, plan_price, subscription_state
    into _shop, _price, _state
    from public.ecosystems where id = _ecosystem_id;
  if _shop is null then raise exception 'Shop not found'; end if;
  if not exists (select 1 from public.profiles where id = _user_id and deleted_at is null) then
    raise exception 'That account no longer exists';
  end if;
  if public.is_super_admin(_user_id) then
    raise exception 'The platform owner already manages every shop';
  end if;

  select m.user_id into _old from public.ecosystem_memberships m
   where m.ecosystem_id = _ecosystem_id and m.role = 'admin'
     and m.membership_state = 'active' limit 1;
  if _old is null then
    select ur.user_id into _old from public.user_roles ur
     where ur.ecosystem_id = _ecosystem_id and ur.role = 'admin' limit 1;
  end if;
  if _old = _user_id then
    raise exception 'That member already manages this shop';
  end if;

  -- Step the previous admin down to customer, keeping their membership + wallets.
  if _old is not null then
    update public.user_roles set role = 'customer'
      where user_id = _old and ecosystem_id = _ecosystem_id and role = 'admin';
    update public.ecosystem_memberships set role = 'customer'
      where user_id = _old and ecosystem_id = _ecosystem_id;
    select full_name into _old_name from public.profiles where id = _old;
  end if;

  -- Promote the new admin, creating the membership when they are new to the shop.
  insert into public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  values (_user_id, _ecosystem_id, 'admin', 'active')
  on conflict (user_id, ecosystem_id)
  do update set role = 'admin', membership_state = 'active';

  delete from public.user_roles
   where user_id = _user_id and ecosystem_id = _ecosystem_id;
  insert into public.user_roles (user_id, ecosystem_id, role)
  values (_user_id, _ecosystem_id, 'admin')
  on conflict (user_id, role) do nothing;

  -- The assignment itself is the approval: no second workflow.
  update public.membership_applications
     set status = 'approved', decision_reason = coalesce(decision_reason, 'Assigned as shop admin'),
         reviewed_at = now(), reviewed_by = auth.uid()
   where user_id = _user_id and ecosystem_id = _ecosystem_id and status = 'pending';
  update public.ecosystem_invitations
     set status = 'accepted', responded_at = now()
   where user_id = _user_id and ecosystem_id = _ecosystem_id and status = 'pending';

  perform public.ensure_membership_wallets(_user_id, _ecosystem_id);

  -- Free plans need no payment workflow: the assignment is the activation.
  -- Paid plans keep their existing subscription approval/payment workflow.
  _activated := coalesce(_price, 0) <= 0
                and _state in ('pending', 'awaiting_approval');

  update public.ecosystems
     set admin_assigned_at = now(),
         admin_assigned_by = auth.uid(),
         subscription_state = case when _activated then 'active'::public.subscription_state
                                   else subscription_state end
   where id = _ecosystem_id;

  select full_name into _new_name from public.profiles where id = _user_id;
  select coalesce(full_name, 'Platform owner') into _op from public.profiles where id = auth.uid();

  perform public.notify_member(_user_id, _ecosystem_id, 'shop_admin_assigned',
    'You now manage ' || _shop,
    'The platform owner assigned you as the shop admin of ' || _shop || '. You can enter it right away.', '/admin');

  if _old is not null then
    perform public.notify_member(_old, _ecosystem_id, 'shop_admin_assigned',
      'Management of ' || _shop || ' was reassigned',
      'You remain a member of ' || _shop || '; your wallet and history are unchanged.', '/app');
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), _op,
          case when _old is null then 'Assigned shop admin' else 'Replaced shop admin' end,
          coalesce(_new_name, _user_id::text),
          jsonb_build_object('ecosystem_id', _ecosystem_id, 'shop', _shop,
                             'previous_admin_id', _old, 'previous_admin_name', _old_name,
                             'new_admin_id', _user_id, 'new_admin_name', _new_name,
                             'operator_id', auth.uid(), 'at', now(),
                             'plan_price', coalesce(_price, 0),
                             'subscription_state_before', _state,
                             'subscription_state_after',
                               case when _activated then 'active' else _state::text end,
                             'activated_on_assignment', _activated));
end $function$;

-- Backfill: free shops that already have an active admin but were left pending.
with fixed as (
  update public.ecosystems e
     set subscription_state = 'active'
   where coalesce(e.plan_price, 0) <= 0
     and e.subscription_state in ('pending', 'awaiting_approval')
     and e.admin_assigned_at is not null
     and exists (
       select 1 from public.ecosystem_memberships m
        where m.ecosystem_id = e.id and m.role = 'admin' and m.membership_state = 'active')
  returning e.id, e.name, e.admin_assigned_by
)
insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
select f.id, f.admin_assigned_by, 'System', 'Activated free shop', f.name,
       jsonb_build_object('reason', 'Free plan with an assigned active admin',
                          'subscription_state_before', 'pending',
                          'subscription_state_after', 'active',
                          'at', now())
from fixed f;