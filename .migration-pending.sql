-- Per-shop reseller hierarchy.
--
-- A member's role, parent reseller, discount and commission belong to ONE
-- (member, shop) membership. Being a subreseller in Shop A must place no
-- requirement whatsoever on Shop B: the parent check applies only inside the
-- shop the change is being made in.
--
-- The bug: every role RPC derived the shop from `profiles.ecosystem_id` (a
-- mirror of the member's CURRENTLY ACTIVE shop) and `validate_member_parent`
-- compared the parent's `profiles.ecosystem_id`. Assigning a parent in Shop B
-- for someone whose active shop is Shop A therefore raised
-- "The parent reseller must belong to the same shop".

-- ---------------------------------------------------------------------------
-- Which shop is a role change being made in?
-- ---------------------------------------------------------------------------
create or replace function public.member_ecosystem_scope(
  _user_id uuid, _ecosystem_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare _eco uuid; _actor_eco uuid;
begin
  if _ecosystem_id is not null then
    return _ecosystem_id;
  end if;

  select coalesce(p.active_ecosystem_id, p.ecosystem_id) into _actor_eco
    from public.profiles p where p.id = auth.uid();

  -- The shop the operator is currently working in, when the target is a
  -- member of it. This is what makes Shop B changes independent of Shop A.
  if _actor_eco is not null then
    select m.ecosystem_id into _eco
      from public.ecosystem_memberships m
     where m.user_id = _user_id
       and m.ecosystem_id = _actor_eco
       and m.membership_state = 'active'
     limit 1;
    if _eco is not null then return _eco; end if;
    if public.is_super_admin(auth.uid()) then return _actor_eco; end if;
  end if;

  select p.ecosystem_id into _eco from public.profiles p where p.id = _user_id;
  return _eco;
end $$;

comment on function public.member_ecosystem_scope(uuid, uuid) is
  'Resolves which shop a member-management action applies to: the explicit shop, else the operator''s current shop when the member belongs to it, else the member''s active shop.';

-- ---------------------------------------------------------------------------
-- Parent validation: membership-scoped, never cross-shop
-- ---------------------------------------------------------------------------
create or replace function public.validate_member_parent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _is_sub boolean;
begin
  -- Role is per shop: only consider the role held in THIS profile's shop.
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = new.id and ur.role = 'subreseller'
      and ur.ecosystem_id is not distinct from new.ecosystem_id
  ) into _is_sub;

  if new.reseller_id is null then
    if _is_sub then
      raise exception 'A subreseller must always belong to a parent reseller';
    end if;
    return new;
  end if;

  if new.reseller_id = new.id then
    raise exception 'A member cannot be their own parent reseller';
  end if;

  -- The parent only has to be a member of THIS shop. Their standing in any
  -- other shop is irrelevant.
  if new.ecosystem_id is not null and not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = new.reseller_id
       and m.ecosystem_id = new.ecosystem_id
       and m.membership_state = 'active'
  ) then
    raise exception 'The parent reseller must be a member of this shop';
  end if;

  if _is_sub and not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = new.reseller_id
       and m.ecosystem_id = new.ecosystem_id
       and m.membership_state = 'active'
       and m.role = 'reseller'
  ) and not exists (
    select 1 from public.user_roles ur
     where ur.user_id = new.reseller_id and ur.role = 'reseller'
       and ur.ecosystem_id = new.ecosystem_id
  ) then
    raise exception 'A subreseller can only be owned by a reseller in the same shop';
  end if;

  if exists (select 1 from public.profiles p
              where p.id = new.reseller_id and p.reseller_id = new.id) then
    raise exception 'Circular reseller ownership is not allowed';
  end if;

  return new;
end $$;

