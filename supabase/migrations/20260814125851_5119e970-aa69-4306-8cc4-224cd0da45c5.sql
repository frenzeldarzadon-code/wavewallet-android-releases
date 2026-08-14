ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS member_invitation_expiry_days integer NOT NULL DEFAULT 14;

CREATE TABLE IF NOT EXISTS public.ecosystem_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  inviter_name text NOT NULL DEFAULT 'Unknown',
  inviter_role public.app_role,
  role public.app_role NOT NULL DEFAULT 'customer',
  message text,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  responded_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ecosystem_invitations_status_chk
    CHECK (status IN ('pending','accepted','declined','expired','cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ecosystem_invitations_one_pending
  ON public.ecosystem_invitations (ecosystem_id, user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ecosystem_invitations_user_idx
  ON public.ecosystem_invitations (user_id, status);
CREATE INDEX IF NOT EXISTS ecosystem_invitations_eco_idx
  ON public.ecosystem_invitations (ecosystem_id, status);

GRANT SELECT ON public.ecosystem_invitations TO authenticated;
GRANT ALL ON public.ecosystem_invitations TO service_role;

ALTER TABLE public.ecosystem_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Invitees read their own invitations"
  ON public.ecosystem_invitations FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR user_id = public.effective_uid());

CREATE POLICY "Shop managers read invitations for their shop"
  ON public.ecosystem_invitations FOR SELECT TO authenticated
  USING (public.can_review_applications(auth.uid(), ecosystem_id));

CREATE TRIGGER ecosystem_invitations_updated_at
  BEFORE UPDATE ON public.ecosystem_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Marks overdue pending invitations as expired. Never auto-accepts.
CREATE OR REPLACE FUNCTION public.expire_stale_member_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare _n integer;
begin
  update public.ecosystem_invitations
     set status = 'expired', updated_at = now()
   where status = 'pending'
     and expires_at is not null
     and expires_at < now();
  get diagnostics _n = row_count;
  return _n;
end;
$$;

-- Universe directory search, restricted to people who may manage this shop.
CREATE OR REPLACE FUNCTION public.search_universe_members(
  _ecosystem_id uuid,
  _q text,
  _limit integer DEFAULT 10
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  handle text,
  avatar_path text,
  masked_email text,
  phone text,
  already_member boolean,
  pending_invitation boolean,
  pending_application boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _term text := btrim(coalesce(_q, ''));
  _digits text := regexp_replace(coalesce(_q, ''), '[^0-9]', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not public.can_review_applications(auth.uid(), _ecosystem_id) then
    raise exception 'You are not allowed to invite members to this shop';
  end if;
  if length(_term) < 2 then
    return;
  end if;

  return query
  select p.id,
         p.full_name,
         p.handle,
         p.avatar_path,
         case when p.email = '' then null
              else left(p.email, 2) || '***' || substring(p.email from position('@' in p.email))
         end as masked_email,
         nullif(p.phone, '') as phone,
         exists (select 1 from public.ecosystem_memberships m
                  where m.user_id = p.id and m.ecosystem_id = _ecosystem_id
                    and m.membership_state = 'active') as already_member,
         exists (select 1 from public.ecosystem_invitations i
                  where i.user_id = p.id and i.ecosystem_id = _ecosystem_id
                    and i.status = 'pending') as pending_invitation,
         exists (select 1 from public.membership_applications a
                  where a.user_id = p.id and a.ecosystem_id = _ecosystem_id
                    and a.status = 'pending') as pending_application
    from public.profiles p
   where p.deleted_at is null
     and (
       (p.handle is not null
         and public.normalize_handle(p.handle) like public.normalize_handle(_term) || '%')
       or lower(p.full_name) like '%' || lower(_term) || '%'
       or lower(p.email) = lower(_term)
       or (length(_digits) >= 6 and regexp_replace(p.phone, '[^0-9]', '', 'g') like '%' || _digits || '%')
     )
   order by case when p.handle is not null
                  and public.normalize_handle(p.handle) = public.normalize_handle(_term) then 0
                 when lower(p.full_name) = lower(_term) then 1
                 else 2 end,
            p.full_name
   limit least(greatest(coalesce(_limit, 10), 1), 25);
end;
$$;

-- Sends an invitation. Creates NO membership.
CREATE OR REPLACE FUNCTION public.invite_universe_member(
  _ecosystem_id uuid,
  _user_id uuid,
  _message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _actor_name text;
  _actor_role public.app_role;
  _days integer;
  _id uuid;
begin
  perform public.assert_actor_active();
  if not public.can_review_applications(auth.uid(), _ecosystem_id) then
    raise exception 'You are not allowed to invite members to this shop';
  end if;
  if _user_id = auth.uid() then
    raise exception 'You cannot invite yourself';
  end if;
  if not exists (select 1 from public.profiles where id = _user_id and deleted_at is null) then
    raise exception 'That Universe member no longer exists';
  end if;
  if exists (select 1 from public.ecosystem_memberships m
              where m.user_id = _user_id and m.ecosystem_id = _ecosystem_id
                and m.membership_state = 'active') then
    raise exception 'That member already belongs to this shop';
  end if;

  perform public.expire_stale_member_invitations();

  if exists (select 1 from public.ecosystem_invitations i
              where i.user_id = _user_id and i.ecosystem_id = _ecosystem_id
                and i.status = 'pending') then
    raise exception 'An invitation for this member is already pending';
  end if;
  if exists (select 1 from public.membership_applications a
              where a.user_id = _user_id and a.ecosystem_id = _ecosystem_id
                and a.status = 'pending') then
    raise exception 'This member already has a pending application for this shop';
  end if;

  select coalesce(full_name, email) into _actor_name from public.profiles where id = auth.uid();
  select role into _actor_role from public.user_roles
   where user_id = auth.uid()
     and (ecosystem_id = _ecosystem_id or role = 'super_admin')
   order by case role when 'super_admin' then 0 when 'admin' then 1 when 'reseller' then 2 else 3 end
   limit 1;
  select coalesce(member_invitation_expiry_days, 14) into _days
    from public.platform_settings where id = 1;

  insert into public.ecosystem_invitations
    (ecosystem_id, user_id, invited_by, inviter_name, inviter_role, role, message, expires_at)
  values (_ecosystem_id, _user_id, auth.uid(), coalesce(_actor_name, 'Unknown'), _actor_role,
          'customer', nullif(btrim(coalesce(_message, '')), ''),
          now() + make_interval(days => greatest(coalesce(_days, 14), 1)))
  returning id into _id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor_name, 'Unknown'),
          'Invited Universe member to shop', _user_id::text,
          jsonb_build_object('invitation_id', _id, 'user_id', _user_id,
                             'actor_role', _actor_role, 'status', 'pending'));
  return _id;
end;
$$;

-- Manager cancels a pending invitation.
CREATE OR REPLACE FUNCTION public.cancel_member_invitation(_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _inv public.ecosystem_invitations%rowtype;
  _actor_name text;
begin
  select * into _inv from public.ecosystem_invitations where id = _invitation_id for update;
  if _inv.id is null then
    raise exception 'Invitation not found';
  end if;
  if not public.can_review_applications(auth.uid(), _inv.ecosystem_id) then
    raise exception 'You are not allowed to manage invitations for this shop';
  end if;
  if _inv.status <> 'pending' then
    raise exception 'This invitation is no longer pending';
  end if;

  update public.ecosystem_invitations
     set status = 'cancelled', cancelled_by = auth.uid(), responded_at = now(), updated_at = now()
   where id = _inv.id;

  select coalesce(full_name, email) into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_inv.ecosystem_id, auth.uid(), coalesce(_actor_name, 'Unknown'),
          'Cancelled shop invitation', _inv.user_id::text,
          jsonb_build_object('invitation_id', _inv.id, 'user_id', _inv.user_id, 'status', 'cancelled'));
end;
$$;

-- Manager-facing list for one shop.
CREATE OR REPLACE FUNCTION public.list_ecosystem_invitations(
  _ecosystem_id uuid,
  _status text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  full_name text,
  handle text,
  avatar_path text,
  inviter_name text,
  inviter_role public.app_role,
  status text,
  message text,
  expires_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if not public.can_review_applications(auth.uid(), _ecosystem_id) then
    raise exception 'You are not allowed to view invitations for this shop';
  end if;
  return query
  select i.id, i.user_id, p.full_name, p.handle, p.avatar_path,
         i.inviter_name, i.inviter_role, i.status, i.message,
         i.expires_at, i.responded_at, i.created_at
    from public.ecosystem_invitations i
    join public.profiles p on p.id = i.user_id
   where i.ecosystem_id = _ecosystem_id
     and (_status is null or _status = 'all' or i.status = _status)
   order by i.created_at desc
   limit 200;
end;
$$;

-- Invitee-facing list of their own pending invitations.
CREATE OR REPLACE FUNCTION public.my_shop_invitations()
RETURNS TABLE (
  id uuid,
  ecosystem_id uuid,
  ecosystem_name text,
  inviter_name text,
  inviter_role public.app_role,
  message text,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if auth.uid() is null then
    return;
  end if;
  return query
  select i.id, i.ecosystem_id, e.name, i.inviter_name, i.inviter_role,
         i.message, i.status, i.expires_at, i.created_at
    from public.ecosystem_invitations i
    join public.ecosystems e on e.id = i.ecosystem_id
   where i.user_id = auth.uid()
     and i.status = 'pending'
     and (i.expires_at is null or i.expires_at > now())
   order by i.created_at desc
   limit 50;
end;
$$;

-- The invited member accepts or declines. Only accept creates a membership.
CREATE OR REPLACE FUNCTION public.respond_to_shop_invitation(
  _invitation_id uuid,
  _accept boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _inv public.ecosystem_invitations%rowtype;
  _name text;
  _has_active boolean;
begin
  select * into _inv from public.ecosystem_invitations where id = _invitation_id for update;
  if _inv.id is null then
    raise exception 'Invitation not found';
  end if;
  if _inv.user_id <> auth.uid() then
    raise exception 'This invitation is not yours';
  end if;
  if _inv.status <> 'pending' then
    raise exception 'This invitation was already answered';
  end if;
  if _inv.expires_at is not null and _inv.expires_at < now() then
    update public.ecosystem_invitations set status = 'expired', updated_at = now() where id = _inv.id;
    raise exception 'This invitation has expired';
  end if;

  select coalesce(full_name, email) into _name from public.profiles where id = auth.uid();

  if _accept then
    insert into public.ecosystem_memberships (user_id, ecosystem_id, role, status, membership_state)
    values (_inv.user_id, _inv.ecosystem_id, 'customer', 'active', 'active')
    on conflict (user_id, ecosystem_id) do update
      set membership_state = 'active', updated_at = now();

    perform public.ensure_membership_wallets(_inv.user_id, _inv.ecosystem_id);

    select public.active_ecosystem(_inv.user_id) is not null into _has_active;
    if not _has_active then
      update public.profiles
         set ecosystem_id = _inv.ecosystem_id,
             active_ecosystem_id = _inv.ecosystem_id,
             updated_at = now()
       where id = _inv.user_id;

      insert into public.user_roles (user_id, role, ecosystem_id)
      values (_inv.user_id, 'customer', _inv.ecosystem_id)
      on conflict (user_id, role) do update set ecosystem_id = excluded.ecosystem_id;
    end if;
  end if;

  update public.ecosystem_invitations
     set status = case when _accept then 'accepted' else 'declined' end,
         responded_at = now(), updated_at = now()
   where id = _inv.id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_inv.ecosystem_id, auth.uid(), coalesce(_name, 'Unknown'),
          case when _accept then 'Accepted shop invitation' else 'Declined shop invitation' end,
          _inv.user_id::text,
          jsonb_build_object('invitation_id', _inv.id, 'invited_by', _inv.invited_by,
                             'inviter_role', _inv.inviter_role,
                             'status', case when _accept then 'accepted' else 'declined' end));
end;
$$;

GRANT EXECUTE ON FUNCTION public.search_universe_members(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_universe_member(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_member_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ecosystem_invitations(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_shop_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_shop_invitation(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_member_invitations() TO authenticated;