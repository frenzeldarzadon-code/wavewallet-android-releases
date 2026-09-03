create or replace function public.update_shop_branding(
  _ecosystem_id uuid,
  _logo_path text default null,
  _cover_path text default null,
  _clear_logo boolean default false,
  _clear_cover boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  _actor_name text;
  _previous public.ecosystems;
  _prefix text;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Only the shop admin can edit shop images';
  end if;

  select * into _previous
    from public.ecosystems
   where id = _ecosystem_id
     and archived_at is null;
  if _previous.id is null then raise exception 'Shop not found'; end if;
  if not public.is_universe_shop(_ecosystem_id) then
    raise exception 'Shop images are available only to Universe shops';
  end if;

  _prefix := _ecosystem_id::text || '/storefront/';
  if _logo_path is not null and position(_prefix in _logo_path) <> 1 then
    raise exception 'Logo must be uploaded to this shop''s own storefront folder';
  end if;
  if _cover_path is not null and position(_prefix in _cover_path) <> 1 then
    raise exception 'Cover must be uploaded to this shop''s own storefront folder';
  end if;

  update public.ecosystems
     set retail_logo_path = case when _clear_logo then null else coalesce(_logo_path, retail_logo_path) end,
         retail_cover_path = case when _clear_cover then null else coalesce(_cover_path, retail_cover_path) end
   where id = _ecosystem_id;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs(ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (
    _ecosystem_id,
    auth.uid(),
    coalesce(_actor_name, 'Admin'),
    'Updated shop branding',
    _previous.name,
    jsonb_build_object(
      'logo_changed', _logo_path is not null or _clear_logo,
      'cover_changed', _cover_path is not null or _clear_cover
    )
  );
end $$;

revoke all on function public.update_shop_branding(uuid,text,text,boolean,boolean) from public, anon;
grant execute on function public.update_shop_branding(uuid,text,text,boolean,boolean) to authenticated;