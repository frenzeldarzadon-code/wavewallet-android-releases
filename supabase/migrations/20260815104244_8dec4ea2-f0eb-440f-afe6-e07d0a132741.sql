-- Unset member discounts follow the SHOP's configured default (per shop),
-- never a platform-wide or hard-coded value.
CREATE OR REPLACE FUNCTION public.member_cashback_rate(_user_id uuid, _ecosystem_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _pct integer; _role public.app_role; _status public.account_status;
begin
  if _user_id is null or _ecosystem_id is null then return 0; end if;
  if public.is_super_admin(_user_id) then return 0; end if;

  select m.role, m.sale_commission_percent, m.status
    into _role, _pct, _status
    from public.ecosystem_memberships m
   where m.user_id = _user_id and m.ecosystem_id = _ecosystem_id;

  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _user_id and ur.ecosystem_id = _ecosystem_id
     order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end
     limit 1;
    select p.sale_commission_percent, p.status into _pct, _status
      from public.profiles p where p.id = _user_id;
  end if;

  if _role is null or _role not in ('reseller','subreseller') then return 0; end if;
  if coalesce(_status, 'active') <> 'active' then return 0; end if;

  if _pct is null then
    select case _role when 'subreseller' then e.default_subreseller_discount_percent
                      else e.default_reseller_discount_percent end
      into _pct from public.ecosystems e where e.id = _ecosystem_id;
  end if;
  return least(greatest(coalesce(_pct, 0), 0), 100);
end $function$;