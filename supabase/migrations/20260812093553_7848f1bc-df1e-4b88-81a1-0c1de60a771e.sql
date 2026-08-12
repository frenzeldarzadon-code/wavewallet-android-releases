CREATE OR REPLACE FUNCTION public.lookup_redemption(_code text)
 RETURNS TABLE(id uuid, code text, reward_name text, points_price integer, status text, user_name text, created_at timestamp with time zone, ecosystem_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eco uuid;
begin
  select p.ecosystem_id into _eco from public.profiles p where p.id = auth.uid();
  if not (public.is_super_admin(auth.uid())
          or (_eco is not null and (public.is_ecosystem_admin(auth.uid(), _eco)
                                    or public.has_role(auth.uid(), 'reseller')))) then
    raise exception 'Not authorized to verify redemptions';
  end if;
  return query
    select r.id, r.code, r.reward_name, r.points_price, r.status, r.user_name, r.created_at, e.name
    from public.reward_redemptions r
    join public.ecosystems e on e.id = r.ecosystem_id
    where upper(r.code) = upper(trim(_code))
      and (public.is_super_admin(auth.uid()) or r.ecosystem_id = _eco);
end; $function$;

CREATE OR REPLACE FUNCTION public.lookup_transfer_recipient(_query text)
 RETURNS TABLE(id uuid, full_name text, phone text, masked_email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eco uuid; _q text := lower(trim(coalesce(_query,'')));
begin
  if length(_q) < 4 then return; end if;
  select p0.ecosystem_id into _eco from public.profiles p0 where p0.id = auth.uid();
  if _eco is null then return; end if;
  return query
    select p.id, p.full_name, p.phone,
           regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2')
    from public.profiles p
    where p.ecosystem_id = _eco and p.id <> auth.uid() and p.status = 'active'
      and (lower(p.email) = _q or replace(p.phone,' ','') = replace(_q,' ',''))
    limit 5;
end; $function$;

REVOKE ALL ON FUNCTION public.lookup_redemption(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lookup_transfer_recipient(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_redemption(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_transfer_recipient(text) TO authenticated;