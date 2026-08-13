-- 1. Applications table
CREATE TABLE public.membership_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decision_reason text,
  decided_by uuid,
  decider_name text,
  decider_role public.app_role,
  decided_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX membership_applications_eco_status_idx
  ON public.membership_applications (ecosystem_id, status, created_at DESC);
CREATE INDEX membership_applications_email_idx ON public.membership_applications (lower(email));

GRANT SELECT ON public.membership_applications TO authenticated;
GRANT ALL ON public.membership_applications TO service_role;

ALTER TABLE public.membership_applications ENABLE ROW LEVEL SECURITY;

-- Who may review applications for a given shop.
CREATE OR REPLACE FUNCTION public.can_review_applications(_user_id uuid, _ecosystem_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_super_admin(_user_id) OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.ecosystem_id = _ecosystem_id
      AND ur.role IN ('admin','reseller','subreseller')
  );
$$;

CREATE POLICY "Applicants read their own application"
  ON public.membership_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Approvers read applications for their shop"
  ON public.membership_applications FOR SELECT TO authenticated
  USING (public.can_review_applications(auth.uid(), ecosystem_id));

-- Writes only happen through SECURITY DEFINER functions.
CREATE TRIGGER membership_applications_updated_at
  BEFORE UPDATE ON public.membership_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Self-signup now creates a pending application instead of a live membership.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
declare
  _eco uuid;
  _inv public.admin_invitations%rowtype;
  _role public.app_role := 'customer';
  _bs public.platform_bootstrap%rowtype;
  _demo boolean := coalesce((new.raw_user_meta_data->>'demo')::boolean, false);
  _self boolean := false;
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
    raise exception 'Sign-up requires a valid ecosystem invite link';
  else
    -- Public self-service signup: membership requires approval.
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
    case when _self then null else _eco end,
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
  else
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

-- 3. Applicant-facing status lookup.
CREATE OR REPLACE FUNCTION public.my_membership_application()
RETURNS TABLE(status text, ecosystem_name text, decision_reason text, created_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.status, e.name, a.decision_reason, a.created_at
  FROM public.membership_applications a
  JOIN public.ecosystems e ON e.id = a.ecosystem_id
  WHERE a.user_id = auth.uid()
  ORDER BY a.created_at DESC
  LIMIT 1;
$$;

-- 4. Approve / reject.
CREATE OR REPLACE FUNCTION public.review_membership_application(
  _application_id uuid,
  _approve boolean,
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
declare
  _app public.membership_applications%rowtype;
  _actor_name text;
  _actor_role public.app_role;
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
    update public.profiles set ecosystem_id = _app.ecosystem_id, updated_at = now()
     where id = _app.user_id;

    insert into public.user_roles (user_id, role, ecosystem_id)
    values (_app.user_id, 'customer', _app.ecosystem_id)
    on conflict do nothing;

    insert into public.credit_accounts (user_id, ecosystem_id)
    values (_app.user_id, _app.ecosystem_id) on conflict (user_id) do nothing;
    insert into public.points_accounts (user_id, ecosystem_id)
    values (_app.user_id, _app.ecosystem_id) on conflict (user_id) do nothing;
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
$$;

REVOKE ALL ON FUNCTION public.review_membership_application(uuid, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.review_membership_application(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_membership_application() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_review_applications(uuid, uuid) TO authenticated;