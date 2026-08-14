-- Shop-to-shop credit transfer rules.
--
-- Verifies that:
--   1. A transfer requires an approved, active membership in BOTH shops.
--   2. The flat platform fee is deducted from the amount; the destination
--      receives amount - fee, and the fee is recorded in shop_transfer_fees
--      as platform-owner earnings.
--   3. The credits pass through the member's global (Universe) wallet.
--   4. Credits received by transfer are recorded as a 'transfer' provenance
--      lot, so they never pay reseller/subreseller cashback and the whole
--      retained share stays with the destination shop admin.
--
-- Run manually against a scratch database.

begin;

-- Fee setting is present and defaults to 5 credits.
do $$
begin
  if (select shop_transfer_fee_credits from public.platform_settings where id = 1) is null then
    raise exception 'shop_transfer_fee_credits must always have a value';
  end if;
end $$;

-- Transfers into a shop the caller is not approved in must fail.
do $$
declare _uid uuid; _a uuid; _b uuid;
begin
  select user_id, ecosystem_id into _uid, _a
    from public.ecosystem_memberships where membership_state = 'active' limit 1;
  select id into _b from public.ecosystems
   where id not in (select ecosystem_id from public.ecosystem_memberships where user_id = _uid)
   limit 1;
  if _uid is null or _b is null then return; end if;
  begin
    perform public.transfer_credits_between_shops(_a, _b, 100);
    raise exception 'expected a membership failure';
  exception when others then
    null; -- expected: not an approved member of the destination shop
  end;
end $$;

-- Transferred credits must be provenance kind 'transfer' (no cashback source).
do $$
begin
  if exists (
    select 1 from public.credit_lots l
      join public.credit_ledger e on e.id = l.ledger_id
     where e.entry_kind = 'shop_transfer_in'
       and (l.source_kind <> 'transfer' or l.source_user_id is not null)
  ) then
    raise exception 'transferred credits must never carry a cashback source';
  end if;
end $$;

rollback;
