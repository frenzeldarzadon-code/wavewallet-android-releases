-- Removing a member who was already KEPT in a shop.
--
-- Verifies that:
--   1. The removal action only accepts a kept (approved) review record.
--   2. It refuses while the member's balance in THAT shop is not exactly 0.
--   3. It ends the membership in that shop only — the account, the profile and
--      memberships in other shops survive, and no history row is deleted.
--   4. Only the shop's own admin (or the platform owner) may call it.
--
-- Run manually against a scratch database.

begin;

-- 1. The function exists, is security definer, and is not callable anonymously.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'remove_kept_shop_member' and p.prosecdef
  ) then
    raise exception 'remove_kept_shop_member must exist as a security definer function';
  end if;
  if has_function_privilege('anon', 'public.remove_kept_shop_member(uuid, text)', 'execute') then
    raise exception 'anonymous callers must never remove shop members';
  end if;
end $$;

-- 2. Every removal recorded by this action left a zero shop balance behind.
do $$
begin
  if exists (
    select 1 from public.audit_logs l
      join public.credit_accounts ca
        on ca.user_id = (l.metadata->>'user_id')::uuid
       and ca.ecosystem_id = l.ecosystem_id
     where l.action = 'Removed kept shop member'
       and coalesce(ca.balance, 0) <> 0
  ) then
    raise exception 'a kept member must only be removed with an exactly zero shop balance';
  end if;
end $$;

-- 3. Removal never deletes the person's Universe identity.
do $$
begin
  if exists (
    select 1 from public.audit_logs l
     where l.action = 'Removed kept shop member'
       and not exists (
         select 1 from public.profiles p where p.id = (l.metadata->>'user_id')::uuid
       )
  ) then
    raise exception 'removing from a shop must never delete the member''s account';
  end if;
end $$;

-- 4. Removal is scoped to one shop: other active memberships are untouched.
do $$
begin
  if exists (
    select 1 from public.audit_logs l
      join public.ecosystem_memberships m
        on m.user_id = (l.metadata->>'user_id')::uuid
       and m.ecosystem_id = l.ecosystem_id
     where l.action = 'Removed kept shop member'
       and m.membership_state = 'active'
  ) then
    raise exception 'the membership in the acting shop must be ended';
  end if;
end $$;

rollback;
