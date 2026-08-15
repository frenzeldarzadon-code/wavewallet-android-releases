-- Every approved shop member owns exactly one wallet for that shop.
--
-- The production bug: my_shop_wallets() filtered on auth.uid() while every
-- other membership/ledger read uses effective_uid(), so an approved member's
-- wallets vanished whenever the account was being viewed through account
-- access mode — even though the ledger still showed their transactions.
--
-- Run manually against a scratch database.

begin;

-- 1. The wallet list follows the account being viewed, like my_memberships.
do $$
declare _def text;
begin
  select pg_get_functiondef(oid) into _def from pg_proc where proname = 'my_shop_wallets';
  if _def not like '%effective_uid()%' then
    raise exception 'my_shop_wallets must resolve the subject with effective_uid()';
  end if;
  if _def like '%auth.uid()%' then
    raise exception 'my_shop_wallets must not filter on auth.uid() directly';
  end if;
  -- A missing wallet row must still surface the shop with a zero balance.
  if _def not like '%left join%' or _def not like '%coalesce(ca.balance, 0)%' then
    raise exception 'a zero balance must never be rendered as "no wallet"';
  end if;
end $$;

-- 2. Every active membership has a wallet (platform owner excluded).
do $$
declare _missing int;
begin
  select count(*) into _missing
    from public.ecosystem_memberships m
   where m.membership_state = 'active'
     and not exists (select 1 from public.credit_accounts ca
                      where ca.user_id = m.user_id and ca.ecosystem_id = m.ecosystem_id)
     and not exists (select 1 from public.user_roles r
                      where r.user_id = m.user_id and r.role = 'super_admin');
  if _missing > 0 then
    raise exception 'approved memberships without a shop wallet: %', _missing;
  end if;
end $$;

-- 3. Wallet creation is guaranteed by a trigger, not only by the join flow,
--    so admin/Super Admin assignment opens the wallet immediately.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.ecosystem_memberships'::regclass
       and tgname = 'ecosystem_memberships_wallet_guard'
  ) then
    raise exception 'membership approval must always open the shop wallet';
  end if;
end $$;

-- 4. Wallets stay one-per-(member, shop) and never merge across shops.
do $$
begin
  if exists (
    select 1 from public.credit_accounts
     where ecosystem_id is not null
     group by user_id, ecosystem_id having count(*) > 1
  ) then
    raise exception 'duplicate wallet for the same member and shop';
  end if;
end $$;

-- 5. Balances reconcile with the authoritative ledger — no invented balance.
do $$
declare _bad int;
begin
  select count(*) into _bad
    from public.credit_accounts ca
    left join lateral (
      select coalesce(sum(case when l.direction = 'credit' then l.amount else -l.amount end), 0) net
        from public.credit_ledger l where l.account_id = ca.id
    ) t on true
   where ca.ecosystem_id is not null
     and abs(ca.balance - t.net) > 0.005;
  if _bad > 0 then
    raise exception 'wallet balances out of sync with the ledger: %', _bad;
  end if;
end $$;

-- 6. Members only ever read their own wallet; RLS is unchanged.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'credit_accounts'
       and qual like '%user_id = auth.uid()%'
  ) then
    raise exception 'members must keep read access to their own wallet only';
  end if;
end $$;

rollback;
