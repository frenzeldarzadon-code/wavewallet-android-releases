-- 1. Nearest-match recipient search. Authorization rules are unchanged:
--    the same ecosystem / active / can_load_credits filters still decide who is
--    visible. Only the matching (and phone masking) changes.
CREATE OR REPLACE FUNCTION public.lookup_transfer_recipient(_query text)
 RETURNS TABLE(id uuid, full_name text, handle text, avatar_path text, phone text, masked_email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _eco uuid;
  _q text := lower(trim(coalesce(_query,'')));
  _h text := public.normalize_handle(_query);
  _digits text := regexp_replace(coalesce(_query,''), '[^0-9]', '', 'g');
  _seller boolean;
  _privileged boolean;
begin
  if length(_q) < 2 then return; end if;
  select p0.ecosystem_id into _eco from public.profiles p0 where p0.id = auth.uid();
  if _eco is null then return; end if;
  _seller := public.has_role(auth.uid(),'reseller') or public.has_role(auth.uid(),'subreseller');
  _privileged := _seller or public.is_super_admin(auth.uid())
                 or public.is_ecosystem_admin(auth.uid(), _eco);

  return query
    select p.id, p.full_name, p.handle, p.avatar_path,
           case when _privileged then p.phone
                else regexp_replace(p.phone, '.(?=.{3})', '*', 'g') end,
           regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2')
    from public.profiles p
    where p.ecosystem_id = _eco and p.id <> auth.uid() and p.status = 'active'
      and p.deleted_at is null
      and (
        lower(p.full_name) like '%' || _q || '%'
        or lower(p.email) like '%' || _q || '%'
        or (_h is not null and lower(coalesce(p.handle,'')) like '%' || _h || '%')
        or (_digits <> '' and regexp_replace(p.phone, '[^0-9]', '', 'g') like '%' || _digits || '%')
      )
      and (
        public.is_super_admin(auth.uid())
        or public.is_ecosystem_admin(auth.uid(), _eco)
        or (_seller and public.can_load_credits(auth.uid(), p.id))
        or (not _seller
            and not public.has_role(p.id,'reseller')
            and not public.has_role(p.id,'subreseller'))
      )
    order by
      case when lower(p.email) = _q
                or lower(coalesce(p.handle,'')) = coalesce(_h,'')
                or lower(p.full_name) = _q then 0
           when lower(p.full_name) like _q || '%' then 1
           else 2 end,
      p.full_name
    limit 10;
end;
$function$;

-- 2. Platform-owner directory of every member across every shop.
CREATE OR REPLACE FUNCTION public.super_list_members(
  _query text DEFAULT NULL,
  _ecosystem_id uuid DEFAULT NULL,
  _role text DEFAULT NULL,
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
 RETURNS TABLE(
   id uuid, full_name text, handle text, avatar_path text, email text, phone text,
   status text, role text, ecosystem_id uuid, ecosystem_name text,
   credit_balance numeric, points_balance integer, joined_at timestamptz
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _q text := lower(btrim(coalesce(_query, '')));
  _h text := public.normalize_handle(_query);
  _digits text := regexp_replace(coalesce(_query,''), '[^0-9]', '', 'g');
  _lim integer := least(greatest(coalesce(_limit, 100), 1), 500);
begin
  if not public.is_super_admin(auth.uid()) then return; end if;

  return query
    select
      p.id, p.full_name, p.handle, p.avatar_path, p.email, p.phone,
      p.status::text,
      coalesce((
        select ur.role::text from public.user_roles ur
        where ur.user_id = p.id
        order by case ur.role
          when 'super_admin' then 1 when 'admin' then 2
          when 'reseller' then 3 when 'subreseller' then 4 else 5 end
        limit 1
      ), 'customer') as role,
      p.ecosystem_id, e.name,
      coalesce(ca.balance, 0)::numeric,
      coalesce(pa.balance, 0)::integer,
      p.joined_at
    from public.profiles p
    left join public.ecosystems e on e.id = p.ecosystem_id
    left join public.credit_accounts ca on ca.user_id = p.id
    left join public.points_accounts pa on pa.user_id = p.id
    where p.deleted_at is null
      and (_ecosystem_id is null or p.ecosystem_id = _ecosystem_id)
      and (
        _q = '' or lower(p.full_name) like '%' || _q || '%'
        or lower(p.email) like '%' || _q || '%'
        or (_h is not null and lower(coalesce(p.handle,'')) like '%' || _h || '%')
        or (_digits <> '' and regexp_replace(p.phone, '[^0-9]', '', 'g') like '%' || _digits || '%')
      )
      and (
        _role is null or _role = '' or _role = coalesce((
          select ur.role::text from public.user_roles ur
          where ur.user_id = p.id
          order by case ur.role
            when 'super_admin' then 1 when 'admin' then 2
            when 'reseller' then 3 when 'subreseller' then 4 else 5 end
          limit 1
        ), 'customer')
      )
    order by e.name nulls last, p.full_name
    limit _lim offset greatest(coalesce(_offset, 0), 0);
end;
$function$;

REVOKE ALL ON FUNCTION public.super_list_members(text, uuid, text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.super_list_members(text, uuid, text, integer, integer) TO authenticated;