create or replace function public.shop_member_wallets(_ecosystem_id uuid)
returns table(user_id uuid, balance numeric, is_global boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _ecosystem_id)) then
    raise exception 'Not authorized to read wallets of this shop';
  end if;
  return query
    select m.user_id,
           coalesce(ca.balance, 0)::numeric as balance,
           (ca.ecosystem_id is null) as is_global
      from public.ecosystem_memberships m
      left join public.credit_accounts ca
        on ca.id = public.wallet_id_for(m.user_id, _ecosystem_id)
     where m.ecosystem_id = _ecosystem_id;
end $$;

revoke all on function public.shop_member_wallets(uuid) from public, anon;
grant execute on function public.shop_member_wallets(uuid) to authenticated, service_role;