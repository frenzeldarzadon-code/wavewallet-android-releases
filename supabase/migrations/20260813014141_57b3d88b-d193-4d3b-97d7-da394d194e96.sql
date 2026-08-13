alter table public.profiles
  add column if not exists handle text,
  add column if not exists avatar_path text;

create unique index if not exists profiles_handle_unique
  on public.profiles (ecosystem_id, lower(handle))
  where handle is not null and deleted_at is null;

create or replace function public.normalize_handle(_handle text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(_handle,'')), '^@+', '')), '')
$$;

create or replace function public.handle_available(_handle text, _ecosystem_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare _h text := public.normalize_handle(_handle);
        _eco uuid;
begin
  if auth.uid() is null or _h is null then return false; end if;
  if _h !~ '^[a-z0-9_.]{3,20}$' then return false; end if;
  select coalesce(_ecosystem_id, p.ecosystem_id) into _eco from public.profiles p where p.id = auth.uid();
  if _eco is null then return false; end if;
  return not exists (
    select 1 from public.profiles p
     where p.ecosystem_id = _eco
       and p.deleted_at is null
       and p.id <> auth.uid()
       and lower(p.handle) = _h
  );
end;
$$;

revoke all on function public.handle_available(text, uuid) from public, anon;
grant execute on function public.handle_available(text, uuid) to authenticated, service_role;

create or replace function public.update_own_profile(
  _full_name text default null,
  _handle text default null,
  _avatar_path text default null,
  _clear_avatar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  if _h is not null and exists (
    select 1 from public.profiles p
     where p.ecosystem_id = _old.ecosystem_id
       and p.deleted_at is null
       and p.id <> _actor
       and lower(p.handle) = _h
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
$$;

revoke all on function public.update_own_profile(text, text, text, boolean) from public, anon;
grant execute on function public.update_own_profile(text, text, text, boolean) to authenticated, service_role;

drop function if exists public.search_members(text, uuid);
create or replace function public.search_members(_query text, _ecosystem_id uuid default null)
returns table(
  id uuid, full_name text, handle text, avatar_path text, email text, phone text,
  masked_email text, status text, role text, ecosystem_id uuid, ecosystem_name text,
  credit_balance numeric, points_balance integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _q text := lower(btrim(coalesce(_query, '')));
  _h text := public.normalize_handle(_query);
  _digits text := regexp_replace(coalesce(_query, ''), '[^0-9]', '', 'g');
  _super boolean;
  _admin boolean := false;
  _seller boolean := false;
  _eco uuid;
  _scope uuid := _ecosystem_id;
begin
  if _actor is null or length(_q) < 2 then return; end if;

  _super := public.is_super_admin(_actor);
  if not _super then
    select p.ecosystem_id into _eco from public.profiles p where p.id = _actor;
    if _eco is null then return; end if;
    _admin := public.is_ecosystem_admin(_actor, _eco);
    _seller := public.has_role(_actor, 'reseller') or public.has_role(_actor, 'subreseller');
    if not _admin and not _seller then return; end if;
    -- Non-super callers are always pinned to their own shop.
    if _scope is not null and _scope <> _eco then return; end if;
    _scope := _eco;
  end if;

  return query
    select
      p.id,
      p.full_name,
      p.handle,
      p.avatar_path,
      case when _super or _admin then p.email else regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2') end,
      case when _super or _admin then p.phone
           else regexp_replace(p.phone, '.(?=.{3})', '*', 'g') end,
      regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2'),
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
      case when _super or _admin then coalesce(ca.balance, 0)::numeric else 0::numeric end,
      case when _super or _admin then coalesce(pa.balance, 0)::integer else 0 end
    from public.profiles p
    join public.ecosystems e on e.id = p.ecosystem_id
    left join public.credit_accounts ca on ca.user_id = p.id
    left join public.points_accounts pa on pa.user_id = p.id
    where p.deleted_at is null
      and (_scope is null or p.ecosystem_id = _scope)
      and (_super or _admin or public.can_load_credits(_actor, p.id))
      and (
        lower(p.full_name) like '%' || _q || '%'
        or lower(p.email) like '%' || _q || '%'
        or (_h is not null and lower(coalesce(p.handle,'')) like '%' || _h || '%')
        or (_digits <> '' and regexp_replace(p.phone, '[^0-9]', '', 'g') like '%' || _digits || '%')
      )
    order by
      case when lower(p.full_name) = _q or lower(p.email) = _q
                 or lower(coalesce(p.handle,'')) = coalesce(_h,'') then 0 else 1 end,
      p.full_name
    limit 25;
end;
$$;

revoke all on function public.search_members(text, uuid) from public, anon;
grant execute on function public.search_members(text, uuid) to authenticated, service_role;

drop function if exists public.lookup_transfer_recipient(text);
create or replace function public.lookup_transfer_recipient(_query text)
returns table(id uuid, full_name text, handle text, avatar_path text, phone text, masked_email text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _eco uuid;
  _q text := lower(trim(coalesce(_query,'')));
  _h text := public.normalize_handle(_query);
  _seller boolean;
  _privileged boolean;
begin
  if length(_q) < 3 then return; end if;
  select p0.ecosystem_id into _eco from public.profiles p0 where p0.id = auth.uid();
  if _eco is null then return; end if;
  _seller := public.has_role(auth.uid(),'reseller') or public.has_role(auth.uid(),'subreseller');
  _privileged := _seller or public.is_super_admin(auth.uid())
                 or public.is_ecosystem_admin(auth.uid(), _eco);

  return query
    select p.id, p.full_name, p.handle, p.avatar_path, p.phone,
           regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2')
    from public.profiles p
    where p.ecosystem_id = _eco and p.id <> auth.uid() and p.status = 'active'
      and p.deleted_at is null
      and (
        lower(p.email) = _q
        or replace(p.phone,' ','') = replace(_q,' ','')
        or (_h is not null and lower(coalesce(p.handle,'')) = _h)
        or (_privileged and (
              lower(p.full_name) like '%' || _q || '%'
              or (_h is not null and lower(coalesce(p.handle,'')) like '%' || _h || '%')
           ))
      )
      and (
        public.is_super_admin(auth.uid())
        or public.is_ecosystem_admin(auth.uid(), _eco)
        or (_seller and public.can_load_credits(auth.uid(), p.id))
        or (not _seller
            and not public.has_role(p.id,'reseller')
            and not public.has_role(p.id,'subreseller'))
      )
    limit 10;
end;
$$;

revoke all on function public.lookup_transfer_recipient(text) from public, anon;
grant execute on function public.lookup_transfer_recipient(text) to authenticated, service_role;

create policy "Shop members view avatars"
  on storage.objects for select
  using (
    bucket_id = 'avatars'
    and (
      public.is_super_admin(auth.uid())
      or (storage.foldername(name))[1] = (public.current_ecosystem(auth.uid()))::text
    )
  );

create policy "Members upload their own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (public.current_ecosystem(auth.uid()))::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Members replace their own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Members or shop admins delete avatars"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.is_super_admin(auth.uid())
      or public.is_ecosystem_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  );