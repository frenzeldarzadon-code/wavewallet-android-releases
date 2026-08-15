-- Any approved shop member can see and cancel the invitations THEY sent.

CREATE OR REPLACE FUNCTION public.my_sent_shop_invitations(_ecosystem_id uuid)
RETURNS TABLE(id uuid, user_id uuid, full_name text, handle text, avatar_path text,
              inviter_name text, inviter_role app_role, status text, message text,
              expires_at timestamptz, responded_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    return;
  end if;
  if not public.can_invite_members(auth.uid(), _ecosystem_id) then
    raise exception 'You are not a member of this shop';
  end if;
  return query
  select i.id, i.user_id, p.full_name, p.handle, p.avatar_path,
         i.inviter_name, i.inviter_role, i.status, i.message,
         i.expires_at, i.responded_at, i.created_at
    from public.ecosystem_invitations i
    join public.profiles p on p.id = i.user_id
   where i.ecosystem_id = _ecosystem_id
     and i.invited_by = auth.uid()
   order by i.created_at desc
   limit 100;
end;
$function$;

-- Cancelling: reviewers may cancel any invitation of their shop; ordinary
-- members may cancel only the pending invitations they sent themselves.
CREATE OR REPLACE FUNCTION public.cancel_member_invitation(_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _inv public.ecosystem_invitations%rowtype;
  _actor_name text;
begin
  select * into _inv from public.ecosystem_invitations where id = _invitation_id for update;
  if _inv.id is null then
    raise exception 'Invitation not found';
  end if;
  if not (public.can_review_applications(auth.uid(), _inv.ecosystem_id)
          or (_inv.invited_by = auth.uid()
              and public.can_invite_members(auth.uid(), _inv.ecosystem_id))) then
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
$function$;

-- Invitation notification should land on the member's inbox page.
CREATE OR REPLACE FUNCTION public.invite_universe_member(_ecosystem_id uuid, _user_id uuid, _message text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _actor_name text;
  _actor_role public.app_role;
  _days integer;
  _id uuid;
begin
  perform public.assert_actor_active();
  if not public.can_invite_members(auth.uid(), _ecosystem_id) then
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
  values (_ecosystem_id, _user_id, auth.uid(), coalesce(_actor_name, 'Unknown'),
          coalesce(_actor_role, public.membership_role(auth.uid(), _ecosystem_id)),
          'customer', nullif(btrim(coalesce(_message, '')), ''),
          now() + make_interval(days => greatest(coalesce(_days, 14), 1)))
  returning id into _id;

  perform public.notify_member(_user_id, _ecosystem_id, 'shop_invitation',
    'You were invited to a shop',
    coalesce(_actor_name, 'A member') || ' invited you to join ' ||
      (select name from public.ecosystems where id = _ecosystem_id), '/app/applications');

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor_name, 'Unknown'),
          'Invited Universe member to shop', _user_id::text,
          jsonb_build_object('invitation_id', _id, 'user_id', _user_id,
                             'actor_role', _actor_role, 'status', 'pending'));
  return _id;
end;
$function$;

REVOKE ALL ON FUNCTION public.my_sent_shop_invitations(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_sent_shop_invitations(uuid) TO authenticated;