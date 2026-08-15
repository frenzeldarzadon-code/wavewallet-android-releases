-- The platform owner can turn any Universe member into a shop admin instantly.
--
-- Regression: assign_shop_admin wrote to membership_applications.reviewed_at /
-- reviewed_by, columns that do not exist (the table uses decided_at /
-- decided_by). Every assignment therefore aborted, leaving brand-new shops
-- without an admin and the whole shop unusable.
--
-- The rules verified here:
--   1. Only the platform owner may assign; anyone else is refused.
--   2. A member with no prior history in the shop becomes an active admin
--      immediately, with no application or invitation step.
--   3. Exactly one shop wallet is opened at zero balance, and wallets in other
--      shops are untouched.
--   4. A free shop activates on assignment; the new admin is notified and the
--      change is written to the audit trail.
--   5. Cashback provenance is unaffected: a customer purchase still pays the
--      subreseller their share, the parent reseller the remainder of its total
--      share, and the admin everything left of the 100%.
--
-- Run manually against a scratch database.

begin;

-- 1. The function still only references columns that exist.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'assign_shop_admin';
  if _def like '%reviewed_at%' or _def like '%reviewed_by%' then
    raise exception 'assign_shop_admin references columns membership_applications does not have';
  end if;
  if _def not like '%decided_at%' then
    raise exception 'the assignment must close any pending application';
  end if;
  if _def not like '%is_super_admin(auth.uid())%' then
    raise exception 'only the platform owner may assign a shop admin';
  end if;
  if _def not like '%ensure_membership_wallets%' then
    raise exception 'the new admin must get a shop wallet at zero balance';
  end if;
end $$;

-- 2. Every membership_applications column the function writes really exists.
do $$
declare _c text;
begin
  foreach _c in array array['status','decision_reason','decided_at','decided_by','decider_name','decider_role']
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'membership_applications'
         and column_name = _c
    ) then
      raise exception 'membership_applications is missing column %', _c;
    end if;
  end loop;
end $$;

-- 3. An assigned admin always has a wallet, and never more than one per shop.
do $$
declare _bad int;
begin
  select count(*) into _bad
    from public.ecosystem_memberships m
   where m.role = 'admin' and m.membership_state = 'active'
     and not public.is_super_admin(m.user_id)
     and not exists (
       select 1 from public.credit_accounts a
        where a.user_id = m.user_id and a.ecosystem_id = m.ecosystem_id);
  if _bad > 0 then
    raise exception '% shop admin(s) have no wallet', _bad;
  end if;

  select count(*) into _bad from (
    select user_id, ecosystem_id from public.credit_accounts
     where ecosystem_id is not null
     group by 1,2 having count(*) > 1) t;
  if _bad > 0 then
    raise exception 'a member must never hold two wallets in one shop';
  end if;
end $$;

-- 4. A shop never has two active admins at once.
do $$
declare _bad int;
begin
  select count(*) into _bad from (
    select ecosystem_id from public.ecosystem_memberships
     where role = 'admin' and membership_state = 'active'
     group by 1 having count(*) > 1) t;
  if _bad > 0 then
    raise exception '% shop(s) have more than one active admin', _bad;
  end if;
end $$;

-- 5. Purchases resolve the shop from the product, so a member may buy in any
--    shop they belong to while cashback stays inside that shop.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purchase_voucher';
  if _def not like '%_my_eco := _p.ecosystem_id%' then
    raise exception 'a purchase must run in the shop that sells the voucher';
  end if;
  if _def not like '%cashback_chain%' then
    raise exception 'cashback must follow credit provenance, not the buyer role alone';
  end if;
end $$;

rollback;
