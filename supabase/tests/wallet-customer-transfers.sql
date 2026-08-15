-- Wallet Center: operator/reseller/subreseller -> customer, and customer -> peer
-- customer transfers, plus the customer's own cross-shop move.
--
-- Every rule below is enforced inside `public.transfer_credits_in_shop`
-- (face-value, shop-scoped) and `public.transfer_credits_between_shops`
-- (own wallets only, flat fee). `public.wallet_shop_recipients` is the
-- read-only mirror used by the UI and must never be wider than the transfer.
--
-- Run manually against a scratch database.

begin;

-- 1. Shop operators, resellers and subresellers may all send to a CUSTOMER of
--    the same shop; nobody may send outside the named shop.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def is null then raise exception 'transfer_credits_in_shop is missing'; end if;

  -- operators: anyone in their shop (customers included)
  if _def not like '%is_super_admin(_subject) or public.is_ecosystem_admin(_subject, _ecosystem_id)%' then
    raise exception 'shop operators must be allowed to load their shop members';
  end if;
  -- reseller -> customers of the shop
  if _def not like '%_my_role = ''reseller''%' or _def not like '%_their_role = ''customer''%' then
    raise exception 'a reseller must be able to send to customers of the shop';
  end if;
  -- subreseller -> customers of the shop (plus the existing upward path)
  if _def not like '%_my_role = ''subreseller''%' then
    raise exception 'a subreseller must have its own branch';
  end if;
  -- customer -> peer customer of the SAME shop only, never an admin
  if _def not like '%_allowed := (_their_role = ''customer'')%' then
    raise exception 'a customer must be able to send to a peer customer';
  end if;

  -- Unrelated shop rejection: both parties must be active members of the shop.
  if _def not like '%You are not an approved member of that shop%'
     or _def not like '%That member does not belong to this shop%' then
    raise exception 'members of unrelated shops must be rejected';
  end if;

  -- Self transfer, positive amount, funds, locking, atomicity.
  if _def not like '%You cannot send credits to yourself%' then
    raise exception 'self transfer must be rejected';
  end if;
  if _def not like '%Enter a positive amount%' then
    raise exception 'non-positive amounts must be rejected';
  end if;
  if _def not like '%Not enough credits in%' then
    raise exception 'insufficient balance must be rejected';
  end if;
  if _def not like '%for update%' then
    raise exception 'both wallets must be row-locked against races';
  end if;
  if _def not like '%new_tx_id()%' then
    raise exception 'both ledger legs must share one transaction reference';
  end if;
  if _def not like '%audit_logs%' then
    raise exception 'every transfer must be audited';
  end if;
end $$;

-- 2. Suspended / deleted / platform-owner recipients are refused.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def not like '%That account is suspended%' then
    raise exception 'suspended recipients must be refused';
  end if;
  if _def not like '%Recipient not found%' then
    raise exception 'deleted recipients must be refused';
  end if;
  if _def not like '%The platform owner does not hold a shop wallet%' then
    raise exception 'the platform owner must never be a shop-wallet recipient';
  end if;
end $$;

-- 3. The recipient list the UI reads is server-authorized and mirrors the
--    transfer rules exactly: same shop, active membership, active profile,
--    never the caller, never the platform owner.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'wallet_shop_recipients';
  if _def is null then raise exception 'wallet_shop_recipients is missing'; end if;
  if _def not like '%effective_uid()%' then
    raise exception 'the caller must be derived server side';
  end if;
  if _def not like '%m.ecosystem_id = _ecosystem_id%' then
    raise exception 'recipients must be scoped to the named shop';
  end if;
  if _def not like '%p.id <> _subject%' then
    raise exception 'the caller must never appear in their own recipient list';
  end if;
  if _def not like '%not public.is_super_admin(p.id)%' then
    raise exception 'the platform owner must never be listed';
  end if;
  if _def not like '%m.membership_state = ''active''%' or _def not like '%p.status = ''active''%' then
    raise exception 'only active members of the shop may be listed';
  end if;
  -- customer branch: peers only, never an admin
  if _def not like '%(m.role = ''customer'') and not public.is_ecosystem_admin(p.id, _ecosystem_id)%' then
    raise exception 'a customer must only ever see peer customers of the same shop';
  end if;
end $$;

-- 4. Only `authenticated` may read the recipient list, and it is read-only.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'wallet_shop_recipients'
       and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'anonymous callers must not read shop recipients';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'wallet_shop_recipients'
       and p.provolatile = 's'
  ) then
    raise exception 'the recipient list must be a read-only (stable) function';
  end if;
end $$;

-- 5. A customer moving credits to their OWN wallet in another shop uses the
--    existing cross-shop routine: own wallets only, flat fee, atomic.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_between_shops';
  if _def is null then raise exception 'transfer_credits_between_shops is missing'; end if;
  if _def not like '%effective_uid()%' then
    raise exception 'the owner must be derived server side';
  end if;
  if _def not like '%for update%' then
    raise exception 'the source wallet must be locked';
  end if;
  if _def not like '%fee%' then
    raise exception 'the flat platform fee must still be charged';
  end if;
end $$;

-- 6. The ledger stays append-only, so no partial or edited transfer can exist.
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'credit_ledger' and not t.tgisinternal
  ) then
    raise exception 'credit_ledger must keep its immutability trigger';
  end if;
end $$;

rollback;
