CREATE OR REPLACE FUNCTION public.ensure_universe_membership(_user_id uuid, _ecosystem_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public, pg_temp'
AS $function$
begin
  if _user_id is null or _ecosystem_id is null then return; end if;
  if public.shop_requires_membership_approval(_ecosystem_id) then
    raise exception 'This shop requires membership approval';
  end if;
  if public.is_super_admin(_user_id) then return; end if;

  insert into public.ecosystem_memberships
    (user_id, ecosystem_id, role, status, membership_state)
  values (_user_id, _ecosystem_id, 'customer', 'active'::public.account_status, 'active')
  on conflict (user_id, ecosystem_id) do update
    set role = case
                 when public.ecosystem_memberships.role in ('admin','reseller','subreseller')
                   then public.ecosystem_memberships.role
                 else 'customer'
               end,
        membership_state = 'active',
        status = case when public.ecosystem_memberships.status = 'suspended'::public.account_status
                      then 'suspended'::public.account_status
                      else 'active'::public.account_status end,
        updated_at = now();

  perform public.ensure_membership_wallets(_user_id, _ecosystem_id);
end;
$function$;

REVOKE ALL ON FUNCTION public.ensure_universe_membership(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ensure_universe_membership(uuid, uuid) TO authenticated, service_role;