CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _eco uuid;
  _inv public.admin_invitations%rowtype;
  _role public.app_role := 'customer';
  _bs public.platform_bootstrap%rowtype;
  _demo boolean := coalesce((new.raw_user_meta_data->>'demo')::boolean, false);
  _self boolean := false;
  _global boolean := false;
begin
  select id into _eco
  from public.ecosystems
  where slug = lower(nullif(new.raw_user_meta_data->>'ecosystem_slug',''))
    and signup_enabled;

  select * into _bs
  from public.platform_bootstrap
  where completed_at is null
    and lower(claimed_email) = lower(new.email)
    and claimed_at > now() - interval '60 minutes'
  for update;

  select * into _inv
  from public.admin_invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  if _bs.id is not null and not _demo then
    _role := 'super_admin';
    _eco := null;
  elsif _inv.id is not null then
    _role := _inv.role;
    _eco := case when _inv.role = 'super_admin' then null else _inv.ecosystem_id end;
  elsif _eco is null then
    -- Global Universe account: no shop yet. Membership is requested later and
    -- still requires approval, so no role and no ecosystem are granted here.
    _global := not _demo;
  else
    _self := not _demo;
  end if;

  if _self then
    if (select count(*) from public.membership_applications
        where lower(email) = lower(coalesce(new.email,''))
          and created_at > now() - interval '1 hour') >= 3 then
      raise exception 'Too many signup attempts for this email. Please try again later.';
    end if;
    if (select count(*) from public.membership_applications
        where ecosystem_id = _eco
          and created_at > now() - interval '5 minutes') >= 20 then
      raise exception 'Too many signups right now. Please try again in a few minutes.';
    end if;
  end if;

  insert into public.profiles (id, ecosystem_id, full_name, email, phone, is_demo)
  values (
    new.id,
    case when _self or _global then null else _eco end,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    _demo
  );

  if _self then
    insert into public.membership_applications (user_id, ecosystem_id, full_name, email, phone)
    values (new.id, _eco,
            coalesce(new.raw_user_meta_data->>'full_name', ''),
            coalesce(new.email, ''),
            coalesce(new.raw_user_meta_data->>'phone', ''));

    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
            'Membership application submitted', lower(coalesce(new.email,'')),
            jsonb_build_object('ecosystem_id', _eco, 'source', 'self_signup'));
  elsif not _global then
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (new.id, _role, _eco)
    on conflict do nothing;
  end if;

  if _bs.id is not null and not _demo then
    update public.platform_bootstrap
       set completed_at = now(), super_admin_id = new.id
     where id = true;

    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (null, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
            'Initial Super Admin created', lower(new.email),
            jsonb_build_object('source', _bs.source, 'claimed_at', _bs.claimed_at,
                               'completed_at', now(), 'method', 'initial_bootstrap'));
  end if;

  if _inv.id is not null and (_bs.id is null or _demo) then
    update public.admin_invitations
       set status = 'accepted', accepted_at = now()
     where id = _inv.id;

    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
            'Accepted ' || _role::text || ' invitation', lower(new.email),
            jsonb_build_object('invitation_id', _inv.id, 'invited_by', _inv.invited_by));
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_eco, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
          'Account created', coalesce(new.email, ''));

  return new;
end;
$function$;