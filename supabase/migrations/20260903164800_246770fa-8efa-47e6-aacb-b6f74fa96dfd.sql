drop function if exists public.update_shop_branding(uuid,text,text,boolean,boolean);

create or replace function public.update_retail_storefront(
  _ecosystem_id uuid,
  _logo_path text default null,
  _cover_path text default null,
  _accepting_orders boolean default null,
  _paused_note text default null,
  _clear_logo boolean default false,
  _clear_cover boolean default false,
  _theme text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare _actor text; _prev public.ecosystems; _prefix text; _next_theme text;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Only the shop admin can edit the storefront';
  end if;
  select * into _prev from public.ecosystems where id = _ecosystem_id and archived_at is null;
  if _prev.id is null then raise exception 'Shop not found'; end if;
  if not public.is_universe_shop(_ecosystem_id) then
    raise exception 'This shop has no Universe storefront';
  end if;
  _prefix := _ecosystem_id::text || '/storefront/';
  if _logo_path is not null and position(_prefix in _logo_path) <> 1 then raise exception 'Logo must be uploaded to this shop''s own storefront folder'; end if;
  if _cover_path is not null and position(_prefix in _cover_path) <> 1 then raise exception 'Cover must be uploaded to this shop''s own storefront folder'; end if;
  _next_theme := coalesce(_theme, _prev.retail_storefront_theme);
  if _next_theme not in ('clear','fresh','warm') then raise exception 'Choose a valid storefront theme'; end if;
  update public.ecosystems
     set retail_logo_path = case when _clear_logo then null else coalesce(_logo_path, retail_logo_path) end,
         retail_cover_path = case when _clear_cover then null else coalesce(_cover_path, retail_cover_path) end,
         retail_accepting_orders = coalesce(_accepting_orders, retail_accepting_orders),
         retail_paused_note = case when _paused_note is null then retail_paused_note else nullif(left(trim(_paused_note),160),'') end,
         retail_storefront_theme = _next_theme
   where id = _ecosystem_id;
  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs(ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Updated retail storefront', _prev.name,
          jsonb_build_object('accepting_before', _prev.retail_accepting_orders,
                             'accepting_after', coalesce(_accepting_orders,_prev.retail_accepting_orders),
                             'logo_changed', _logo_path is not null or _clear_logo,
                             'cover_changed', _cover_path is not null or _clear_cover,
                             'theme_before', _prev.retail_storefront_theme,
                             'theme_after', _next_theme));
end $$;
revoke all on function public.update_retail_storefront(uuid,text,text,boolean,text,boolean,boolean,text) from public, anon;
grant execute on function public.update_retail_storefront(uuid,text,text,boolean,text,boolean,boolean,text) to authenticated;