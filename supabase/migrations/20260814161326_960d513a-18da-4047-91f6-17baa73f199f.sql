create or replace function public.member_shop_wallets(_user_id uuid)
returns table (
  ecosystem_id uuid,
  ecosystem_name text,
  role app_role,
  balance numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner may inspect a member''s shop wallets';
  end if;

  return query
  select m.ecosystem_id,
         e.name,
         m.role,
         coalesce(ca.balance, 0)::numeric
    from public.ecosystem_memberships m
    join public.ecosystems e on e.id = m.ecosystem_id
    left join public.credit_accounts ca
      on ca.user_id = m.user_id and ca.ecosystem_id = m.ecosystem_id
   where m.user_id = _user_id
     and m.membership_state = 'active'
   order by e.name;
end;
$$;

revoke all on function public.member_shop_wallets(uuid) from public, anon;
grant execute on function public.member_shop_wallets(uuid) to authenticated;