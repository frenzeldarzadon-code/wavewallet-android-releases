-- 1) Address on profiles (Barangay level required at signup; street/house optional)
alter table public.profiles
  add column if not exists province text,
  add column if not exists city_municipality text,
  add column if not exists barangay text,
  add column if not exists street text,
  add column if not exists house_number text;

create index if not exists profiles_province_idx on public.profiles (lower(province));
create index if not exists profiles_city_idx on public.profiles (lower(city_municipality));
create index if not exists profiles_barangay_idx on public.profiles (lower(barangay));

-- 2) Signup captures address metadata (existing accounts untouched)
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  insert into public.profiles (id, ecosystem_id, full_name, email, phone, is_demo,
                               province, city_municipality, barangay, street, house_number)
  values (
    new.id,
    case when _self or _global then null else _eco end,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    _demo,
    nullif(btrim(coalesce(new.raw_user_meta_data->>'province','')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'city_municipality','')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'barangay','')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'street','')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'house_number','')), '')
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

-- 3) Self-service address editing (owner-only, same audited path)
drop function if exists public.update_own_profile(text, text, text, boolean, text, jsonb);

create or replace function public.update_own_profile(
  _full_name text default null,
  _handle text default null,
  _avatar_path text default null,
  _clear_avatar boolean default false,
  _bio text default null,
  _preferences jsonb default null,
  _province text default null,
  _city_municipality text default null,
  _barangay text default null,
  _street text default null,
  _house_number text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _actor uuid := auth.uid();
  _old public.profiles%rowtype;
  _name text; _h text; _avatar text; _b text; _prefs jsonb; _changes jsonb := '{}'::jsonb;
  _prov text; _city text; _brgy text; _st text; _house text;
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
  if _h is null then
    _h := coalesce(public.normalize_handle(_old.handle),
                   public.unique_handle(public.handle_candidate(_name, _old.email), _actor));
  end if;

  if _h is distinct from public.normalize_handle(_old.handle) and exists (
    select 1 from public.profiles p
     where p.deleted_at is null and p.id <> _actor
       and public.normalize_handle(p.handle) = _h
  ) then
    raise exception 'That handle is already taken';
  end if;

  if _clear_avatar then _avatar := null;
  else _avatar := coalesce(nullif(btrim(coalesce(_avatar_path,'')), ''), _old.avatar_path); end if;
  if _avatar is not null and _old.ecosystem_id is not null
     and split_part(_avatar, '/', 1) <> _old.ecosystem_id::text then
    raise exception 'Invalid avatar location';
  end if;

  if _bio is null then _b := _old.bio;
  else
    _b := nullif(btrim(_bio), '');
    if _b is not null and length(_b) > 280 then raise exception 'That bio is too long (280 characters maximum)'; end if;
  end if;

  if _preferences is null then _prefs := coalesce(_old.preferences, '{}'::jsonb);
  else
    if jsonb_typeof(_preferences) <> 'object' then raise exception 'Preferences must be an object'; end if;
    if length(_preferences::text) > 4000 then raise exception 'Preferences payload is too large'; end if;
    _prefs := coalesce(_old.preferences, '{}'::jsonb) || _preferences;
  end if;

  -- Address: only overwritten when supplied. Street and house number stay optional.
  _prov  := coalesce(nullif(btrim(coalesce(_province,'')), ''), _old.province);
  _city  := coalesce(nullif(btrim(coalesce(_city_municipality,'')), ''), _old.city_municipality);
  _brgy  := coalesce(nullif(btrim(coalesce(_barangay,'')), ''), _old.barangay);
  _st    := case when _street is null then _old.street else nullif(btrim(_street), '') end;
  _house := case when _house_number is null then _old.house_number else nullif(btrim(_house_number), '') end;
  if length(coalesce(_prov,'')) > 80 or length(coalesce(_city,'')) > 80
     or length(coalesce(_brgy,'')) > 80 or length(coalesce(_st,'')) > 120
     or length(coalesce(_house,'')) > 40 then
    raise exception 'That address is too long';
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
  if _prov is distinct from _old.province or _city is distinct from _old.city_municipality
     or _brgy is distinct from _old.barangay or _st is distinct from _old.street
     or _house is distinct from _old.house_number then
    _changes := _changes || jsonb_build_object('address', jsonb_build_object('changed', true));
  end if;

  if _changes = '{}'::jsonb then
    return jsonb_build_object('changed', false, 'handle', _old.handle, 'avatar_path', _old.avatar_path);
  end if;

  update public.profiles
     set full_name = _name, handle = _h, avatar_path = _avatar, bio = _b,
         preferences = _prefs,
         province = _prov, city_municipality = _city, barangay = _brgy,
         street = _st, house_number = _house,
         updated_at = now()
   where id = _actor;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_old.ecosystem_id, _actor, _name, 'Updated own profile', _name,
          _changes || jsonb_build_object('user_id', _actor));

  return jsonb_build_object('changed', true, 'handle', _h, 'avatar_path', _avatar);
end $function$;

revoke all on function public.update_own_profile(text, text, text, boolean, text, jsonb, text, text, text, text, text) from public, anon;
grant execute on function public.update_own_profile(text, text, text, boolean, text, jsonb, text, text, text, text, text) to authenticated;

