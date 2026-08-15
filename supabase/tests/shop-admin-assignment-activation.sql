-- Shop admin assignment activates free shops.
--
-- The rule: assigning a shop admin IS the approval for a free plan
-- (plan_price = 0), so the shop must become active immediately. Paid shops
-- must NOT be activated by an assignment — they keep following the
-- subscription approval/payment workflow. Period dates and payment history
-- are never touched (current_period_end may stay NULL on the free plan).
--
-- Run manually against a scratch database.

begin;

-- 1. The function activates free plans and records the transition.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'assign_shop_admin';
  if _def not like '%plan_price%' then
    raise exception 'assign_shop_admin must consider the plan price before activating';
  end if;
  if _def not like '%subscription_state = case when _activated%' then
    raise exception 'assign_shop_admin must only activate when the plan is free and pending';
  end if;
  if _def not like '%activated_on_assignment%' then
    raise exception 'the status transition must be part of the assignment audit metadata';
  end if;
  if _def like '%current_period_end%' then
    raise exception 'assign_shop_admin must not rewrite subscription period dates';
  end if;
end $$;

-- 2. No free shop with an assigned active admin is left pending.
do $$
declare _stuck int;
begin
  select count(*) into _stuck
    from public.ecosystems e
   where coalesce(e.plan_price, 0) <= 0
     and e.subscription_state in ('pending', 'awaiting_approval')
     and e.admin_assigned_at is not null
     and exists (select 1 from public.ecosystem_memberships m
                  where m.ecosystem_id = e.id and m.role = 'admin'
                    and m.membership_state = 'active');
  if _stuck > 0 then
    raise exception 'free shops with an assigned admin are still pending: %', _stuck;
  end if;
end $$;

-- 3. Paid shops are never activated merely by having an admin.
do $$
declare _def text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'assign_shop_admin';
  if _def not like '%coalesce(_price, 0) <= 0%' then
    raise exception 'paid shops must keep the subscription approval workflow';
  end if;
end $$;

rollback;
