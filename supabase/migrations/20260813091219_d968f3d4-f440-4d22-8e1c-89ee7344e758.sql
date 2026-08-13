CREATE OR REPLACE FUNCTION public.handle_available(_handle text, _ecosystem_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _h text := public.normalize_handle(_handle);
  _me uuid := auth.uid();
  _eco uuid;
  _my_eco uuid;
  _has_profile boolean;
  _current text;
begin
  if _me is null or _h is null then return false; end if;
  if _h !~ '^[a-z0-9_.]{3,20}$' then return false; end if;

  select p.ecosystem_id, public.normalize_handle(p.handle), true
    into _my_eco, _current, _has_profile
    from public.profiles p
   where p.id = _me and p.deleted_at is null;

  if not coalesce(_has_profile, false) then return false; end if;

  -- The caller keeping their own handle is always allowed.
  if _current is not null and _current = _h then return true; end if;

  -- Platform-level members have no ecosystem; they are compared against the
  -- other platform-level members instead of being refused outright.
  _eco := coalesce(_ecosystem_id, _my_eco);

  return not exists (
    select 1 from public.profiles p
     where p.ecosystem_id is not distinct from _eco
       and p.deleted_at is null
       and p.id <> _me
       and public.normalize_handle(p.handle) = _h
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_own_profile(_full_name text DEFAULT NULL::text, _handle text DEFAULT NULL::text, _avatar_path text DEFAULT NULL::text, _clear_avatar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _actor uuid := auth.uid();
  _old public.profiles%rowtype;
  _name text;
  _h text;
  _avatar text;
  _changes jsonb := '{}'::jsonb;
begin
  if _actor is null then raise exception 'You must be signed in'; end if;

  select * into _old from public.profiles where id = _actor and deleted_at is null;
  if not found then raise exception 'Profile not found'; end if;

  _name := nullif(btrim(coalesce(_full_name, _old.full_name)), '');
  if _name is null then raise exception 'A display name is required'; end if;
  if length(_name) > 60 then raise exception 'That display name is too long'; end if;

  if _handle is null then
    _h := public.normalize_handle(_old.handle);
  else
    _h := public.normalize_handle(_handle);
    if _h is not null and _h !~ '^[a-z0-9_.]{3,20}$' then
      raise exception 'Handles use 3-20 letters, numbers, dots or underscores';
    end if;
  end if;

  if _h is not null and _h is distinct from public.normalize_handle(_old.handle) and exists (
    select 1 from public.profiles p
     where p.ecosystem_id is not distinct from _old.ecosystem_id
       and p.deleted_at is null
       and p.id <> _actor
       and public.normalize_handle(p.handle) = _h
  ) then
    raise exception 'That handle is already taken in this shop';
  end if;

  if _clear_avatar then
    _avatar := null;
  else
    _avatar := coalesce(nullif(btrim(coalesce(_avatar_path,'')), ''), _old.avatar_path);
  end if;

  if _avatar is not null and _old.ecosystem_id is not null
     and split_part(_avatar, '/', 1) <> _old.ecosystem_id::text then
    raise exception 'Invalid avatar location';
  end if;

  if _name is distinct from _old.full_name then
    _changes := _changes || jsonb_build_object('full_name', jsonb_build_object('from', _old.full_name, 'to', _name));
  end if;
  if _h is distinct from public.normalize_handle(_old.handle) then
    _changes := _changes || jsonb_build_object('handle', jsonb_build_object('from', _old.handle, 'to', _h));
  end if;
  if _avatar is distinct from _old.avatar_path then
    _changes := _changes || jsonb_build_object('avatar', jsonb_build_object('changed', true));
  end if;

  if _changes = '{}'::jsonb then
    return jsonb_build_object('changed', false, 'handle', _old.handle, 'avatar_path', _old.avatar_path);
  end if;

  update public.profiles
     set full_name = _name, handle = _h, avatar_path = _avatar, updated_at = now()
   where id = _actor;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_old.ecosystem_id, _actor, _name, 'Updated own profile', _name,
          _changes || jsonb_build_object('user_id', _actor));

  return jsonb_build_object('changed', true, 'handle', _h, 'avatar_path', _avatar);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.handle_available(text, uuid) TO authenticated;