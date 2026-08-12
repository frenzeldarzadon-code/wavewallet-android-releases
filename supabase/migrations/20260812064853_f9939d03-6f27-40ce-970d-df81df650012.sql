-- Nothing in the public schema should be callable by default.
revoke execute on all functions in schema public from public, anon;

-- Trigger-only / internal functions: not callable through the API at all.
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.apply_credit_entry() from authenticated;
revoke execute on function public.apply_points_entry() from authenticated;
revoke execute on function public.block_ledger_mutation() from authenticated;
revoke execute on function public.enforce_role_tenant() from authenticated;
revoke execute on function public.ensure_wallets() from authenticated;
revoke execute on function public.expire_stale_invitations() from authenticated;

-- Helpers required by RLS policies (evaluated as the calling role).
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_super_admin(uuid) to authenticated;
grant execute on function public.is_ecosystem_admin(uuid, uuid) to authenticated;
grant execute on function public.current_ecosystem(uuid) to authenticated;
grant execute on function public.subscription_ok(uuid) to authenticated;

-- Deliberate, self-authorizing RPCs.
grant execute on function public.get_signup_ecosystem(text) to anon, authenticated;
grant execute on function public.promote_to_reseller(uuid, integer) to authenticated;
grant execute on function public.set_reseller_discount(uuid, integer) to authenticated;
grant execute on function public.regenerate_signup_token(uuid) to authenticated;
grant execute on function public.submit_subscription_payment(uuid, text) to authenticated;
grant execute on function public.review_subscription(uuid, public.subscription_state, timestamptz) to authenticated;
grant execute on function public.invite_admin(text, uuid, public.app_role) to authenticated;
grant execute on function public.revoke_admin_invitation(uuid) to authenticated;

-- Expiring stale invitations runs from the invitation RPCs, not from clients.
create or replace function public.list_admin_invitations()
returns setof public.admin_invitations
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can list invitations';
  end if;
  return query
    select * from public.admin_invitations
    order by case when status = 'pending' then 0 else 1 end, created_at desc;
end; $$;
revoke execute on function public.list_admin_invitations() from public, anon;
grant execute on function public.list_admin_invitations() to authenticated;