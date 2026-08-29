CREATE OR REPLACE FUNCTION public.guard_profile_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.id <> old.id then
    raise exception 'A profile id cannot be reassigned';
  end if;

  -- The shop a profile points at may only ever be a shop THAT PROFILE is an
  -- approved member of (or none at all). Validate the profile owner, never the
  -- caller: authorized shop actions (e.g. removing a kept member) legitimately
  -- repoint someone else's profile and must not be judged as a shop switch by
  -- the admin performing them.
  if new.ecosystem_id is distinct from old.ecosystem_id
     and not public.is_super_admin(auth.uid())
     and new.ecosystem_id is not null
     and not exists (
       select 1 from public.ecosystem_memberships m
        where m.user_id = new.id
          and m.ecosystem_id = new.ecosystem_id
          and m.membership_state = 'active'
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
$function$;