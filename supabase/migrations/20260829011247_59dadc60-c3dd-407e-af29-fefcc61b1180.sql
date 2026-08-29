
-- Balances for kept members, so the review screen can show why removal is blocked.
create or replace function public.membership_review_balances(_application_ids uuid[])
returns table (application_id uuid, balance numeric)
language sql
stable
security definer
set search_path to 'public, pg_temp'
as $$
  select a.id,
         coalesce((select ca.balance from public.credit_accounts ca
                    where ca.user_id = a.user_id
                      and ca.ecosystem_id = a.ecosystem_id), 0)
    from public.membership_applications a
   where a.id = any(_application_ids)
     and public.can_review_applications(auth.uid(), a.ecosystem_id);
$$;

revoke all on function public.membership_review_balances(uuid[]) from public, anon;
grant execute on function public.membership_review_balances(uuid[]) to authenticated;

-- Remove a member who was already kept, from THIS shop only.
create or replace function public.remove_kept_shop_member(_application_id uuid, _reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public, pg_temp'
as $$
declare
  _app public.membership_applications%rowtype;
  _actor_name text;
  _actor_role public.app_role;
  _coin_balance numeric := 0;
  _target_name text;
  _other_eco uuid;
begin
  perform public.assert_actor_active();

  select * into _app from public.membership_applications where id = _application_id for update;
  if _app.id is null then raise exception 'Member review record not found'; end if;
  if _app.status <> 'approved' then
    raise exception 'Only a member who was kept in this shop can be removed here';
  end if;
  if not public.can_review_applications(auth.uid(), _app.ecosystem_id) then
    raise exception 'Only the shop admin or platform owner can remove members from this shop';
  end if;

  select coalesce(full_name, email) into _actor_name from public.profiles where id = auth.uid();
  if public.is_super_admin(auth.uid()) then
    _actor_role := 'super_admin';
  else
    select m.role into _actor_role
      from public.ecosystem_memberships m
     where m.user_id = auth.uid()
       and m.ecosystem_id = _app.ecosystem_id
       and m.membership_state = 'active'
       and m.status = 'active'
       and m.role = 'admin'
     limit 1;
  end if;

  select coalesce(ca.balance, 0) into _coin_balance
    from public.credit_accounts ca
   where ca.user_id = _app.user_id and ca.ecosystem_id = _app.ecosystem_id;

  if coalesce(_coin_balance, 0) <> 0 then
    raise exception 'This member cannot be removed while their balance in this shop is % coins. It must be exactly 0 first.', _coin_balance;
  end if;

  select coalesce(p.full_name, p.email) into _target_name
    from public.profiles p where p.id = _app.user_id;

  update public.ecosystem_memberships
     set membership_state = 'removed', updated_at = now()
   where user_id = _app.user_id and ecosystem_id = _app.ecosystem_id;

  delete from public.user_roles
   where user_id = _app.user_id and ecosystem_id = _app.ecosystem_id and role <> 'super_admin';

  select m.ecosystem_id into _other_eco
    from public.ecosystem_memberships m
   where m.user_id = _app.user_id
     and m.membership_state = 'active'
     and m.status = 'active'
   order by m.updated_at desc
   limit 1;

  if public.active_ecosystem(_app.user_id) = _app.ecosystem_id then
    update public.profiles
       set ecosystem_id = _other_eco,
           active_ecosystem_id = _other_eco,
           reseller_id = case when _other_eco is null then null
                              else (select m.reseller_id from public.ecosystem_memberships m
                                    where m.user_id = _app.user_id and m.ecosystem_id = _other_eco
                                      and m.membership_state='active' limit 1) end,
           reseller_discount_percent = case when _other_eco is null then 0
                                            else coalesce((select m.reseller_discount_percent from public.ecosystem_memberships m
                                                           where m.user_id = _app.user_id and m.ecosystem_id = _other_eco
                                                             and m.membership_state='active' limit 1),0) end,
           reseller_commission_percent = case when _other_eco is null then null
                                              else (select m.reseller_commission_percent from public.ecosystem_memberships m
                                                    where m.user_id = _app.user_id and m.ecosystem_id = _other_eco
                                                      and m.membership_state='active' limit 1) end,
           sale_commission_percent = case when _other_eco is null then null
                                          else (select m.sale_commission_percent from public.ecosystem_memberships m
                                                where m.user_id = _app.user_id and m.ecosystem_id = _other_eco
                                                  and m.membership_state='active' limit 1) end,
           updated_at = now()
     where id = _app.user_id;
  end if;

  update public.membership_applications
     set status = 'rejected',
         decision_reason = nullif(btrim(coalesce(_reason, 'Removed from this shop by shop admin')), ''),
         decided_by = auth.uid(),
         decider_name = coalesce(_actor_name, 'Platform owner'),
         decider_role = _actor_role,
         decided_at = now(), updated_at = now()
   where id = _app.id;

  insert into public.audit_logs
    (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values
    (_app.ecosystem_id, auth.uid(), coalesce(_actor_name, 'Platform owner'),
     'Removed kept shop member', coalesce(_target_name, _app.email),
     jsonb_build_object('application_id', _app.id, 'user_id', _app.user_id,
                        'actor_role', _actor_role, 'coin_balance', coalesce(_coin_balance, 0),
                        'reason', nullif(btrim(coalesce(_reason, '')), '')));
end;
$$;

revoke all on function public.remove_kept_shop_member(uuid, text) from public, anon;
grant execute on function public.remove_kept_shop_member(uuid, text) to authenticated;
