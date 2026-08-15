-- 1. Single source of truth: cashback rate == voucher discount ------------
create or replace function public.set_member_cashback_rate(_user_id uuid, _ecosystem_id uuid, _percent integer, _reason text default null::text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _role public.app_role; _prev integer; _actor text; _eco uuid; _other integer; _parent uuid;
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
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Operator'), 'Updated member discount',
          (select full_name from public.profiles where id = _user_id),
          jsonb_build_object('member_id', _user_id, 'role', _role,
                             'previous_percent', _prev, 'new_percent', _percent,
                             'voucher_discount_percent', _percent,
                             'reason', _reason, 'applies_to', 'future purchases only'));
  return _percent;
end $function$;

-- 2. Voucher discount is derived, never separately stored -----------------
create or replace function public.voucher_discount_percent_for(_user_id uuid)
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare _eco uuid; _pct integer := 0; _role public.app_role;
begin
  select p.ecosystem_id into _eco from public.profiles p where p.id = _user_id;
  if _eco is null then return 0; end if;

  -- Shop admins buy their own inventory at the platform admin voucher discount.
  if exists (select 1 from public.user_roles ur
              where ur.user_id = _user_id and ur.role = 'admin' and ur.ecosystem_id = _eco) then
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

  _pct := coalesce(public.member_cashback_rate(_user_id, _eco), 0);
  return least(greatest(_pct, 0), 100);
end $function$;

-- 3. Legacy setters delegate to the single Discount -----------------------
create or replace function public.set_reseller_discount(_user_id uuid, _discount integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _eco uuid;
begin
  select ecosystem_id into _eco from public.profiles where id = _user_id;
  perform public.set_member_cashback_rate(_user_id, _eco, _discount, 'discount editor');
end $function$;

-- 4. Promotions take one Discount value -----------------------------------
create or replace function public.promote_to_reseller(_user_id uuid, _discount integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _eco uuid; _actor_name text;
begin
  perform public.require_operational();
  select ecosystem_id into _eco from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Customer not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _discount is null or _discount < 0 or _discount > 100 then
    raise exception 'Discount must be between 0 and 100 percent';
  end if;
  if not exists (select 1 from public.user_roles where user_id = _user_id and role = 'customer') then
    raise exception 'Only customers can be promoted to reseller';
  end if;

  delete from public.user_roles where user_id = _user_id and role = 'customer';
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_user_id, 'reseller', _eco) on conflict do nothing;

  update public.profiles
     set reseller_discount_percent = _discount,
         sale_commission_percent = _discount,
         reseller_id = null
   where id = _user_id;
  update public.ecosystem_memberships
     set role = 'reseller', reseller_id = null,
         reseller_discount_percent = _discount,
         sale_commission_percent = _discount, updated_at = now()
   where user_id = _user_id and ecosystem_id = _eco;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          'Promoted customer to reseller',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_role','customer','new_role','reseller','discount_percent',_discount));
end $function$;

create or replace function public.promote_to_subreseller(_user_id uuid, _discount integer, _parent_reseller_id uuid default null::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _eco uuid; _actor_name text; _parent_eco uuid; _parent_pct integer;
begin
  perform public.require_operational();
  select ecosystem_id into _eco from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Customer not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _discount is null or _discount < 0 or _discount > 100 then
    raise exception 'Discount must be between 0 and 100 percent';
  end if;
  if not exists (select 1 from public.user_roles where user_id = _user_id and role = 'customer') then
    raise exception 'Only customers can be promoted to subreseller';
  end if;
  if _parent_reseller_id is null then
    raise exception 'Choose the parent reseller who will own this subreseller';
  end if;
  select ecosystem_id into _parent_eco from public.profiles where id = _parent_reseller_id;
  if _parent_eco is distinct from _eco then
    raise exception 'The parent reseller must belong to the same shop';
  end if;
  if not exists (select 1 from public.user_roles ur
                 where ur.user_id = _parent_reseller_id and ur.role = 'reseller' and ur.ecosystem_id = _eco) then
    raise exception 'The parent must be a reseller in this shop';
  end if;
  _parent_pct := coalesce(public.member_cashback_rate(_parent_reseller_id, _eco), 0);
  if _discount > _parent_pct then
    raise exception 'A subreseller discount comes out of the parent reseller discount (parent is % percent)', _parent_pct;
  end if;

  delete from public.user_roles where user_id = _user_id and role = 'customer';
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_user_id, 'subreseller', _eco) on conflict do nothing;

  update public.profiles
     set reseller_discount_percent = _discount,
         sale_commission_percent = _discount,
         reseller_commission_percent = 0,
         reseller_id = _parent_reseller_id
   where id = _user_id;
  update public.ecosystem_memberships
     set role = 'subreseller', reseller_id = _parent_reseller_id,
         reseller_discount_percent = _discount,
         sale_commission_percent = _discount,
         reseller_commission_percent = 0, updated_at = now()
   where user_id = _user_id and ecosystem_id = _eco;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          'Promoted customer to subreseller',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_role','customer','new_role','subreseller',
                             'discount_percent',_discount,'loading_commission_percent',0,
                             'parent_reseller_id',_parent_reseller_id,
                             'parent_reseller_name',(select full_name from public.profiles where id = _parent_reseller_id)));
end $function$;

-- 5. Reparenting reconciles the discount before future purchases ----------
create or replace function public.set_subreseller_parent(_user_id uuid, _reseller_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _eco uuid; _prev uuid; _actor_name text; _own integer; _parent_pct integer;
begin
  perform public.require_operational();
  select ecosystem_id, reseller_id into _eco, _prev from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if not exists (select 1 from public.user_roles ur
                 where ur.user_id = _user_id and ur.role = 'subreseller' and ur.ecosystem_id = _eco) then
    raise exception 'Only subresellers have a parent reseller';
  end if;
  if _reseller_id is null then raise exception 'Choose a parent reseller'; end if;
  if not exists (select 1 from public.user_roles ur
                 where ur.user_id = _reseller_id and ur.role = 'reseller' and ur.ecosystem_id = _eco) then
    raise exception 'The parent must be a reseller in this shop';
  end if;

  _own := coalesce(public.member_cashback_rate(_user_id, _eco), 0);
  _parent_pct := coalesce(public.member_cashback_rate(_reseller_id, _eco), 0);
  if _own > _parent_pct then
    raise exception 'This subreseller discount is % percent but the new parent reseller is only % percent — lower the subreseller discount first', _own, _parent_pct;
  end if;

  update public.profiles set reseller_id = _reseller_id where id = _user_id;
  update public.ecosystem_memberships set reseller_id = _reseller_id, updated_at = now()
   where user_id = _user_id and ecosystem_id = _eco;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'), 'Reassigned subreseller owner',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_parent_id',_prev,'new_parent_id',_reseller_id,
                             'new_parent_name',(select full_name from public.profiles where id = _reseller_id)));
end $function$;

-- 6. Backfill: voucher discount follows the configured Discount -----------
update public.ecosystem_memberships
   set reseller_discount_percent = coalesce(sale_commission_percent, 0), updated_at = now()
 where role in ('reseller','subreseller')
   and reseller_discount_percent is distinct from coalesce(sale_commission_percent, 0);

update public.profiles p
   set reseller_discount_percent = coalesce(p.sale_commission_percent, 0)
 where exists (select 1 from public.user_roles ur
                where ur.user_id = p.id and ur.ecosystem_id = p.ecosystem_id
                  and ur.role in ('reseller','subreseller'))
   and p.reseller_discount_percent is distinct from coalesce(p.sale_commission_percent, 0);