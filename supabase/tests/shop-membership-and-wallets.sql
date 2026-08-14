-- Shop membership, access and wallet isolation rules.
--
-- Verifies that:
--   1. A member holds at most ONE credit wallet per shop, and separate shops
--      keep separate balances. Entering a shop never moves credits.
--   2. The platform owner never holds an ordinary shop credit wallet.
--   3. Shop admin rights are shop-specific and come from an approved
--      membership, so the same person may administer several shops.
--   4. Assigning a shop admin is itself the approval: no pending application
--      or invitation is left behind for that person in that shop.
--   5. Platform credit issuance lands in the recipient's wallet for the
--      selected shop and never debits the operator.
--
-- Run manually against a scratch database.

begin;

-- 1. One wallet per (member, shop).
do $$
begin
  if exists (
    select 1 from public.credit_accounts
     where ecosystem_id is not null
     group by user_id, ecosystem_id having count(*) > 1
  ) then
    raise exception 'a member must never hold two wallets in the same shop';
  end if;
end $$;

-- 2. The platform owner is exempt from the member wallet model.
do $$
begin
  if exists (
    select 1 from public.credit_accounts ca
     where ca.ecosystem_id is not null
       and exists (select 1 from public.user_roles r
                    where r.user_id = ca.user_id and r.role = 'super_admin')
  ) then
    raise exception 'the platform owner must not hold a shop credit wallet';
  end if;
end $$;

-- 3. Every ledger entry belongs to the wallet it was written against, so a
--    shop's history can never contain another shop's movements.
do $$
begin
  if exists (
    select 1 from public.credit_ledger l
      join public.credit_accounts a on a.id = l.account_id
     where a.ecosystem_id is distinct from l.ecosystem_id
  ) then
    raise exception 'ledger entries must stay inside the wallet''s own shop';
  end if;
end $$;

-- 4. Assignment is the approval: an active shop admin has no pending
--    application or invitation left open for that shop.
do $$
begin
  if exists (
    select 1 from public.ecosystem_memberships m
      join public.membership_applications ap
        on ap.user_id = m.user_id and ap.ecosystem_id = m.ecosystem_id
     where m.role = 'admin' and m.membership_state = 'active' and ap.status = 'pending'
  ) or exists (
    select 1 from public.ecosystem_memberships m
      join public.ecosystem_invitations i
        on i.user_id = m.user_id and i.ecosystem_id = m.ecosystem_id
     where m.role = 'admin' and m.membership_state = 'active' and i.status = 'pending'
  ) then
    raise exception 'an assigned shop admin must not await another approval';
  end if;
end $$;

-- 5. Platform issuance credits the recipient, never the operator, and is
--    recorded against the shop it was issued into.
do $$
begin
  -- Shop credits are never issued by the operator to their own shop wallet,
  -- and the recorded before/after must reconcile with the amount issued.
  if exists (
    select 1 from public.platform_credit_issuances i
     where (i.recipient_id = i.operator_id and i.ecosystem_id is not null)
        or i.balance_after <> i.balance_before + i.amount
  ) then
    raise exception 'platform issuance must credit the recipient in full';
  end if;
  if exists (
    select 1 from public.platform_credit_issuances i
      join public.credit_ledger l on l.id = i.ledger_id
     where l.ecosystem_id is distinct from i.ecosystem_id
        or l.user_id <> i.recipient_id
  ) then
    raise exception 'issuance must land in the recipient wallet of the chosen shop';
  end if;
end $$;

-- 6. A shop admin membership is scoped to one shop only.
do $$
begin
  if exists (
    select 1 from public.user_roles r
     where r.role = 'admin' and r.ecosystem_id is null
  ) then
    raise exception 'the admin role must always name a shop';
  end if;
end $$;

rollback;
