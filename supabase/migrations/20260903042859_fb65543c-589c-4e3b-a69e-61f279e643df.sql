create or replace function public.voucher_discount_percent_for(_user_id uuid, _ecosystem_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $function$
declare _eco uuid; _role public.app_role;
begin
  _eco := _ecosystem_id;
  if _eco is null then
    select p.ecosystem_id into _eco from public.profiles p where p.id = _user_id;
  end if;
  if _eco is null then return 0; end if;

  -- Universe: everyone — admin, reseller, subreseller, customer — pays the same
  -- customer price. Earnings come from cashback / the shop remainder only.
  if public.is_universe_shop(_eco) then return 0; end if;

  -- New Generation: shop admins buy their own inventory at the platform admin voucher discount.
  if exists (select 1 from public.user_roles ur
              where ur.user_id = _user_id and ur.role = 'admin' and ur.ecosystem_id = _eco)
     or exists (select 1 from public.ecosystem_memberships m
                 where m.user_id = _user_id and m.ecosystem_id = _eco and m.role = 'admin') then
    return public.admin_voucher_discount_percent();
  end if;

  select m.role into _role from public.ecosystem_memberships m
   where m.user_id = _user_id and m.ecosystem_id = _eco;
  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _user_id and ur.ecosystem_id = _eco
     order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
  end if;
  if _role is null or _role not in ('reseller','subreseller') then return 0; end if;

  -- Exactly the member's configured Discount — never a second setting.
  return least(greatest(coalesce(public.member_cashback_rate(_user_id, _eco), 0), 0), 100);
end $function$;

-- purchase_voucher: in Universe shops the shop remainder (seller's cut) is paid to
-- the shop admin even when the admin is the buyer (they now pay full retail price).
-- Applied as a targeted text replacement of the single guard line so the rest of
-- the live function is preserved byte-for-byte.
do $do$
declare _def text; _old text; _new text;
begin
  select pg_get_functiondef('public.purchase_voucher(uuid,integer,uuid)'::regprocedure) into _def;
  _old := 'if _admin_id is not null and _admin_id <> _subject then';
  _new := 'if _admin_id is not null and (_universe or _admin_id <> _subject) then';
  if position(_new in _def) > 0 then
    return; -- already applied
  end if;
  if (length(_def) - length(replace(_def, _old, ''))) / length(_old) <> 1 then
    raise exception 'purchase_voucher guard line not found exactly once; aborting';
  end if;
  _def := replace(_def, _old, _new);
  execute _def;
end $do$;