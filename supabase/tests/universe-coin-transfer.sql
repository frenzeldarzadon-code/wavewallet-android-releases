-- Universe member-to-member coin transfer (global wallet -> global wallet).
--
-- Verifies the rules enforced by `public.transfer_universe_coins` and
-- `public.lookup_universe_recipient`:
--   1. No shop, upline or membership concept: only global wallets (ecosystem NULL).
--   2. Self-transfer, non-positive amounts and insufficient balance are refused.
--   3. Double sends are serialized per sender and a repeated client key returns
--      the original transfer instead of sending twice.
--   4. It is never a purchase: zero commission, no sale_id, 'general' kind.
--   5. Recipient search returns identity only and is never anonymous.
--
-- Run manually against a scratch database.

begin;

do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_universe_coins';
  if _def is null then raise exception 'transfer_universe_coins is missing'; end if;
  if _def not like '%effective_uid()%' then raise exception 'caller must be re-derived server side'; end if;
  if _def not like '%You cannot send coins to yourself%' then raise exception 'self-transfer must be blocked'; end if;
  if _def not like '%Enter a positive amount%' then raise exception 'non-positive amounts must be refused'; end if;
  if _def not like '%Not enough Universe coins%' then raise exception 'insufficient balance must be refused'; end if;
  if _def not like '%for update%' then raise exception 'the source wallet must be locked'; end if;
  if _def not like '%pg_advisory_xact_lock%' then raise exception 'sends must be serialized per sender'; end if;
  if _def not like '%client_key%' then raise exception 'duplicate submissions must be idempotent'; end if;
  if _def not like '%ensure_credit_account(_subject, null)%' or _def not like '%ensure_credit_account(_recipient_id, null)%' then
    raise exception 'only the global Universe wallets may be used — never a shop wallet';
  end if;
  if _def like '%ecosystem_memberships%' or _def like '%membership_role%' or _def like '%reseller_id%' then
    raise exception 'no shop membership or upline rule may gate a Universe transfer';
  end if;
  -- Never a purchase: zero commission and no sale reference.
  if _def not like '%''general'',_amount,0,0%' then
    raise exception 'transfers must be booked with zero commission';
  end if;
  if _def like '%sale_id%' or _def like '%sale_commission%' or _def like '%cashback%' then
    raise exception 'transfer path must not reference purchase or cashback machinery';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.transfer_universe_coins(uuid,numeric,text,text)', 'execute')
     or has_function_privilege('anon', 'public.lookup_universe_recipient(text,integer)', 'execute') then
    raise exception 'Universe transfer functions must not be callable without signing in';
  end if;
end $$;

-- Recipient search exposes identity only (no phone / email / balance columns).
do $$
declare _cols text;
begin
  select string_agg(a.attname, ',' order by a.attnum) into _cols
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join pg_attribute a on a.attrelid = p.prorettype::regclass::oid and false
   where n.nspname = 'public' and p.proname = 'lookup_universe_recipient';
  -- Composite return types are not relations; inspect the signature text instead.
  select pg_get_function_result(p.oid) into _cols
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lookup_universe_recipient';
  if _cols is null then raise exception 'lookup_universe_recipient is missing'; end if;
  if _cols like '%phone%' or _cols like '%email%' or _cols like '%balance%' then
    raise exception 'recipient search must never expose phone, email or balances';
  end if;
end $$;

-- Every global transfer pair shares one tx id and sits on global wallets only.
do $$
begin
  if exists (
    select 1 from public.credit_ledger l
     where l.reason like 'Credit transfer sent — Universe coins%'
       and (l.ecosystem_id is not null
            or not exists (
              select 1 from public.credit_ledger r
               where r.tx_id = l.tx_id || '-R'
                 and r.direction = 'credit'
                 and r.amount = l.amount
                 and r.ecosystem_id is null))
  ) then
    raise exception 'a Universe transfer must be a matched global-wallet pair';
  end if;
  if exists (
    select 1 from public.credit_ledger
     where reason like 'Credit transfer % — Universe coins%'
       and (sale_id is not null or coalesce(commission_amount,0) <> 0 or entry_kind <> 'general')
  ) then
    raise exception 'Universe transfers must never carry a sale or commission';
  end if;
  if exists (select 1 from public.credit_accounts where balance < 0) then
    raise exception 'wallets must never go negative';
  end if;
end $$;

rollback;
