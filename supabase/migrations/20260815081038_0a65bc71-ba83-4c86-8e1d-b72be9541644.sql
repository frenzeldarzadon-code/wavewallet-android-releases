-- 1. Wallet list must follow the account being viewed (account access mode),
--    exactly like my_memberships / ledger reads already do.
create or replace function public.my_shop_wallets()
returns table(ecosystem_id uuid, ecosystem_name text, balance numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  select e.id, e.name, coalesce(ca.balance, 0)
    from public.ecosystem_memberships m
    join public.ecosystems e on e.id = m.ecosystem_id
    left join public.credit_accounts ca
      on ca.user_id = m.user_id and ca.ecosystem_id = m.ecosystem_id
   where m.user_id = public.effective_uid()
     and m.membership_state = 'active'
     and m.status = 'active'
     and e.archived_at is null
   order by e.name;
$function$;

-- 2. Safety net: every active membership owns exactly one wallet for that shop
--    (zero balance), platform owner excluded. Idempotent backfill.
insert into public.credit_accounts (user_id, ecosystem_id, balance)
select distinct m.user_id, m.ecosystem_id, 0
  from public.ecosystem_memberships m
 where m.membership_state = 'active'
   and not exists (
     select 1 from public.credit_accounts ca
      where ca.user_id = m.user_id and ca.ecosystem_id = m.ecosystem_id)
   and not exists (
     select 1 from public.user_roles r
      where r.user_id = m.user_id and r.role = 'super_admin');