-- Authoritative check on the membership row itself.
create or replace function public.validate_membership_parent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.reseller_id is null then return new; end if;
  -- Only validate when the parent link is actually being set or changed, so
  -- unrelated updates to legacy rows are never blocked.
  if tg_op = 'UPDATE' and new.reseller_id is not distinct from old.reseller_id then
    return new;
  end if;
  if new.reseller_id = new.user_id then
    raise exception 'A member cannot be their own parent reseller';
  end if;
  if not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = new.reseller_id
       and m.ecosystem_id = new.ecosystem_id
       and m.membership_state = 'active'
       and m.role in ('reseller','admin')
  ) then
    raise exception 'The parent must be a reseller in this shop';
  end if;
  if exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = new.reseller_id
       and m.ecosystem_id = new.ecosystem_id
       and m.reseller_id = new.user_id
  ) then
    raise exception 'Circular reseller ownership is not allowed';
  end if;
  return new;
end $$;

drop trigger if exists ecosystem_memberships_validate_parent on public.ecosystem_memberships;
create trigger ecosystem_memberships_validate_parent
before insert or update of reseller_id, role on public.ecosystem_memberships
for each row execute function public.validate_membership_parent();

-- ---------------------------------------------------------------------------
-- Shop-scoped role management
-- ---------------------------------------------------------------------------
drop function if exists public.promote_to_reseller(uuid, integer);
create or replace function public.promote_to_reseller(
  _user_id uuid, _discount integer, _ecosystem_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _eco uuid; _actor_name text; _role public.app_role;
begin
  perform public.require_operational();
  _eco := public.member_ecosystem_scope(_user_id, _ecosystem_id);
  if _eco is null then raise exception 'Shop not found for this member'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _discount is null or _discount < 0 or _discount > 100 then
    raise exception 'Discount must be between 0 and 100 percent';
  end if;

  select m.role into _role from public.ecosystem_memberships m
   where m.user_id = _user_id and m.ecosystem_id = _eco and m.membership_state = 'active';
  if _role is null then raise exception 'That member does not belong to this shop'; end if;
  if _role <> 'customer' then
    raise exception 'Only customers can be promoted to reseller';
  end if;

  delete from public.user_roles
   where user_id = _user_id and role = 'customer' and ecosystem_id = _eco;
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_user_id, 'reseller', _eco) on conflict do nothing;

  update public.ecosystem_memberships
     set role = 'reseller', reseller_id = null,
         reseller_discount_percent = _discount,
         sale_commission_percent = _discount, updated_at = now()
   where user_id = _user_id and ecosystem_id = _eco;

  -- The profile is only a mirror of the member's CURRENT shop.
  update public.profiles
     set reseller_discount_percent = _discount,
         sale_commission_percent = _discount,
         reseller_id = null
   where id = _user_id and ecosystem_id = _eco;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          'Promoted customer to reseller',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_role','customer','new_role','reseller',
                             'shop_id',_eco,'discount_percent',_discount));
end $$;

