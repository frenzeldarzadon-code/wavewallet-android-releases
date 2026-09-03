-- R3 correction: the Retail seller hierarchy stops at the RESELLER level.
-- Subresellers do not exist in Retail: they never earn Retail cashback and
-- cannot be chosen as a Retail storefront seller. Voucher Shop is untouched.

CREATE OR REPLACE FUNCTION public.retail_cashback_recipient(_buyer uuid, _seller uuid, _ecosystem_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _role public.app_role;
begin
  if _buyer is null or _ecosystem_id is null then return null; end if;
  -- A buying RESELLER earns their own configured Retail cashback.
  select m.role into _role from public.ecosystem_memberships m
   where m.user_id = _buyer and m.ecosystem_id = _ecosystem_id and m.membership_state = 'active';
  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _buyer and ur.ecosystem_id = _ecosystem_id
     order by case ur.role when 'reseller' then 0 else 1 end limit 1;
  end if;
  if _role = 'reseller' then return _buyer; end if;

  -- Otherwise the storefront seller, only when they are a RESELLER.
  -- Attribution stops here: no subreseller, no upline pass-through.
  if _seller is null or _seller = _buyer then return null; end if;
  _role := null;
  select m.role into _role from public.ecosystem_memberships m
   where m.user_id = _seller and m.ecosystem_id = _ecosystem_id and m.membership_state = 'active';
  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _seller and ur.ecosystem_id = _ecosystem_id
     order by case ur.role when 'reseller' then 0 else 1 end limit 1;
  end if;
  if _role = 'reseller' then return _seller; end if;
  return null;  -- admin/owner or anyone else: the admin keeps the whole seller amount
end $$;

-- Retail storefront seller must be the shop admin or an authorized RESELLER.
CREATE OR REPLACE FUNCTION public.retail_seller_allowed(_seller uuid, _ecosystem_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _seller and m.ecosystem_id = _ecosystem_id
       and m.membership_state = 'active' and m.role in ('admin','reseller'))
  or exists (
    select 1 from public.user_roles ur
     where ur.user_id = _seller and ur.ecosystem_id = _ecosystem_id and ur.role in ('admin','reseller'))
$$;
GRANT EXECUTE ON FUNCTION public.retail_seller_allowed(uuid, uuid) TO authenticated;

-- Enforce it inside retail_place_order without touching the rest of the body:
-- wrap the existing function via a thin pre-check (function body is re-declared
-- from pg_get_functiondef to stay byte-identical apart from the new guard).
DO $$
DECLARE _def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'retail_place_order';
  IF _def IS NULL THEN RAISE EXCEPTION 'retail_place_order missing'; END IF;
  IF position('retail_seller_allowed' in _def) = 0 THEN
    _def := replace(_def,
      '    _seller := _seller_id;',
      '    if not public.retail_seller_allowed(_seller_id, _ecosystem_id) then'
      || E'\n      raise exception ''Retail storefronts are run by the shop admin or a reseller''; end if;'
      || E'\n    _seller := _seller_id;');
    IF position('retail_seller_allowed' in _def) = 0 THEN
      RAISE EXCEPTION 'retail_place_order seller anchor not found';
    END IF;
    EXECUTE _def;
  END IF;
END $$;