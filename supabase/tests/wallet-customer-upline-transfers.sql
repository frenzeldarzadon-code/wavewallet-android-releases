-- Customer -> upline transfers and the cashback lineage reset rule.
--
-- Business rule under test:
--   A) a customer may send credits to an active SUBRESELLER of the same shop
--   B) ... to an active RESELLER of the same shop
--   C) ... to an active ADMIN of the same shop
--   D) never to anyone outside that shop, and never to themselves
--   E) the arriving credits LOSE the customer's cashback lineage
--   F) when that upline moves the credits on, a normal new lineage starts
--   G) every other wallet transaction keeps the existing lineage rules
--   H) nothing else about transfers or cashback changed
--
-- Run manually against a scratch database.

begin;

-- A/B/C. The customer branch of transfer_credits_in_shop admits every active
-- upline role of the SAME shop, plus peer customers.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def is null then raise exception 'transfer_credits_in_shop is missing'; end if;
  if _def not like '%_their_role in (''customer'',''subreseller'',''reseller'')%' then
    raise exception 'a customer must be able to send to peers and to any upline of the shop';
  end if;
  if _def not like '%_their_admin%' then
    raise exception 'a customer must be able to send to an admin of the shop';
  end if;
  -- The admin check is always scoped to the SAME shop.
  if _def not like '%is_ecosystem_admin(_recipient_id, _ecosystem_id)%' then
    raise exception 'the admin recipient check must be scoped to the selected shop';
  end if;
end $$;

-- D. Shop isolation and self-transfer are still refused for everyone.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def not like '%You cannot send credits to yourself%' then
    raise exception 'self-transfer must stay blocked';
  end if;
  if _def not like '%That member does not belong to this shop%' then
    raise exception 'recipients outside the selected shop must stay blocked';
  end if;
  if _def not like '%You are not an approved member of that shop%' then
    raise exception 'the sender must be an active member of the selected shop';
  end if;
  if _def not like '%Not enough credits in%' then
    raise exception 'insufficient balance must stay blocked';
  end if;
  if _def not like '%for update%' then
    raise exception 'the wallets must stay row-locked against races';
  end if;
end $$;

-- The same isolation applies to the recipient list the UI reads.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'wallet_shop_recipients';
  if _def not like '%m.ecosystem_id = _ecosystem_id%' then
    raise exception 'recipients must be scoped to one shop';
  end if;
  if _def not like '%m.role in (''customer'',''subreseller'',''reseller'')%' then
    raise exception 'a customer must see peers and uplines of this shop';
  end if;
  if _def not like '%p.id <> _subject%' then
    raise exception 'the caller must never appear in their own recipient list';
  end if;
  if _def not like '%not public.is_super_admin(p.id)%' then
    raise exception 'the platform owner must never appear as a recipient';
  end if;
end $$;

-- E. A customer -> upline transfer is written with its own entry kind and an
--    explicit, human-readable reason on BOTH legs.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def not like '%customer_upline_transfer%' then
    raise exception 'customer -> upline transfers must carry their own ledger entry kind';
  end if;
  if _def not like '%cashback lineage reset%' then
    raise exception 'the ledger reason must state that the lineage was reset';
  end if;
  if _def not like '%cashback_lineage_reset%' then
    raise exception 'the audit record must flag the lineage reset';
  end if;
end $$;

-- E (cont). The lot tracker gives those arriving credits NO source lineage.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'track_credit_lots';
  if _def not like '%customer_upline_transfer%' then
    raise exception 'the credit lot tracker must recognise customer -> upline transfers';
  end if;
end $$;

-- Every lot created from a customer -> upline transfer is untraced.
do $$
begin
  if exists (
    select 1 from public.credit_lots l
      join public.credit_ledger e on e.id = l.ledger_id
     where e.entry_kind = 'customer_upline_transfer'
       and (l.source_user_id is not null or l.source_kind <> 'system')
  ) then
    raise exception 'credits received from a customer must carry no cashback lineage';
  end if;
end $$;

-- F. Once the upline holds them, the credits are ordinary wallet credits: any
--    later transfer creates a brand new lot for the next holder, attributed to
--    the upline under the normal rules (never to the original customer).
do $$
begin
  if exists (
    select 1
      from public.credit_lot_consumptions c
      join public.credit_lots l on l.id = c.lot_id
      join public.credit_ledger src on src.id = l.ledger_id
      join public.credit_ledger spend on spend.id = c.ledger_id
     where src.entry_kind = 'customer_upline_transfer'
       and spend.direction = 'debit'
       and exists (
         select 1 from public.credit_lots nl
          where nl.ledger_id in (select id from public.credit_ledger
                                  where tx_id = spend.tx_id || '-R')
            and nl.source_user_id = src.user_id
       )
  ) then
    raise exception 'a later upline transfer must not re-attribute credits to the original customer';
  end if;
