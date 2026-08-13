ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.update_own_profile(
  _full_name text DEFAULT NULL::text,
  _handle text DEFAULT NULL::text,
  _avatar_path text DEFAULT NULL::text,
  _clear_avatar boolean DEFAULT false,
  _bio text DEFAULT NULL::text,
  _preferences jsonb DEFAULT NULL::jsonb
)
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
  _b text;
  _prefs jsonb;
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

  if _bio is null then
    _b := _old.bio;
  else
    _b := nullif(btrim(_bio), '');
    if _b is not null and length(_b) > 280 then
      raise exception 'That bio is too long (280 characters maximum)';
    end if;
  end if;

  if _preferences is null then
    _prefs := coalesce(_old.preferences, '{}'::jsonb);
  else
    if jsonb_typeof(_preferences) <> 'object' then
      raise exception 'Preferences must be an object';
    end if;
    if length(_preferences::text) > 4000 then
      raise exception 'Preferences payload is too large';
    end if;
    _prefs := coalesce(_old.preferences, '{}'::jsonb) || _preferences;
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
  if _b is distinct from _old.bio then
    _changes := _changes || jsonb_build_object('bio', jsonb_build_object('changed', true));
  end if;
  if _prefs is distinct from coalesce(_old.preferences, '{}'::jsonb) then
    _changes := _changes || jsonb_build_object('preferences', jsonb_build_object('changed', true));
  end if;

  if _changes = '{}'::jsonb then
    return jsonb_build_object('changed', false, 'handle', _old.handle, 'avatar_path', _old.avatar_path);
  end if;

  update public.profiles
     set full_name = _name,
         handle = _h,
         avatar_path = _avatar,
         bio = _b,
         preferences = _prefs,
         updated_at = now()
   where id = _actor;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_old.ecosystem_id, _actor, _name, 'Updated own profile', _name,
          _changes || jsonb_build_object('user_id', _actor));

  return jsonb_build_object('changed', true, 'handle', _h, 'avatar_path', _avatar);
end;
$function$;

REVOKE ALL ON FUNCTION public.update_own_profile(text, text, text, boolean, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, text, boolean, text, jsonb) TO authenticated;