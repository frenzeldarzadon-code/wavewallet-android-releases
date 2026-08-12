-- Preview / eligibility probe for a Reseller <-> Subreseller restructure.
CREATE OR REPLACE FUNCTION public.role_restructure_check(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _eco uuid; _role public.app_role; _parent uuid; _name text; _email text;
  _children jsonb; _credits numeric := 0; _points integer := 0; _held integer := 0;
begin
  select p.ecosystem_id, p.reseller_id, p.full_name, p.email
    into _eco, _parent, _name, _email
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  select r.role into _role
    from public.user_roles r
   where r.user_id = _user_id and r.ecosystem_id = _eco
   order by case r.role when 'super_admin' then 0 when 'admin' then 1
                        when 'reseller' then 2 when 'subreseller' then 3 else 4 end
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.full_name, 'email', c.email)
                            order by c.full_name), '[]'::jsonb)
    into _children
    from public.profiles c
    join public.user_roles cr
      on cr.user_id = c.id and cr.role = 'subreseller' and cr.ecosystem_id = _eco
   where c.reseller_id = _user_id and c.ecosystem_id = _eco and c.deleted_at is null;

  select coalesce(balance, 0) into _credits from public.credit_accounts where user_id = _user_id;
  select coalesce(balance, 0), coalesce(held, 0) into _points, _held
    from public.points_accounts where user_id = _user_id;

  return jsonb_build_object(
    'user_id', _user_id,
    'ecosystem_id', _eco,
    'full_name', _name,
    'email', _email,
    'current_role', _role,
    'parent_reseller_id', _parent,
    'parent_reseller_name', (select full_name from public.profiles where id = _parent),
    'children', _children,
    'child_count', jsonb_array_length(_children),
    'credits', _credits,
    'points', _points,
    'points_held', _held,
    'eligible', _role in ('reseller','subreseller'),
    'target_role', case _role when 'reseller' then 'subreseller'
                              when 'subreseller' then 'reseller' else null end
  );
end; $function$;

REVOKE ALL ON FUNCTION public.role_restructure_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.role_restructure_check(uuid) TO authenticated, service_role;

-- Atomic Reseller <-> Subreseller restructure.
-- _child_reassignments: jsonb array of {child_id, new_parent_id} used only when
-- demoting a reseller that still owns subresellers.
CREATE OR REPLACE FUNCTION public.restructure_member_role(
  _user_id uuid,
  _new_role public.app_role,
  _reason text,
  _parent_reseller_id uuid DEFAULT NULL,
  _child_reassignments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _eco uuid; _role public.app_role; _prev_parent uuid; _actor_name text;
  _reason_clean text; _child record; _new_parent uuid; _moved jsonb := '[]'::jsonb;
  _remaining integer; _target text;
begin
  perform public.require_operational();

  _reason_clean := nullif(trim(coalesce(_reason, '')), '');
  if _reason_clean is null or length(_reason_clean) < 5 then
    raise exception 'A reason of at least 5 characters is required for a role change';
  end if;

  select p.ecosystem_id, p.reseller_id, p.full_name || ' — ' || p.email
    into _eco, _prev_parent, _target
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _eco is null then raise exception 'Member not found'; end if;

  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  if _user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;

  if exists (select 1 from public.user_roles r
              where r.user_id = _user_id and r.role in ('super_admin','admin')) then
    raise exception 'Admin and platform owner roles cannot be changed here';
  end if;

  select r.role into _role
    from public.user_roles r
   where r.user_id = _user_id and r.ecosystem_id = _eco and r.role in ('reseller','subreseller')
   order by case r.role when 'reseller' then 0 else 1 end
   limit 1;
  if _role is null then
    raise exception 'Only resellers and subresellers can be restructured here';
  end if;

  if _new_role not in ('reseller','subreseller') then
    raise exception 'Only reseller and subreseller are allowed as the new role';
  end if;
  if _new_role = _role then raise exception 'That member already has this role'; end if;

  if _new_role = 'subreseller' then
    -- Demotion. The demoted member needs a valid parent reseller.
    if _parent_reseller_id is null then
      raise exception 'Choose the parent reseller who will own this subreseller';
    end if;
    if _parent_reseller_id = _user_id then
      raise exception 'A member cannot be their own parent reseller';
    end if;
    if not exists (select 1 from public.user_roles r
                    where r.user_id = _parent_reseller_id and r.role = 'reseller'
                      and r.ecosystem_id = _eco) then
      raise exception 'The parent must be a reseller in this shop';
    end if;

    -- Reassign every child subreseller first; none may be left behind.
    for _child in
      select c.id, c.full_name
        from public.profiles c
        join public.user_roles cr
          on cr.user_id = c.id and cr.role = 'subreseller' and cr.ecosystem_id = _eco
       where c.reseller_id = _user_id and c.ecosystem_id = _eco and c.deleted_at is null
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
      if not exists (select 1 from public.user_roles r
                      where r.user_id = _new_parent and r.role = 'reseller'
                        and r.ecosystem_id = _eco) then
        raise exception 'The new owner of % must be a reseller in this shop', _child.full_name;
      end if;

      update public.profiles set reseller_id = _new_parent where id = _child.id;
      _moved := _moved || jsonb_build_object(
        'child_id', _child.id, 'child_name', _child.full_name,
        'previous_parent_id', _user_id, 'new_parent_id', _new_parent,
        'new_parent_name', (select full_name from public.profiles where id = _new_parent));
    end loop;

    select count(*) into _remaining
      from public.profiles c
      join public.user_roles cr
        on cr.user_id = c.id and cr.role = 'subreseller' and cr.ecosystem_id = _eco
     where c.reseller_id = _user_id and c.deleted_at is null;
    if _remaining > 0 then
      raise exception 'This reseller still owns % subreseller(s)', _remaining;
    end if;

    -- Attach the parent first, then swap the role (keeps the parent rule satisfied).
    update public.profiles
       set reseller_id = _parent_reseller_id,
           reseller_commission_percent = 0   -- subresellers never earn loading commission
     where id = _user_id;
    delete from public.user_roles where user_id = _user_id and role = 'reseller' and ecosystem_id = _eco;
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (_user_id, 'subreseller', _eco) on conflict do nothing;

  else
    -- Promotion: a reseller has no parent.
    delete from public.user_roles where user_id = _user_id and role = 'subreseller' and ecosystem_id = _eco;
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (_user_id, 'reseller', _eco) on conflict do nothing;
    update public.profiles set reseller_id = null where id = _user_id;
  end if;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name, 'Admin'),
          case when _new_role = 'reseller' then 'Restructured subreseller to reseller'
               else 'Restructured reseller to subreseller' end,
          coalesce(_target, ''),
          jsonb_build_object(
            'user_id', _user_id,
            'previous_role', _role,
            'new_role', _new_role,
            'previous_parent_id', _prev_parent,
            'previous_parent_name', (select full_name from public.profiles where id = _prev_parent),
            'new_parent_id', case when _new_role = 'subreseller' then _parent_reseller_id else null end,
            'new_parent_name', (select full_name from public.profiles where id = _parent_reseller_id),
            'reassigned_children', _moved,
            'reason', _reason_clean));

  return jsonb_build_object(
    'user_id', _user_id, 'previous_role', _role, 'new_role', _new_role,
    'new_parent_id', case when _new_role = 'subreseller' then _parent_reseller_id else null end,
    'reassigned_children', _moved);
end; $function$;

REVOKE ALL ON FUNCTION public.restructure_member_role(uuid, public.app_role, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restructure_member_role(uuid, public.app_role, text, uuid, jsonb) TO authenticated, service_role;