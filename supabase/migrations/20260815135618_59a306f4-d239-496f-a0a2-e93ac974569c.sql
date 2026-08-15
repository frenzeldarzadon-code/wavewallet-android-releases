-- One row per real account in the Super Admin member directory, plus a
-- per-shop breakdown and an authorized username (@handle) change.

DROP FUNCTION IF EXISTS public.super_list_members(text, uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION public.super_list_members(_query text DEFAULT NULL::text, _ecosystem_id uuid DEFAULT NULL::uuid, _role text DEFAULT NULL::text, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, full_name text, handle text, avatar_path text, email text, phone text, status text, role text, ecosystem_id uuid, ecosystem_name text, credit_balance numeric, points_balance integer, joined_at timestamp with time zone, shop_count integer, shops text)
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
      p.ecosystem_id,
      e.name,
      -- Wallets are per (member, shop); the directory shows the person once
      -- with the total they hold across every shop they belong to.
      coalesce((select sum(ca.balance) from public.credit_accounts ca where ca.user_id = p.id), 0)::numeric,
      coalesce((select sum(pa.balance) from public.points_accounts pa where pa.user_id = p.id), 0)::integer,
      p.joined_at,
      (select count(distinct m.ecosystem_id)::integer from public.ecosystem_memberships m
        where m.user_id = p.id and coalesce(m.membership_state,'active') <> 'removed'),
      (select string_agg(distinct e2.name, ', ') from public.ecosystem_memberships m
         join public.ecosystems e2 on e2.id = m.ecosystem_id
        where m.user_id = p.id and coalesce(m.membership_state,'active') <> 'removed')
    from public.profiles p
    left join public.ecosystems e on e.id = p.ecosystem_id
    where p.deleted_at is null
      and (
        _ecosystem_id is null
        or p.ecosystem_id = _ecosystem_id
        or exists (select 1 from public.ecosystem_memberships m
                    where m.user_id = p.id and m.ecosystem_id = _ecosystem_id
                      and coalesce(m.membership_state,'active') <> 'removed')
      )
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

REVOKE EXECUTE ON FUNCTION public.super_list_members(text, uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_list_members(text, uuid, text, integer, integer) TO authenticated;

-- Per-shop breakdown behind a single member row.
CREATE OR REPLACE FUNCTION public.super_member_accounts(_user uuid)
 RETURNS TABLE(ecosystem_id uuid, ecosystem_name text, role text, membership_state text, credit_balance numeric, points_balance integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.ecosystem_id,
         e.name,
         m.role::text,
         coalesce(m.membership_state, 'active'),
         coalesce((select ca.balance from public.credit_accounts ca
                    where ca.user_id = _user and ca.ecosystem_id = m.ecosystem_id), 0)::numeric,
         coalesce((select pa.balance from public.points_accounts pa
                    where pa.user_id = _user and pa.ecosystem_id = m.ecosystem_id), 0)::integer
    from public.ecosystem_memberships m
    join public.ecosystems e on e.id = m.ecosystem_id
   where public.is_super_admin(auth.uid())
     and m.user_id = _user
     and coalesce(m.membership_state,'active') <> 'removed'
   order by e.name
$function$;

REVOKE EXECUTE ON FUNCTION public.super_member_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_member_accounts(uuid) TO authenticated;

-- Authorized username (@handle) change by an operator. Globally unique,
-- audit-logged, and never touching wallets, roles or memberships.
CREATE OR REPLACE FUNCTION public.admin_set_member_handle(_target uuid, _handle text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _h text := public.normalize_handle(_handle); _old text;
begin
  if not public.can_manage_member_profile(auth.uid(), _target) then
    raise exception 'You are not allowed to manage this account';
  end if;
  if _h is null or _h !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Usernames are 3-20 letters, numbers, dots or underscores';
  end if;
  select public.normalize_handle(p.handle) into _old
    from public.profiles p where p.id = _target and p.deleted_at is null;
  if not found then raise exception 'Member not found'; end if;
  if _old is distinct from _h and exists (
    select 1 from public.profiles p
     where p.deleted_at is null and p.id <> _target
       and public.normalize_handle(p.handle) = _h) then
    raise exception 'That username is already taken';
  end if;

  update public.profiles set handle = _h, updated_at = now() where id = _target;

  perform public.log_operator_action(
    _target,
    (select p.ecosystem_id from public.profiles p where p.id = _target),
    'Username changed', 'profile', _target,
    jsonb_build_object('from', coalesce(_old,''), 'to', _h));
  return _h;
end $function$;

REVOKE EXECUTE ON FUNCTION public.admin_set_member_handle(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_member_handle(uuid, text) TO authenticated;