drop function if exists public.promote_to_subreseller(uuid, integer, uuid);
create or replace function public.promote_to_subreseller(
  _user_id uuid, _discount integer, _parent_reseller_id uuid default null,
  _ecosystem_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _eco uuid; _actor_name text; _parent_pct integer; _role public.app_role;
begin
  perform public.require_operational();
  _eco := public.member_ecosystem_scope(_user_id, _ecosystem_id);
  if _eco is null then raise exception 'Shop not found for this member'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _discount is null or _discount < 0 or _discount > 100 then
    raise exception 'Discount must be between 0 and 100 percent';
  end if;

  select m.role into _role from public.ecosystem_memberships m
   where m.user_id = _user_id and m.ecosystem_id = _eco and m.membership_state = 'active';
  if _role is null then raise exception 'That member does not belong to this shop'; end if;
  if _role <> 'customer' then
    raise exception 'Only customers can be promoted to subreseller';
  end if;

  if _parent_reseller_id is null then
    raise exception 'Choose the parent reseller who will own this subreseller';
  end if;
  -- The parent only needs to be a reseller in THIS shop.
  if not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _parent_reseller_id and m.ecosystem_id = _eco
       and m.membership_state = 'active' and m.role = 'reseller') then
    raise exception 'The parent must be a reseller in this shop';
  end if;

  _parent_pct := coalesce(public.member_cashback_rate(_parent_reseller_id, _eco), 0);
  if _discount > _parent_pct then
    raise exception 'A subreseller discount comes out of the parent reseller discount (parent is % percent)', _parent_pct;
  end if;

  delete from public.user_roles
   where user_id = _user_id and role = 'customer' and ecosystem_id = _eco;
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_user_id, 'subreseller', _eco) on conflict do nothing;

  update public.ecosystem_memberships
     set role = 'subreseller', reseller_id = _parent_reseller_id,
         reseller_discount_percent = _discount,
         sale_commission_percent = _discount,
         reseller_commission_percent = 0, updated_at = now()
   where user_id = _user_id and ecosystem_id = _eco;

  update public.profiles
     set reseller_discount_percent = _discount,
         sale_commission_percent = _discount,
         reseller_commission_percent = 0,
         reseller_id = _parent_reseller_id
   where id = _user_id and ecosystem_id = _eco;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          'Promoted customer to subreseller',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_role','customer','new_role','subreseller',
                             'shop_id',_eco,
                             'discount_percent',_discount,'loading_commission_percent',0,
                             'parent_reseller_id',_parent_reseller_id,
                             'parent_reseller_name',(select full_name from public.profiles where id = _parent_reseller_id)));
end $$;

drop function if exists public.set_subreseller_parent(uuid, uuid);
create or replace function public.set_subreseller_parent(
  _user_id uuid, _reseller_id uuid, _ecosystem_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _eco uuid; _prev uuid; _actor_name text; _own integer; _parent_pct integer;
begin
  perform public.require_operational();
  _eco := public.member_ecosystem_scope(_user_id, _ecosystem_id);
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  select m.reseller_id into _prev from public.ecosystem_memberships m
   where m.user_id = _user_id and m.ecosystem_id = _eco;

  if not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _user_id and m.ecosystem_id = _eco
       and m.membership_state = 'active' and m.role = 'subreseller') then
    raise exception 'Only subresellers have a parent reseller';
  end if;
  if _reseller_id is null then raise exception 'Choose a parent reseller'; end if;
  if not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _reseller_id and m.ecosystem_id = _eco
       and m.membership_state = 'active' and m.role = 'reseller') then
    raise exception 'The parent must be a reseller in this shop';
  end if;

  _own := coalesce(public.member_cashback_rate(_user_id, _eco), 0);
  _parent_pct := coalesce(public.member_cashback_rate(_reseller_id, _eco), 0);
  if _own > _parent_pct then
    raise exception 'This subreseller discount is % percent but the new parent reseller is only % percent — lower the subreseller discount first', _own, _parent_pct;
  end if;

  update public.ecosystem_memberships set reseller_id = _reseller_id, updated_at = now()
   where user_id = _user_id and ecosystem_id = _eco;
  update public.profiles set reseller_id = _reseller_id
   where id = _user_id and ecosystem_id = _eco;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'), 'Reassigned subreseller owner',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_parent_id',_prev,'new_parent_id',_reseller_id,
                             'shop_id',_eco,
                             'new_parent_name',(select full_name from public.profiles where id = _reseller_id)));
end $$;

