-- Discounts are configuration, not code: allow the full 0–100 range everywhere
-- the value is stored, and validate it consistently server-side.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_reseller_discount_percent_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_reseller_discount_percent_check
  CHECK (reseller_discount_percent IS NULL
         OR (reseller_discount_percent >= 0 AND reseller_discount_percent <= 100));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_sale_commission_percent_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_sale_commission_percent_check
  CHECK (sale_commission_percent IS NULL
         OR (sale_commission_percent >= 0 AND sale_commission_percent <= 100));

ALTER TABLE public.ecosystem_memberships
  DROP CONSTRAINT IF EXISTS ecosystem_memberships_reseller_discount_percent_check;
ALTER TABLE public.ecosystem_memberships
  ADD CONSTRAINT ecosystem_memberships_reseller_discount_percent_check
  CHECK (reseller_discount_percent IS NULL
         OR (reseller_discount_percent >= 0 AND reseller_discount_percent <= 100));

ALTER TABLE public.ecosystem_memberships
  DROP CONSTRAINT IF EXISTS ecosystem_memberships_sale_commission_percent_check;
ALTER TABLE public.ecosystem_memberships
  ADD CONSTRAINT ecosystem_memberships_sale_commission_percent_check
  CHECK (sale_commission_percent IS NULL
         OR (sale_commission_percent >= 0 AND sale_commission_percent <= 100));

-- Whole numbers only, and a clearer audit trail (old value, new value, shop,
-- actor, reason, timestamp) for every discount change.
CREATE OR REPLACE FUNCTION public.set_member_cashback_rate(_user_id uuid, _ecosystem_id uuid, _percent integer, _reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _role public.app_role; _prev integer; _actor text; _eco uuid; _other integer; _parent uuid;
        _target text; _shop text;
begin
  _eco := _ecosystem_id;
  if _eco is null then
    select ecosystem_id into _eco from public.profiles where id = _user_id;
  end if;
  if _eco is null then raise exception 'Shop not found for this member'; end if;

  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _eco)) then
    raise exception 'Not authorized to set discounts in this shop';
  end if;
  if _user_id = auth.uid() then
    raise exception 'You cannot change your own discount';
  end if;
  if _percent is null or _percent < 0 or _percent > 100 then
    raise exception 'Discount must be between 0 and 100 percent';
  end if;

  select m.role, m.sale_commission_percent, coalesce(m.reseller_id, p.reseller_id)
    into _role, _prev, _parent
    from public.profiles p
    left join public.ecosystem_memberships m
           on m.user_id = p.id and m.ecosystem_id = _eco
   where p.id = _user_id;
  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _user_id and ur.ecosystem_id = _eco
     order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
    select p.sale_commission_percent into _prev from public.profiles p where p.id = _user_id;
  end if;
  if _role is null or _role not in ('reseller','subreseller') then
    raise exception 'Only resellers and subresellers have a discount';
  end if;

  if _role = 'subreseller' then
    if _parent is null then
      raise exception 'This subreseller has no parent reseller in this shop';
    end if;
    _other := coalesce(public.member_cashback_rate(_parent, _eco), 0);
    if _percent > _other then
      raise exception 'A subreseller discount comes out of the parent reseller discount (parent is % percent)', _other;
    end if;
  else
    select coalesce(max(public.member_cashback_rate(m.user_id, _eco)), 0) into _other
      from public.ecosystem_memberships m
     where m.ecosystem_id = _eco and m.role = 'subreseller' and m.reseller_id = _user_id;
    if _percent < coalesce(_other, 0) then
      raise exception 'A subreseller is set to % percent — the reseller discount cannot be lower', _other;
    end if;
  end if;

  -- The single Discount value drives both cashback share and voucher discount.
  -- Scoped to this shop only: other shops keep their own configured values.
  update public.ecosystem_memberships m
     set sale_commission_percent = _percent,
         reseller_discount_percent = _percent,
         updated_at = now()
   where m.user_id = _user_id and m.ecosystem_id = _eco;
  update public.profiles p
     set sale_commission_percent = _percent,
         reseller_discount_percent = _percent
   where p.id = _user_id and p.ecosystem_id = _eco;

  select full_name into _actor from public.profiles where id = auth.uid();
  select full_name into _target from public.profiles where id = _user_id;
  select name into _shop from public.ecosystems where id = _eco;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Operator'), 'Updated member discount',
          coalesce(_target,'Member'),
          jsonb_build_object('member_id', _user_id, 'role', _role,
                             'shop_id', _eco, 'shop_name', _shop,
                             'previous_percent', _prev, 'new_percent', _percent,
                             'voucher_discount_percent', _percent,
                             'changed_at', now(),
                             'reason', _reason, 'applies_to', 'future purchases only'));
  return _percent;
end $function$;