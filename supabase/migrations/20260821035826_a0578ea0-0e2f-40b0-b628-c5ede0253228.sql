-- 1. Profiles is only a compatibility mirror of the ACTIVE shop membership.
--    It must never enforce or contaminate per-shop parent relationships.
create or replace function public.validate_member_parent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _m public.ecosystem_memberships%rowtype;
begin
  -- Self-parenting is always wrong, in any shop.
  if new.reseller_id is not null and new.reseller_id = new.id then
    raise exception 'A member cannot be their own parent reseller';
  end if;

  if new.ecosystem_id is null then
    new.reseller_id := null;
    return new;
  end if;

  -- Derive the mirror from the membership of the shop this profile points at.
  select * into _m
    from public.ecosystem_memberships m
   where m.user_id = new.id and m.ecosystem_id = new.ecosystem_id;

  if _m.id is not null then
    new.reseller_id := _m.reseller_id;
    if tg_op = 'INSERT' or new.ecosystem_id is distinct from old.ecosystem_id then
      new.reseller_discount_percent   := coalesce(_m.reseller_discount_percent, 0);
      new.reseller_commission_percent := _m.reseller_commission_percent;
      new.sale_commission_percent     := _m.sale_commission_percent;
    end if;
  elsif new.reseller_id is not null and not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = new.reseller_id
       and m.ecosystem_id = new.ecosystem_id
       and m.membership_state = 'active'
  ) then
    -- A parent inherited from another shop is meaningless here: drop it
    -- rather than blocking a perfectly valid membership elsewhere.
    new.reseller_id := null;
  end if;

  if new.reseller_id is not null and exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = new.reseller_id
       and m.ecosystem_id = new.ecosystem_id
       and m.reseller_id = new.id
  ) then
    raise exception 'Circular reseller ownership is not allowed';
  end if;

  return new;
end $$;

comment on function public.validate_member_parent() is
  'Profiles mirror guard: derives reseller_id/discounts from the membership of the profiles active shop. Authoritative per-shop parent validation lives in validate_membership_parent().';

-- 2. Membership data flows membership -> profile mirror, never the reverse.
create or replace function public.sync_membership_from_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.ecosystem_id is null then return new; end if;

  insert into public.ecosystem_memberships (
    user_id, ecosystem_id, role, status, membership_state,
    reseller_id, reseller_discount_percent, reseller_commission_percent,
    sale_commission_percent, handle, joined_at
  ) values (
    new.id, new.ecosystem_id,
    coalesce((select r.role from public.user_roles r
               where r.user_id = new.id and r.ecosystem_id = new.ecosystem_id limit 1), 'customer'),
    new.status,
    case when new.deleted_at is not null then 'removed' else 'active' end,
    null, 0, null, null, new.handle, new.joined_at
  )
  on conflict (user_id, ecosystem_id) do update set
    -- Only genuinely global attributes are mirrored back. Role, parent
    -- reseller, discount and commission stay owned by the membership row.
    handle = excluded.handle,
    status = excluded.status,
    membership_state = case
      when new.deleted_at is not null then 'removed'
      else public.ecosystem_memberships.membership_state
    end,
    updated_at = now();

  return new;
end $$;

comment on function public.sync_membership_from_profile() is
  'Creates a shop membership when a profile first points at a shop and mirrors only global fields (handle, status, deletion). Never copies role, parent reseller, discount or commission from the profile.';
