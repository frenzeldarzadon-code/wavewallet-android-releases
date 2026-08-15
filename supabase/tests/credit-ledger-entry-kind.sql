-- Every credit_ledger write carries a valid, non-null entry_kind.
--
-- Regression: `transfer_credits_in_shop` computed the entry kind as
-- `case when _lineage_reset then 'customer_upline_transfer' else null end`.
-- An explicit NULL bypasses the column DEFAULT, so every ordinary
-- member -> member transfer (subreseller/reseller/admin -> customer) failed
-- with "null value in column entry_kind violates not-null constraint".
--
-- The rules verified here:
--   1. Ordinary in-shop transfers record the established 'general' kind, so
--      credit lots keep normal cashback provenance.
--   2. Customer -> upline transfers keep 'customer_upline_transfer', which is
--      what track_credit_lots uses to reset the cashback lineage.
--   3. Cross-shop transfers keep their shop_transfer_in/out kinds and the
--      flat platform fee, and remain a transfer (never a purchase).
--   4. No ledger writer may emit a NULL entry kind: the BEFORE INSERT trigger
--      falls back to 'general' rather than failing a financial write.
--   5. Every wallet balance reconciles with its latest ledger entry.
--
-- Run manually against a scratch database.

begin;

-- 1 + 2. In-shop transfer kinds.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def like '%else null end%' then
    raise exception 'in-shop transfers must never write a NULL entry_kind';
  end if;
  if _def not like '%else ''general'' end%' then
    raise exception 'ordinary in-shop transfers must use the general entry kind';
  end if;
  if _def not like '%customer_upline_transfer%' then
    raise exception 'customer -> upline transfers must stay tagged for lineage reset';
  end if;
  -- A transfer is not a purchase: no commission is ever computed.
  if _def like '%commission_rate_for%' or _def like '%sale_commission%' then
    raise exception 'an in-shop transfer must not create cashback or sales earnings';
  end if;
end $$;

-- 3. Cross-shop transfer keeps its own kinds and the configured flat fee.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_between_shops';
  if _def not like '%shop_transfer_out%' or _def not like '%shop_transfer_in%' then
    raise exception 'cross-shop transfers must record shop_transfer_in/out entry kinds';
  end if;
  if _def not like '%shop_transfer_fee_credits%' then
    raise exception 'the cross-shop fee must come from the configured platform setting';
  end if;
  if _def not like '%shop_transfer_fees%' then
    raise exception 'the fee must be recorded as platform transfer-fee earnings';
  end if;
end $$;

-- 4. The ledger trigger never lets a NULL entry kind reach the constraint.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_credit_entry';
  if _def not like '%new.entry_kind is null%' then
    raise exception 'apply_credit_entry must default a NULL entry_kind to general';
  end if;
end $$;

-- 4b. Nothing in the ledger is missing a kind, and the column stays NOT NULL.
do $$
begin
  if exists (select 1 from public.credit_ledger where entry_kind is null) then
    raise exception 'credit_ledger contains entries without an entry kind';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'credit_ledger'
       and column_name = 'entry_kind' and is_nullable = 'YES'
  ) then
    raise exception 'entry_kind must stay NOT NULL — never relax the constraint';
  end if;
end $$;

-- 5. Wallet balances reconcile with the ledger.
do $$
declare _bad int;
begin
  select count(*) into _bad from (
    select a.balance,
           (select l.balance_after from public.credit_ledger l
             where l.account_id = a.id order by l.created_at desc, l.id desc limit 1) as last
      from public.credit_accounts a
  ) t where t.last is not null and t.last <> t.balance;
  if _bad > 0 then
    raise exception 'wallet balances do not reconcile with the ledger: %', _bad;
  end if;
end $$;

rollback;
