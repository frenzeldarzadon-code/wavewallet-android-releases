-- 1. Trigger-only functions must never be callable from the API
revoke execute on function public.apply_credit_entry() from public, anon, authenticated;
revoke execute on function public.apply_points_entry() from public, anon, authenticated;
revoke execute on function public.apply_social_credit_entry() from public, anon, authenticated;
revoke execute on function public.assign_profile_handle() from public, anon, authenticated;
revoke execute on function public.block_ledger_mutation() from public, anon, authenticated;
revoke execute on function public.enforce_role_tenant() from public, anon, authenticated;
revoke execute on function public.ensure_wallets() from public, anon, authenticated;
revoke execute on function public.guard_cash_in_update() from public, anon, authenticated;
revoke execute on function public.guard_money_request_update() from public, anon, authenticated;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;
revoke execute on function public.guard_require_listener() from public, anon, authenticated;
revoke execute on function public.guard_withdrawal_update() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.membership_wallet_guard() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.sync_membership_from_profile() from public, anon, authenticated;
revoke execute on function public.sync_membership_from_role() from public, anon, authenticated;
revoke execute on function public.tg_notify_cashback() from public, anon, authenticated;
revoke execute on function public.tg_notify_comment() from public, anon, authenticated;
revoke execute on function public.tg_notify_dm() from public, anon, authenticated;
revoke execute on function public.tg_notify_like() from public, anon, authenticated;
revoke execute on function public.tg_notify_post_mentions() from public, anon, authenticated;
revoke execute on function public.tg_notify_social_gift() from public, anon, authenticated;
revoke execute on function public.tg_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.track_credit_lots() from public, anon, authenticated;
revoke execute on function public.validate_member_parent() from public, anon, authenticated;

-- 2. Signed-out visitors must not reach cash-in / shop management routines
revoke execute on function public.set_ecosystem_cash_in_number(uuid, text) from anon;
revoke execute on function public.request_cash_in(uuid, numeric, text, text, text, text, text) from anon;
revoke execute on function public.cash_in_receiving_number(uuid, uuid) from anon;
revoke execute on function public.cash_in_conflict_snapshot(uuid) from anon;
revoke execute on function public.record_cash_in_reference_conflict(uuid) from anon;
revoke execute on function public.cash_in_reference_conflict_list(text) from anon;
revoke execute on function public.resolve_cash_in_reference_conflict(uuid, text) from anon;
revoke execute on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb) from anon;
revoke execute on function public.ecosystem_has_admin(uuid) from anon;

-- 3. Lock privilege-relevant profile columns against self-service updates
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id <> old.id then
    raise exception 'A profile id cannot be reassigned';
  end if;

  if new.ecosystem_id is distinct from old.ecosystem_id
     and not public.is_super_admin(auth.uid())
     and not (
       auth.uid() = new.id
       and new.ecosystem_id is not null
       and exists (
         select 1 from public.ecosystem_memberships m
          where m.user_id = new.id
            and m.ecosystem_id = new.ecosystem_id
            and m.membership_state = 'active'
       )
     ) then
    raise exception 'You can only switch to a shop you are an approved member of';
  end if;

  if new.active_ecosystem_id is distinct from old.active_ecosystem_id
     and new.active_ecosystem_id is not null
     and not public.is_super_admin(auth.uid())
     and not exists (
       select 1 from public.ecosystem_memberships m
        where m.user_id = new.id
          and m.ecosystem_id = new.active_ecosystem_id
          and m.membership_state = 'active'
     ) then
    raise exception 'You can only switch to a shop you are an approved member of';
  end if;

  if auth.uid() = new.id and not public.is_super_admin(auth.uid()) then
    new.reseller_discount_percent := old.reseller_discount_percent;
    new.reseller_commission_percent := old.reseller_commission_percent;
    new.sale_commission_percent := old.sale_commission_percent;
    new.reseller_id := old.reseller_id;
    new.status := old.status;
    new.is_demo := old.is_demo;
    new.deleted_at := old.deleted_at;
    new.deleted_by := old.deleted_by;
    new.deleted_reason := old.deleted_reason;
    new.joined_at := old.joined_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_profile_update() from public, anon, authenticated;

-- 4. Avatar storage policies apply to signed-in users only
drop policy if exists "Members replace their own avatar" on storage.objects;
create policy "Members replace their own avatar"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[2] = (auth.uid())::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[2] = (auth.uid())::text);

drop policy if exists "Members or shop admins delete avatars" on storage.objects;
create policy "Members or shop admins delete avatars"
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (
    (storage.foldername(name))[2] = (auth.uid())::text
    or public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
);