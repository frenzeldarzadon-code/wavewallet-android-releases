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

  -- Changing which shop a profile is currently in is allowed when:
  --   * the platform owner does it (they manage every shop), or
  --   * the person themselves moves into a shop they are an approved member of
  --     (this is the active-shop switch; it moves no wallets or history).
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

  if auth.uid() = new.id and not public.is_super_admin(auth.uid()) then
    new.reseller_discount_percent := old.reseller_discount_percent;
    new.reseller_commission_percent := old.reseller_commission_percent;
    new.reseller_id := old.reseller_id;
    new.status := old.status;
  end if;

  return new;
end;
$function$;