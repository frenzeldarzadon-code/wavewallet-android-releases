-- Any approved membership always owns a wallet for that shop, no matter which
-- code path created or activated it (join, approval, invitation, admin
-- assignment, Super Admin assignment, future flows).
create or replace function public.membership_wallet_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.membership_state = 'active' then
    perform public.ensure_membership_wallets(new.user_id, new.ecosystem_id);
  end if;
  return new;
end $$;

drop trigger if exists ecosystem_memberships_wallet_guard on public.ecosystem_memberships;
create trigger ecosystem_memberships_wallet_guard
after insert or update of membership_state on public.ecosystem_memberships
for each row execute function public.membership_wallet_guard();
