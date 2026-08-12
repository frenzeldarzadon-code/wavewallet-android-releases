-- Faster partial-match search on member identity fields
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS profiles_full_name_trgm ON public.profiles USING gin (lower(full_name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_email_trgm ON public.profiles USING gin (lower(email) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_phone_trgm ON public.profiles USING gin (phone extensions.gin_trgm_ops);

-- Can this actor edit that member's identity fields? --------------------------
CREATE OR REPLACE FUNCTION public.can_manage_member_profile(_actor uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select case
    when _actor is null or _target is null then false
    when public.is_super_admin(_actor) then true
    else exists (
      select 1
      from public.profiles p
      where p.id = _target
        and p.deleted_at is null
        and p.ecosystem_id is not null
        and public.is_ecosystem_admin(_actor, p.ecosystem_id)
        and not public.has_role(_target, 'super_admin')
    )
  end
$$;

REVOKE ALL ON FUNCTION public.can_manage_member_profile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_member_profile(uuid, uuid) TO authenticated, service_role;

-- Is this email already used by another live profile? -------------------------
CREATE OR REPLACE FUNCTION public.member_email_taken(_email text, _exclude uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select exists (
    select 1 from public.profiles p
    where lower(p.email) = lower(btrim(coalesce(_email, '')))
      and p.deleted_at is null
      and (_exclude is null or p.id <> _exclude)
  )
$$;

REVOKE ALL ON FUNCTION public.member_email_taken(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_email_taken(text, uuid) TO authenticated, service_role;

-- Admin / Super Admin member search -------------------------------------------
CREATE OR REPLACE FUNCTION public.search_members(_query text, _ecosystem_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  full_name text,
  email text,
  phone text,
  status text,
  role text,
  ecosystem_id uuid,
  ecosystem_name text,
  credit_balance numeric,
  points_balance integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _actor uuid := auth.uid();
  _q text := lower(btrim(coalesce(_query, '')));
  _digits text := regexp_replace(coalesce(_query, ''), '[^0-9]', '', 'g');
  _super boolean;
  _eco uuid;
  _scope uuid := _ecosystem_id;
begin
  if _actor is null or length(_q) < 2 then return; end if;

  _super := public.is_super_admin(_actor);
  if not _super then
    select p.ecosystem_id into _eco from public.profiles p where p.id = _actor;
    if _eco is null or not public.is_ecosystem_admin(_actor, _eco) then return; end if;
    -- Admins are always pinned to their own shop, whatever the client asks for.
    if _scope is not null and _scope <> _eco then return; end if;
    _scope := _eco;
  end if;

  return query
    select
      p.id,
      p.full_name,
      p.email,
      p.phone,
      p.status::text,
      coalesce((
        select ur.role::text from public.user_roles ur
        where ur.user_id = p.id
        order by case ur.role
          when 'super_admin' then 1 when 'admin' then 2
          when 'reseller' then 3 when 'subreseller' then 4 else 5 end
        limit 1
      ), 'customer'),
      p.ecosystem_id,
      e.name,
      coalesce(ca.balance, 0)::numeric,
      coalesce(pa.balance, 0)::integer
    from public.profiles p
    join public.ecosystems e on e.id = p.ecosystem_id
    left join public.credit_accounts ca on ca.user_id = p.id
    left join public.points_accounts pa on pa.user_id = p.id
    where p.deleted_at is null
      and (_scope is null or p.ecosystem_id = _scope)
      and (
        lower(p.full_name) like '%' || _q || '%'
        or lower(p.email) like '%' || _q || '%'
        or (_digits <> '' and regexp_replace(p.phone, '[^0-9]', '', 'g') like '%' || _digits || '%')
      )
    order by
      case when lower(p.full_name) = _q or lower(p.email) = _q then 0 else 1 end,
      p.full_name
    limit 25;
end;
$$;

REVOKE ALL ON FUNCTION public.search_members(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_members(text, uuid) TO authenticated, service_role;

-- Admin / Super Admin identity edit -------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_member_profile(
  _user_id uuid,
  _full_name text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _actor uuid := auth.uid();
  _old public.profiles%rowtype;
  _name text;
  _tel text;
  _mail text;
  _actor_name text;
  _changes jsonb := '{}'::jsonb;
begin
  if _actor is null then
    raise exception 'You must be signed in';
  end if;

  select * into _old from public.profiles where id = _user_id and deleted_at is null;
  if not found then
    raise exception 'Member not found';
  end if;

  if not public.can_manage_member_profile(_actor, _user_id) then
    raise exception 'You are not allowed to edit this member';
  end if;

  _name := nullif(btrim(coalesce(_full_name, _old.full_name)), '');
  if _name is null then raise exception 'A full name is required'; end if;

  _tel := nullif(btrim(coalesce(_phone, _old.phone)), '');
  if _tel is null then raise exception 'A phone number is required'; end if;

  _mail := lower(btrim(coalesce(_email, _old.email)));
  if _mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if public.member_email_taken(_mail, _user_id) then
    raise exception 'That email address is already used by another account';
  end if;

  if _name is distinct from _old.full_name then
    _changes := _changes || jsonb_build_object('full_name', jsonb_build_object('from', _old.full_name, 'to', _name));
  end if;
  if _tel is distinct from _old.phone then
    _changes := _changes || jsonb_build_object('phone', jsonb_build_object('from', _old.phone, 'to', _tel));
  end if;
  if _mail is distinct from lower(_old.email) then
    _changes := _changes || jsonb_build_object('email', jsonb_build_object('from', _old.email, 'to', _mail));
  end if;

  if _changes = '{}'::jsonb then
    return jsonb_build_object('changed', false, 'changes', _changes);
  end if;

  update public.profiles
     set full_name = _name, phone = _tel, email = _mail, updated_at = now()
   where id = _user_id;

  select p.full_name into _actor_name from public.profiles p where p.id = _actor;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (
    _old.ecosystem_id,
    _actor,
    coalesce(_actor_name, 'Platform owner'),
    'Updated member profile',
    _name,
    _changes || jsonb_build_object('user_id', _user_id)
  );

  return jsonb_build_object('changed', true, 'changes', _changes);
end;
$$;

REVOKE ALL ON FUNCTION public.admin_update_member_profile(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_member_profile(uuid, text, text, text) TO authenticated, service_role;