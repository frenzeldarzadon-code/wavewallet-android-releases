-- Approval creates an ecosystem-scoped membership; other shops are untouched.
CREATE OR REPLACE FUNCTION public.review_membership_application(_application_id uuid, _approve boolean, _reason text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
declare
  _app public.membership_applications%rowtype;
  _actor_name text;
  _actor_role public.app_role;
  _has_active boolean;
begin
  perform public.assert_actor_active();

  select * into _app from public.membership_applications
   where id = _application_id for update;
  if _app.id is null then
    raise exception 'Application not found';
  end if;
  if _app.status <> 'pending' then
    raise exception 'This application was already reviewed';
  end if;
  if not public.can_review_applications(auth.uid(), _app.ecosystem_id) then
    raise exception 'You are not allowed to review applications for this shop';
  end if;

  select coalesce(full_name, email) into _actor_name from public.profiles where id = auth.uid();
  select role into _actor_role from public.user_roles
   where user_id = auth.uid()
     and (ecosystem_id = _app.ecosystem_id or role = 'super_admin')
   order by case role when 'super_admin' then 0 when 'admin' then 1 when 'reseller' then 2 else 3 end
   limit 1;

  if _approve then
    -- The membership is the authority; it never affects any other shop.
    insert into public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
    values (_app.user_id, _app.ecosystem_id, 'customer', 'active', 'active')
    on conflict (user_id, ecosystem_id) do update
      set membership_state = 'active', updated_at = now();

    perform public.ensure_membership_wallets(_app.user_id, _app.ecosystem_id);

    -- Only members without an active shop get switched into this one.
    select public.active_ecosystem(_app.user_id) is not null into _has_active;
    if not _has_active then
      update public.profiles
         set ecosystem_id = _app.ecosystem_id,
             active_ecosystem_id = _app.ecosystem_id,
             updated_at = now()
       where id = _app.user_id;

      insert into public.user_roles (user_id, role, ecosystem_id)
      values (_app.user_id, 'customer', _app.ecosystem_id)
      on conflict (user_id, role) do update set ecosystem_id = excluded.ecosystem_id;
    end if;
  end if;

  update public.membership_applications
     set status = case when _approve then 'approved' else 'rejected' end,
         decision_reason = nullif(btrim(coalesce(_reason,'')), ''),
         decided_by = auth.uid(),
         decider_name = coalesce(_actor_name, 'Unknown'),
         decider_role = _actor_role,
         decided_at = now()
   where id = _app.id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_app.ecosystem_id, auth.uid(), coalesce(_actor_name, 'Unknown'),
          case when _approve then 'Approved membership application'
               else 'Rejected membership application' end,
          lower(_app.email),
          jsonb_build_object('application_id', _app.id, 'user_id', _app.user_id,
                             'actor_role', _actor_role,
                             'reason', nullif(btrim(coalesce(_reason,'')), '')));
end;
$function$;

-- A signed-in member asks to join another shop. Approval is required as usual.
CREATE OR REPLACE FUNCTION public.request_join_ecosystem(_ecosystem_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _uid uuid := auth.uid(); _p public.profiles%rowtype; _id uuid;
begin
  if _uid is null then raise exception 'Not signed in'; end if;
  if public.acting_as() is not null then
    raise exception 'Cannot join a shop while acting as another member';
  end if;

  select * into _p from public.profiles where id = _uid;
  if _p.id is null or _p.deleted_at is not null then raise exception 'Account not available'; end if;
  if public.is_super_admin(_uid) then raise exception 'Platform owners do not join shops'; end if;

  if not exists (
    select 1 from public.ecosystems e
     where e.id = _ecosystem_id and e.signup_enabled and e.archived_at is null
       and e.subscription_state = 'active' and not coalesce(e.operations_frozen, false)
  ) then
    raise exception 'That shop is not accepting members right now';
  end if;

  if exists (select 1 from public.ecosystem_memberships
              where user_id = _uid and ecosystem_id = _ecosystem_id and membership_state = 'active') then
    raise exception 'You are already a member of that shop';
  end if;

  if exists (select 1 from public.membership_applications
              where user_id = _uid and ecosystem_id = _ecosystem_id and status = 'pending') then
    raise exception 'You already have a pending request for that shop';
  end if;

  insert into public.membership_applications (user_id, ecosystem_id, full_name, email, phone)
  values (_uid, _ecosystem_id, coalesce(_p.full_name,''), coalesce(_p.email,''), coalesce(_p.phone,''))
  returning id into _id;

  return _id;
end $$;

-- All of the signed-in member's own applications, newest per shop.
CREATE OR REPLACE FUNCTION public.my_applications()
RETURNS TABLE (
  ecosystem_id uuid,
  ecosystem_name text,
  status text,
  decision_reason text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (a.ecosystem_id)
         a.ecosystem_id, e.name, a.status, a.decision_reason, a.created_at
  FROM public.membership_applications a
  JOIN public.ecosystems e ON e.id = a.ecosystem_id
  WHERE a.user_id = public.effective_uid()
  ORDER BY a.ecosystem_id, a.created_at DESC;
$$;

-- Shops the signed-in member could still ask to join.
CREATE OR REPLACE FUNCTION public.joinable_ecosystems()
RETURNS TABLE (id uuid, name text, slug text, description text, pending boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.name, e.slug, e.description,
         EXISTS (SELECT 1 FROM public.membership_applications a
                  WHERE a.user_id = public.effective_uid()
                    AND a.ecosystem_id = e.id AND a.status = 'pending')
  FROM public.ecosystems e
  WHERE e.signup_enabled AND e.archived_at IS NULL
    AND e.subscription_state = 'active'
    AND NOT COALESCE(e.operations_frozen, false)
    AND NOT EXISTS (
      SELECT 1 FROM public.ecosystem_memberships m
       WHERE m.user_id = public.effective_uid()
         AND m.ecosystem_id = e.id AND m.membership_state = 'active')
  ORDER BY e.name;
$$;

REVOKE ALL ON FUNCTION public.request_join_ecosystem(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.request_join_ecosystem(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_applications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.joinable_ecosystems() TO authenticated;