end $$;

-- G/H. Normal transfers are untouched: they keep their original reasons, no
--      entry kind, and their usual lineage attribution.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def not like '%Credit transfer sent%' or _def not like '%Credit transfer received%' then
    raise exception 'ordinary transfers must keep their existing ledger wording';
  end if;
  -- Face value only, no commission is ever added by this path.
  if _def not like '%_amount, 0, 0%' then
    raise exception 'shop-scoped transfers must move face value with no commission';
  end if;
  -- Operator/reseller/subreseller branches are unchanged.
  if _def not like '%_their_role = ''subreseller'' and _r_parent = _subject%' then
    raise exception 'a reseller must still be able to load their own subresellers';
  end if;
  if _def not like '%_their_role = ''reseller'' and _my_parent = _recipient_id%' then
    raise exception 'a subreseller must still send upward only to their own reseller';
  end if;
end $$;

-- Only the customer -> upline path ever resets lineage.
do $$
begin
  if exists (
    select 1 from public.credit_ledger
     where entry_kind = 'customer_upline_transfer'
       and reason not like '%cashback lineage reset%'
  ) then
    raise exception 'the lineage-reset entry kind must always be labelled';
  end if;
  if exists (
    select 1 from public.credit_ledger
     where reason like '%cashback lineage reset%'
       and entry_kind is distinct from 'customer_upline_transfer'
  ) then
    raise exception 'no other transaction may claim a lineage reset';
  end if;
end $$;

-- Atomicity: both legs of every lineage-reset transfer share one reference.
do $$
begin
  if exists (
    select 1 from public.credit_ledger l
     where l.entry_kind = 'customer_upline_transfer' and l.direction = 'debit'
       and not exists (
         select 1 from public.credit_ledger r
          where r.tx_id = l.tx_id || '-R'
            and r.direction = 'credit'
            and r.amount = l.amount
            and r.ecosystem_id is not distinct from l.ecosystem_id
       )
  ) then
    raise exception 'a customer -> upline transfer must always have its matching received leg';
  end if;
  if exists (select 1 from public.credit_accounts where balance < 0) then
    raise exception 'credit wallets must never go negative';
  end if;
end $$;

-- Neither function may be reached without signing in.
do $$
begin
  if has_function_privilege('anon', 'public.transfer_credits_in_shop(uuid,uuid,numeric,text)', 'execute')
     or has_function_privilege('anon', 'public.wallet_shop_recipients(uuid,text,integer)', 'execute') then
    raise exception 'wallet functions must not be callable without signing in';
  end if;
end $$;

-- I. A customer is attached to NO permanent upline: their eligibility branch
--    must be decided by the recipient's role in the SAME shop only, never by
--    profiles.reseller_id / a stored parent association.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transfer_credits_in_shop';
  if _def not like '%_allowed := (_their_role in (''customer'',''subreseller'',''reseller'')) or _their_admin;%' then
    raise exception 'a customer must not be gated by a stored upline association';
  end if;
  if _def not like '%_lineage_reset := _their_admin or (_their_role in (''subreseller'',''reseller''))%' then
    raise exception 'customer -> upline transfers must flag the cashback lineage reset';
  end if;

  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'wallet_shop_recipients';
  if _def not like '%(m.role in (''customer'',''subreseller'',''reseller''))%' then
    raise exception 'the customer recipient list must offer every eligible member of the shop';
  end if;
end $$;

-- J. The lineage reset is realised in the ledger: a customer_upline_transfer
--    credit opens a lot with NO source account, so nothing is traced back to
--    the customer, while ordinary transfers keep normal provenance.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'track_credit_lots';
  if _def not like '%new.entry_kind = ''customer_upline_transfer'' then%'
     or _def not like '%_kind := ''system''; _src := null;%' then
    raise exception 'customer -> upline credits must arrive with no cashback lineage';
  end if;
  if _def not like '%_srole = ''reseller'' then _kind := ''reseller''%' then
    raise exception 'upline -> downline transfers must keep normal cashback provenance';
  end if;
end $$;

rollback;