-- 4) Universe-wide member directory. No balances, no contacts, no roles,
--    no street/house number — name, @handle, photo and area only.
create or replace function public.universe_directory(
  _query text default null,
  _province text default null,
  _city_municipality text default null,
  _barangay text default null,
  _limit integer default 30
)
 returns table(id uuid, full_name text, handle text, avatar_path text,
               province text, city_municipality text, barangay text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select p.id, p.full_name, p.handle, p.avatar_path,
         p.province, p.city_municipality, p.barangay
    from public.profiles p
   where auth.uid() is not null
     and p.deleted_at is null
     and p.id <> auth.uid()
     and coalesce(p.is_demo, false) = false
     and (not public.is_super_admin(p.id) or public.is_super_admin(auth.uid()))
     and (nullif(btrim(coalesce(_query,'')),'') is null
          or lower(p.full_name) like '%' || lower(btrim(_query)) || '%'
          or lower(coalesce(p.handle,'')) like '%' || coalesce(public.normalize_handle(_query),'') || '%')
     and (nullif(btrim(coalesce(_province,'')),'') is null
          or lower(coalesce(p.province,'')) = lower(btrim(_province)))
     and (nullif(btrim(coalesce(_city_municipality,'')),'') is null
          or lower(coalesce(p.city_municipality,'')) like '%' || lower(btrim(_city_municipality)) || '%')
     and (nullif(btrim(coalesce(_barangay,'')),'') is null
          or lower(coalesce(p.barangay,'')) like '%' || lower(btrim(_barangay)) || '%')
   order by p.full_name
   limit least(greatest(coalesce(_limit, 30), 1), 50)
$function$;

revoke all on function public.universe_directory(text, text, text, text, integer) from public, anon;
grant execute on function public.universe_directory(text, text, text, text, integer) to authenticated;

-- 5) Feed: a post shared with specific shops reaches every shop the viewer
--    belongs to, and a member with no shop still sees the general Universe.
create or replace function public.social_feed(_limit integer default 30, _before timestamp with time zone default null)
 returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, image_path text, promoted boolean, promotion_tier_name text, promotion_expires_at timestamp with time zone, like_count integer, comment_count integer, liked_by_me boolean, created_at timestamp with time zone, can_delete boolean, audience text, origin_ecosystem_name text, author_role text, can_hide boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare _eco uuid; _mod boolean; _vs boolean; _ecos uuid[];
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select pr.ecosystem_id into _eco from public.profiles pr
   where pr.id = auth.uid() and pr.deleted_at is null;

  select coalesce(array_agg(distinct m.ecosystem_id), '{}')
    into _ecos
    from public.ecosystem_memberships m
   where m.user_id = auth.uid() and m.membership_state = 'active';
  if _eco is not null and not (_eco = any(_ecos)) then
    _ecos := _ecos || _eco;
  end if;

  _mod := _eco is not null and public.social_can_moderate(auth.uid(), _eco);
  _vs := public.is_super_admin(auth.uid());
  return query
  select p.id,
         case when public.is_super_admin(p.author_id) and not _vs then null::uuid else p.author_id end,
         case when public.is_super_admin(p.author_id) and not _vs then 'WaveWallet Super Admin' else coalesce(a.full_name,'Member') end,
         case when public.is_super_admin(p.author_id) and not _vs then null else a.handle end,
         case when public.is_super_admin(p.author_id) and not _vs then null else a.avatar_path end,
         p.body, p.image_path,
         (p.promoted and p.promotion_refunded_at is null
          and (p.promotion_expires_at is null or p.promotion_expires_at > now())),
         p.promotion_tier_name, p.promotion_expires_at,
         (select count(*)::integer from public.social_likes l where l.post_id = p.id),
         (select count(*)::integer from public.social_comments c
           where c.post_id = p.id and c.status = 'active'),
         exists (select 1 from public.social_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         (p.author_id = auth.uid() or public.is_super_admin(auth.uid())),
         p.audience,
         case when p.audience <> 'ecosystem' then eo.name end,
         case
           when public.is_super_admin(p.author_id) then case when _vs then 'super_admin' else null end
           when public.can_view_role(auth.uid(), p.author_id)
             then coalesce(public.membership_role(p.author_id, p.ecosystem_id)::text, 'customer')
           else null
         end,
         (_mod and p.author_id <> auth.uid())
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
    join public.ecosystems eo on eo.id = p.ecosystem_id
   where p.status = 'active'
     and ((p.audience = 'ecosystem' and p.ecosystem_id = any(_ecos))
          or p.audience = 'general'
          or (p.audience = 'shops' and exists (
                select 1 from public.social_post_distributions d
                 where d.post_id = p.id and d.ecosystem_id = any(_ecos) and d.status = 'approved'))
          or p.author_id = auth.uid())
     and not exists (select 1 from public.social_post_shop_hides h
                      where h.post_id = p.id and h.ecosystem_id = any(_ecos))
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
                         or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
     and (_before is null or p.created_at < _before)
   order by case when p.promoted and p.promotion_refunded_at is null
                  and (p.promotion_expires_at is null or p.promotion_expires_at > now())
                 then p.promotion_priority else -1 end desc,
            p.created_at desc
   limit least(coalesce(_limit,30), 50);
end $function$;

-- 6) Profile post history used the wrong status value, so it always came back empty.
create or replace function public.universe_profile_posts(_handle text, _limit integer default 30)
 returns table(id uuid, body text, image_path text, created_at timestamp with time zone, like_count integer, comment_count integer, audience text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select sp.id, sp.body, sp.image_path, sp.created_at,
         sp.like_count, sp.comment_count, sp.audience
    from public.social_posts sp
    join public.profiles p on p.id = sp.author_id
   where auth.uid() is not null
     and p.deleted_at is null
     and public.normalize_handle(p.handle) = public.normalize_handle(_handle)
     and sp.status = 'active'
     and sp.audience = 'general'
     and (not public.is_super_admin(p.id)
          or p.id = auth.uid()
          or public.is_super_admin(auth.uid()))
   order by sp.created_at desc
   limit least(coalesce(_limit, 30), 100)
$function$;