-- ---------------------------------------------------------------------------
-- Restructuring: same shop scoping
-- ---------------------------------------------------------------------------
drop function if exists public.restructure_member_role(uuid, public.app_role, text, uuid, jsonb);
create or replace function public.restructure_member_role(
  _user_id uuid, _new_role public.app_role, _reason text,
  _parent_reseller_id uuid default null,
  _child_reassignments jsonb default '[]'::jsonb,
  _ecosystem_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _eco uuid; _role public.app_role; _prev_parent uuid; _actor_name text;
  _reason_clean text; _child record; _new_parent uuid; _moved jsonb := '[]'::jsonb;
  _remaining integer; _target text; _keep_parent uuid;
begin
  perform public.require_operational();

  _reason_clean := nullif(trim(coalesce(_reason, '')), '');
  if _reason_clean is null or length(_reason_clean) < 5 then
    raise exception 'A reason of at least 5 characters is required for a role change';
  end if;

  select p.full_name || ' — ' || p.email into _target
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _target is null then raise exception 'Member not found'; end if;

  _eco := public.member_ecosystem_scope(_user_id, _ecosystem_id);
  if _eco is null then raise exception 'Member not found'; end if;

  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  if _user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;

  if exists (select 1 from public.user_roles r
              where r.user_id = _user_id and r.role in ('super_admin','admin')) then
    raise exception 'Admin and platform owner roles cannot be changed here';
  end if;

  select m.role, m.reseller_id into _role, _prev_parent
    from public.ecosystem_memberships m
   where m.user_id = _user_id and m.ecosystem_id = _eco and m.membership_state = 'active';
  if _role is null or _role not in ('reseller','subreseller') then
    raise exception 'Only resellers and subresellers can be restructured here';
  end if;

  if _new_role not in ('reseller','subreseller','customer') then
    raise exception 'Only reseller, subreseller and customer are allowed as the new role';
  end if;
  if _new_role = _role then raise exception 'That member already has this role'; end if;

  -- Children are counted inside THIS shop only.
  if _new_role in ('subreseller','customer') then
    for _child in
      select m.user_id as id, p.full_name
        from public.ecosystem_memberships m
        join public.profiles p on p.id = m.user_id and p.deleted_at is null
       where m.ecosystem_id = _eco and m.role = 'subreseller'
         and m.membership_state = 'active' and m.reseller_id = _user_id
    loop
      select nullif(x.value ->> 'new_parent_id','')::uuid into _new_parent
        from jsonb_array_elements(coalesce(_child_reassignments,'[]'::jsonb)) x
       where (x.value ->> 'child_id')::uuid = _child.id
       limit 1;

      if _new_parent is null then
        raise exception 'Reassign % to another reseller before demoting this reseller', _child.full_name;
      end if;
      if _new_parent = _user_id or _new_parent = _child.id then
        raise exception 'Choose a different reseller for %', _child.full_name;
      end if;
      if not exists (select 1 from public.ecosystem_memberships m
                      where m.user_id = _new_parent and m.ecosystem_id = _eco
                        and m.membership_state = 'active' and m.role = 'reseller') then
        raise exception 'The new owner of % must be a reseller in this shop', _child.full_name;
      end if;

      update public.ecosystem_memberships set reseller_id = _new_parent, updated_at = now()
       where user_id = _child.id and ecosystem_id = _eco;
      update public.profiles set reseller_id = _new_parent
       where id = _child.id and ecosystem_id = _eco;

      _moved := _moved || jsonb_build_object(
        'child_id', _child.id, 'child_name', _child.full_name,
        'previous_parent_id', _user_id, 'new_parent_id', _new_parent,
        'new_parent_name', (select full_name from public.profiles where id = _new_parent));
    end loop;

    select count(*) into _remaining
      from public.ecosystem_memberships m
     where m.ecosystem_id = _eco and m.role = 'subreseller'
       and m.membership_state = 'active' and m.reseller_id = _user_id;
    if _remaining > 0 then
      raise exception 'This reseller still owns % subreseller(s)', _remaining;
    end if;
  end if;

  if _new_role = 'subreseller' then
    if _parent_reseller_id is null then
      raise exception 'Choose the parent reseller who will own this subreseller';
    end if;
    if _parent_reseller_id = _user_id then
      raise exception 'A member cannot be their own parent reseller';
    end if;
    if not exists (select 1 from public.ecosystem_memberships m
                    where m.user_id = _parent_reseller_id and m.ecosystem_id = _eco
                      and m.membership_state = 'active' and m.role = 'reseller') then
      raise exception 'The parent must be a reseller in this shop';
    end if;

    update public.ecosystem_memberships
       set role = 'subreseller', reseller_id = _parent_reseller_id,
           reseller_commission_percent = 0, updated_at = now()
     where user_id = _user_id and ecosystem_id = _eco;
    update public.profiles
       set reseller_id = _parent_reseller_id, reseller_commission_percent = 0
     where id = _user_id and ecosystem_id = _eco;

    delete from public.user_roles where user_id = _user_id and role = 'reseller' and ecosystem_id = _eco;
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (_user_id, 'subreseller', _eco) on conflict do nothing;

  elsif _new_role = 'customer' then
    _keep_parent := case when _role = 'subreseller' then _prev_parent else null end;
    update public.ecosystem_memberships
       set role = 'customer', reseller_id = _keep_parent,
           reseller_discount_percent = 0, reseller_commission_percent = 0,
           sale_commission_percent = null, updated_at = now()
     where user_id = _user_id and ecosystem_id = _eco;
    update public.profiles
       set reseller_id = _keep_parent, reseller_discount_percent = 0,
           reseller_commission_percent = 0, sale_commission_percent = null
     where id = _user_id and ecosystem_id = _eco;

    delete from public.user_roles
     where user_id = _user_id and role in ('reseller','subreseller') and ecosystem_id = _eco;
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (_user_id, 'customer', _eco) on conflict do nothing;

  else
    update public.ecosystem_memberships
       set role = 'reseller', reseller_id = null, updated_at = now()
     where user_id = _user_id and ecosystem_id = _eco;
    update public.profiles set reseller_id = null
     where id = _user_id and ecosystem_id = _eco;

    delete from public.user_roles where user_id = _user_id and role = 'subreseller' and ecosystem_id = _eco;
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (_user_id, 'reseller', _eco) on conflict do nothing;
  end if;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name, 'Admin'),
          case when _new_role = 'customer' and _role = 'reseller' then 'Restructured reseller to customer'
               when _new_role = 'customer' then 'Restructured subreseller to customer'
               when _new_role = 'reseller' then 'Restructured subreseller to reseller'
               else 'Restructured reseller to subreseller' end,
          coalesce(_target, ''),
          jsonb_build_object(
            'user_id', _user_id,
            'shop_id', _eco,
            'previous_role', _role,
            'new_role', _new_role,
            'previous_parent_id', _prev_parent,
            'previous_parent_name', (select full_name from public.profiles where id = _prev_parent),
            'new_parent_id', case when _new_role = 'subreseller' then _parent_reseller_id
                                  when _new_role = 'customer' then _keep_parent else null end,
            'new_parent_name', (select full_name from public.profiles
                                 where id = case when _new_role = 'subreseller' then _parent_reseller_id
                                                 when _new_role = 'customer' then _keep_parent end),
            'reassigned_children', _moved,
            'reason', _reason_clean));

  return jsonb_build_object(
    'user_id', _user_id, 'shop_id', _eco, 'previous_role', _role, 'new_role', _new_role,
    'new_parent_id', case when _new_role = 'subreseller' then _parent_reseller_id
                          when _new_role = 'customer' then _keep_parent else null end,
    'reassigned_children', _moved);
end $$;

revoke all on function public.member_ecosystem_scope(uuid, uuid) from public, anon;
grant execute on function public.member_ecosystem_scope(uuid, uuid) to authenticated, service_role;
revoke all on function public.promote_to_reseller(uuid, integer, uuid) from public, anon;
grant execute on function public.promote_to_reseller(uuid, integer, uuid) to authenticated, service_role;
revoke all on function public.promote_to_subreseller(uuid, integer, uuid, uuid) from public, anon;
grant execute on function public.promote_to_subreseller(uuid, integer, uuid, uuid) to authenticated, service_role;
revoke all on function public.set_subreseller_parent(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_subreseller_parent(uuid, uuid, uuid) to authenticated, service_role;
revoke all on function public.restructure_member_role(uuid, public.app_role, text, uuid, jsonb, uuid) from public, anon;
grant execute on function public.restructure_member_role(uuid, public.app_role, text, uuid, jsonb, uuid) to authenticated, service_role;
