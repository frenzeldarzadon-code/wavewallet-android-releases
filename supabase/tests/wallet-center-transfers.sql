-- Wallet Center transfer authorization.
--
-- Verifies the rules enforced by `public.transfer_credits_in_shop`,
-- `public.wallet_upward_recipients` and the existing
-- `public.transfer_credits_between_shops`:
--
--   1. A subreseller may send UP to their own parent reseller, but only when
--      that reseller is an active member of the SAME shop.
--   2. A subreseller may send to an admin of that shop.
--   3. An unrelated recipient (another reseller, or someone in another shop)
--      is rejected.
--   4. Nobody but a subreseller of that shop gets the upward recipient list.
--   5. A cross-shop move only ever touches wallets owned by the same account.
--   6. Balances can never go negative, and a transfer is atomic: both legs
--      share one transaction id or neither exists.
--   7. Reseller -> own subreseller keeps working.
--
-- Run manually against a scratch database.

begin;

-- 1. Upward recipients are only ever the caller's parent reseller (in the same
--    shop) or an admin of that shop. The function never returns anyone else.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'wallet_upward_recipients';
  if _def is null then raise exception 'wallet_upward_recipients is missing'; end if;
  if _def not like '%membership_role(_subject, _ecosystem_id) is distinct from ''subreseller''%' then
    raise exception 'only a subreseller of that shop may see an upward path';
  end if;
  if _def not like '%p.id = _parent%' or _def not like '%membership_role(p.id, _ecosystem_id) = ''reseller''%' then
    raise exception 'the parent reseller must also be an active reseller in the same shop';
  end if;
  if _def not like '%m.role = ''admin''%' then
    raise exception 'active shop admins must be offered as recipients';
  end if;
end $$;

-- 2. The shop-scoped transfer re-derives the caller, re-checks membership in
--    the named shop and refuses self-transfer / non-positive amounts.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def is null then raise exception 'transfer_credits_in_shop is missing'; end if;
  if _def not like '%effective_uid()%' then raise exception 'caller must be re-derived server side'; end if;
  if _def not like '%You cannot send credits to yourself%' then raise exception 'self-transfer must be blocked'; end if;
  if _def not like '%You are not an approved member of that shop%' then
    raise exception 'the sender must be an approved member of the named shop';
  end if;
  if _def not like '%That member does not belong to this shop%' then
    raise exception 'the recipient must be an approved member of the named shop';
  end if;
  if _def not like '%for update%' then raise exception 'the source wallet must be locked'; end if;
  if _def not like '%Not enough credits in%' then raise exception 'insufficient balance must be refused'; end if;
  if _def not like '%You are not allowed to send credits to that member%' then
    raise exception 'unrelated recipients must be refused';
  end if;
  -- Face value only: no commission is ever added by this path.
  if _def not like '%commission_percent, commission_amount%' or _def not like '%_amount, 0, 0%' then
    raise exception 'shop-scoped transfers must move face value with no commission';
  end if;
end $$;

-- 3. Nobody may be granted the upward path without a subreseller membership,
--    and no execute rights leak to anonymous callers.
do $$
begin
  if has_function_privilege('anon', 'public.transfer_credits_in_shop(uuid,uuid,numeric,text)', 'execute')
     or has_function_privilege('anon', 'public.wallet_upward_recipients(uuid)', 'execute') then
    raise exception 'wallet functions must not be callable without signing in';
  end if;
end $$;

-- 4. Every credit ledger pair written by a transfer shares one transaction id
--    (the receiving leg carries the '-R' suffix), so a partial transfer cannot
--    exist in history.
do $$
begin
  if exists (
    select 1 from public.credit_ledger l
     where l.reason = 'Credit transfer sent'
       and not exists (
         select 1 from public.credit_ledger r
          where r.tx_id = l.tx_id || '-R'
            and r.reason = 'Credit transfer received'
            and r.amount = l.amount
            and r.ecosystem_id is not distinct from l.ecosystem_id
       )
  ) then
    raise exception 'a sent transfer must always have its matching received leg';
  end if;
end $$;

-- 5. No wallet may ever hold a negative balance, in any shop.
do $$
begin
  if exists (select 1 from public.credit_accounts where balance < 0) then
    raise exception 'credit wallets must never go negative';
  end if;
  if exists (select 1 from public.credit_ledger where balance_after < 0) then
    raise exception 'no ledger entry may leave a negative balance';
  end if;
end $$;

-- 6. Cross-shop moves stay inside one account: both legs belong to the same
--    user, and both shops are shops that user is a member of.
do $$
begin
  if exists (
    select 1 from public.shop_transfer_fees f
     where not exists (
             select 1 from public.ecosystem_memberships m
              where m.user_id = f.user_id and m.ecosystem_id = f.from_ecosystem_id)
        or not exists (
             select 1 from public.ecosystem_memberships m
              where m.user_id = f.user_id and m.ecosystem_id = f.to_ecosystem_id)
  ) then
    raise exception 'a cross-shop transfer may only touch the sender''s own shops';
  end if;
  if exists (select 1 from public.shop_transfer_fees where from_ecosystem_id = to_ecosystem_id) then
    raise exception 'a cross-shop transfer needs two different shops';
  end if;
  if exists (select 1 from public.shop_transfer_fees where net_credits <> gross_credits - fee_credits) then
    raise exception 'the destination must receive the amount less the flat fee';
  end if;
end $$;

-- 7. Reseller -> own subreseller remains authorized (unchanged behaviour).
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def not like '%_their_role = ''subreseller'' and _r_parent = _subject%' then
    raise exception 'a reseller must still be able to load their own subresellers';
  end if;
  if _def not like '%_their_role = ''reseller'' and _my_parent = _recipient_id%' then
    raise exception 'a subreseller must be able to send to their own parent reseller only';
  end if;
end $$;

rollback;
