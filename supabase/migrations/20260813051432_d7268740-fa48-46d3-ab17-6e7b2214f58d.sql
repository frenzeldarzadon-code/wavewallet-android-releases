create or replace function public.update_own_contact(_phone text, _email text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare _actor uuid := auth.uid(); _old public.profiles%rowtype;
        _p text; _e text; _changes jsonb := '{}'::jsonb;
begin
  if _actor is null then raise exception 'You must be signed in'; end if;
  select * into _old from public.profiles where id = _actor and deleted_at is null;
  if not found then raise exception 'Profile not found'; end if;

  _p := nullif(btrim(coalesce(_phone, _old.phone)), '');
  if _p is null then raise exception 'A phone number is required'; end if;
  if length(_p) > 40 then raise exception 'That phone number is too long'; end if;

  _e := lower(btrim(coalesce(_email, _old.email)));
  if _e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if _e is distinct from lower(_old.email)
     and public.member_email_taken(_e, _actor) then
    raise exception 'That email address is already used by another account';
  end if;

  if _p is distinct from _old.phone then
    _changes := _changes || jsonb_build_object('phone', jsonb_build_object('from', _old.phone, 'to', _p));
  end if;
  if _e is distinct from lower(_old.email) then
    _changes := _changes || jsonb_build_object('email', jsonb_build_object('from', _old.email, 'to', _e));
  end if;
  if _changes = '{}'::jsonb then
    return jsonb_build_object('changed', false, 'phone', _old.phone, 'email', _old.email);
  end if;

  update public.profiles set phone = _p, email = _e, updated_at = now() where id = _actor;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_old.ecosystem_id, _actor, _old.full_name, 'Updated own contact details', _old.full_name,
          _changes || jsonb_build_object('user_id', _actor));

  return jsonb_build_object('changed', true, 'phone', _p, 'email', _e);
end; $$;