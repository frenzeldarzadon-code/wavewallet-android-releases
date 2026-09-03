alter table public.profiles
  add column if not exists cover_path text;

alter table public.ecosystems
  add column if not exists retail_storefront_theme text not null default 'clear';

alter table public.ecosystems
  drop constraint if exists ecosystems_retail_storefront_theme_valid;
alter table public.ecosystems
  add constraint ecosystems_retail_storefront_theme_valid
  check (retail_storefront_theme in ('clear', 'fresh', 'warm'));

create table public.member_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant all on public.member_presence to service_role;
alter table public.member_presence enable row level security;

create or replace function public.touch_member_presence()
returns void
language sql volatile security definer set search_path = public as $$
  insert into public.member_presence(user_id, last_seen_at, updated_at)
  values (auth.uid(), now(), now())
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
  where public.member_presence.last_seen_at < now() - interval '45 seconds'
$$;
revoke all on function public.touch_member_presence() from public, anon;
grant execute on function public.touch_member_presence() to authenticated;

create or replace function public.update_own_profile_cover(
  _cover_path text default null,
  _clear_cover boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare _actor uuid := auth.uid(); _old public.profiles%rowtype; _next text;
begin
  if _actor is null then raise exception 'You must be signed in'; end if;
  select * into _old from public.profiles where id = _actor and deleted_at is null;
  if not found then raise exception 'Profile not found'; end if;
  _next := case when _clear_cover then null else coalesce(nullif(btrim(coalesce(_cover_path,'')), ''), _old.cover_path) end;
  if _next is not null and (storage.foldername(_next))[2] <> _actor::text then
    raise exception 'Invalid cover location';
  end if;
  update public.profiles set cover_path = _next, updated_at = now() where id = _actor;
  if _next is distinct from _old.cover_path then
    insert into public.audit_logs(ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_old.ecosystem_id, _actor, _old.full_name, 'Updated own profile cover', _old.full_name,
            jsonb_build_object('user_id', _actor, 'cover_changed', true));
  end if;
end $$;
revoke all on function public.update_own_profile_cover(text, boolean) from public, anon;
grant execute on function public.update_own_profile_cover(text, boolean) to authenticated;

drop function if exists public.universe_profile(text);
create function public.universe_profile(_handle text)
returns table(user_id uuid, full_name text, handle text, avatar_path text, cover_path text, bio text,
              joined_at timestamptz, is_platform boolean)
language sql stable security definer set search_path = public as $$
  with v as (
    select p.*,
           (public.is_super_admin(p.id) and p.id <> auth.uid()
            and not public.is_super_admin(auth.uid())) as masked
      from public.profiles p
     where auth.uid() is not null and p.deleted_at is null
       and public.normalize_handle(p.handle) = public.normalize_handle(_handle)
     limit 1
  )
  select case when v.masked then null::uuid else v.id end,
         case when v.masked then 'WaveWallet Super Admin' else v.full_name end,
         case when v.masked then null else v.handle end,
         case when v.masked then null else v.avatar_path end,
         case when v.masked then null else v.cover_path end,
         case when v.masked then 'Official WaveWallet platform account.' else v.bio end,
         v.joined_at, v.masked
    from v
$$;
revoke all on function public.universe_profile(text) from public, anon;
grant execute on function public.universe_profile(text) to authenticated;

drop function if exists public.dm_thread_list();
create function public.dm_thread_list()
returns table(thread_id uuid, member_id uuid, member_name text, member_handle text, member_avatar text,
              last_message_at timestamptz, preview text, unread integer, blocked boolean,
              kind text, order_id uuid, title text, participants jsonb, member_online boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  return query
  select * from (
    select t.id as thread_id,
           other.id as member_id, coalesce(other.full_name,'Member') as member_name,
           other.handle as member_handle, other.avatar_path as member_avatar,
           t.last_message_at, t.last_message_preview as preview,
           (select count(*)::int from public.dm_messages m
             where m.thread_id = t.id and m.recipient_id = auth.uid() and m.read_at is null) as unread,
           exists (select 1 from public.social_blocks b
                    where (b.blocker_id = auth.uid() and b.blocked_id = other.id)
                       or (b.blocker_id = other.id and b.blocked_id = auth.uid())) as blocked,
           t.kind, t.order_id, t.title, '[]'::jsonb as participants,
           coalesce((select mp.last_seen_at > now() - interval '2 minutes'
                       from public.member_presence mp where mp.user_id = other.id), false) as member_online
      from public.dm_threads t
      join public.profiles other
        on other.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
     where t.kind = 'direct' and auth.uid() in (t.user_a, t.user_b)
    union all
    select t.id, null::uuid, null::text, null::text, null::text,
           t.last_message_at, t.last_message_preview,
           (select count(*)::int from public.dm_messages m
             where m.thread_id = t.id and m.sender_id <> auth.uid()
               and m.created_at > coalesce(me.last_read_at, 'epoch'::timestamptz)),
           false, t.kind, t.order_id, t.title,
           coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.full_name,'Member'),
                                                         'handle', p.handle, 'avatar', p.avatar_path, 'role', mm.member_role)
                                      order by mm.added_at)
                       from public.dm_thread_members mm join public.profiles p on p.id = mm.user_id
                      where mm.thread_id = t.id and mm.removed_at is null), '[]'::jsonb),
           false
      from public.dm_threads t
      join public.dm_thread_members me on me.thread_id = t.id and me.user_id = auth.uid() and me.removed_at is null
     where t.kind = 'order'
  ) x
  order by coalesce(x.last_message_at, now()) desc;
end $$;
revoke all on function public.dm_thread_list() from public, anon;
grant execute on function public.dm_thread_list() to authenticated;

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
  if not _prev.store_retail_enabled or not public.is_universe_shop(_ecosystem_id) then
    raise exception 'This shop has no Universe Retail store';
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

-- Keep the old signature unavailable so all writes pass the Retail + theme checks above.
drop function if exists public.update_retail_storefront(uuid,text,text,boolean,text,boolean,boolean);

drop function if exists public.shop_store_settings(uuid);
create function public.shop_store_settings(_ecosystem_id uuid)
returns table(voucher_enabled boolean, retail_enabled boolean, cash_enabled boolean, credit_enabled boolean,
              pickup_enabled boolean, delivery_enabled boolean, public_storefront boolean, contact_email text,
              cod_enabled boolean, delivery_fee numeric, delivery_pct integer, collector_pct integer,
              logo_path text, cover_path text, accepting_orders boolean, paused_note text, storefront_theme text)
language sql stable security definer set search_path = public as $$
  select e.store_voucher_enabled, e.store_retail_enabled, e.retail_cash_enabled,
         e.retail_credit_enabled, e.retail_pickup_enabled, e.retail_delivery_enabled,
         e.public_storefront_enabled,
         case when public.is_ecosystem_admin(auth.uid(), e.id) or public.is_super_admin(auth.uid()) then e.contact_email else null end,
         e.retail_cod_enabled and public.is_universe_shop(e.id), e.retail_delivery_fee,
         e.retail_delivery_split_delivery_pct, e.retail_delivery_split_collector_pct,
         e.retail_logo_path, e.retail_cover_path, e.retail_accepting_orders, e.retail_paused_note,
         e.retail_storefront_theme
    from public.ecosystems e where e.id = _ecosystem_id
$$;
grant execute on function public.shop_store_settings(uuid) to authenticated, anon;

drop function if exists public.public_shop_overview(text);
create function public.public_shop_overview(_slug text)
returns table(id uuid, name text, slug text, description text, contact_email text, contact_phone text,
              facebook_page_url text, admin_name text, member_count integer, product_count integer,
              sales_count integer, rating_avg numeric, rating_count integer, voucher_enabled boolean,
              retail_enabled boolean, storefront_public boolean, has_admin boolean, is_member boolean,
              pending_application boolean, logo_path text, cover_path text, accepting_orders boolean,
              paused_note text, storefront_theme text)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.slug, e.description, e.contact_email, e.contact_phone, e.facebook_page_url,
         (select pr.full_name from public.user_roles ur join public.profiles pr on pr.id=ur.user_id
           where ur.ecosystem_id=e.id and ur.role='admin' limit 1),
         (select count(*)::int from public.ecosystem_memberships m where m.ecosystem_id=e.id and m.membership_state='active'),
         (select count(*)::int from public.retail_products p where p.ecosystem_id=e.id and p.active and not p.archived and p.public_visible)
         + (select count(*)::int from public.voucher_products v where v.ecosystem_id=e.id and v.active and not v.archived),
         (select count(*)::int from public.voucher_sales s where s.ecosystem_id=e.id and s.refunded_at is null)
         + (select count(*)::int from public.retail_orders o where o.ecosystem_id=e.id and o.status='approved'),
         coalesce((select round(avg(r.rating)::numeric,2) from public.ecosystem_reviews r where r.ecosystem_id=e.id),0)::numeric,
         coalesce((select count(*)::int from public.ecosystem_reviews r where r.ecosystem_id=e.id),0),
         e.store_voucher_enabled, e.store_retail_enabled, e.public_storefront_enabled,
         public.ecosystem_has_admin(e.id),
         auth.uid() is not null and exists(select 1 from public.ecosystem_memberships m where m.ecosystem_id=e.id and m.user_id=auth.uid() and m.membership_state='active'),
         auth.uid() is not null and exists(select 1 from public.membership_applications a where a.ecosystem_id=e.id and a.user_id=auth.uid() and a.status='pending'),
         e.retail_logo_path, e.retail_cover_path, e.retail_accepting_orders, e.retail_paused_note,
         e.retail_storefront_theme
    from public.ecosystems e
   where e.slug=_slug and e.archived_at is null and e.public_storefront_enabled
     and public.is_universe_shop(e.id)
     and (not e.is_test or public.can_see_test_shop(e.id))
$$;
grant execute on function public.public_shop_overview(text) to authenticated, anon;

create or replace function public.universe_market_pulse(_limit integer default 8)
returns table(section text, rank integer, shop_id uuid, shop_name text, shop_slug text,
              commerce_kind text, item_id uuid, item_name text, image_path text,
              price numeric, sales_count bigint, rating_avg numeric, rating_count integer)
language sql stable security definer set search_path = public as $$
  with shops as (
    select e.id, e.name, e.slug,
           case when e.store_retail_enabled then 'retail' else 'voucher' end kind,
           coalesce((select count(*) from public.voucher_sales v where v.ecosystem_id=e.id and v.refunded_at is null),0)
           + coalesce((select count(*) from public.retail_orders o where o.ecosystem_id=e.id and o.status='approved'),0) sales,
           coalesce((select round(avg(r.rating)::numeric,2) from public.ecosystem_reviews r where r.ecosystem_id=e.id),0)::numeric rating,
           coalesce((select count(*)::int from public.ecosystem_reviews r where r.ecosystem_id=e.id),0) ratings
      from public.ecosystems e
     where e.archived_at is null and e.public_storefront_enabled and public.is_universe_shop(e.id)
       and (e.store_retail_enabled or e.store_voucher_enabled)
       and (not e.is_test or public.can_see_test_shop(e.id))
  ), shop_rank as (
    select *, row_number() over(order by sales desc, rating desc, name) r from shops
  ), products as (
    select e.id shop_id, e.name shop_name, e.slug shop_slug, 'retail'::text kind,
           p.id item_id, p.name item_name, p.image_path,
           round((p.price * (1 + public.retail_platform_fee_percent()/100.0))::numeric,2) price,
           coalesce(sum(case when o.status='approved' then oi.quantity else 0 end),0)::bigint sales
      from public.retail_products p join public.ecosystems e on e.id=p.ecosystem_id
      left join public.retail_order_items oi on oi.product_id=p.id
      left join public.retail_orders o on o.id=oi.order_id
     where p.active and not p.archived and p.public_visible and e.public_storefront_enabled
       and e.store_retail_enabled and public.is_universe_shop(e.id)
       and (not e.is_test or public.can_see_test_shop(e.id))
     group by e.id,e.name,e.slug,p.id,p.name,p.image_path,p.price
    union all
    select e.id,e.name,e.slug,'voucher',v.id,v.name,null::text as image_path,v.credit_price,
           coalesce(sum(case when s.refunded_at is null then s.quantity else 0 end),0)::bigint
      from public.voucher_products v join public.ecosystems e on e.id=v.ecosystem_id
      left join public.voucher_sales s on s.product_id=v.id
     where v.active and not v.archived and e.public_storefront_enabled and e.store_voucher_enabled
       and public.is_universe_shop(e.id) and (not e.is_test or public.can_see_test_shop(e.id))
     group by e.id,e.name,e.slug,v.id,v.name,v.credit_price
  ), product_rank as (
    select *, row_number() over(order by sales desc, item_name) r from products
  )
  select 'featured', r::int, id, name, slug, kind, null::uuid, null::text, null::text, null::numeric, sales, rating, ratings
    from shop_rank where r <= least(greatest(_limit,1),12)
  union all
  select 'top_shops', r::int, id, name, slug, kind, null::uuid, null::text, null::text, null::numeric, sales, rating, ratings
    from shop_rank where sales > 0 and r <= least(greatest(_limit,1),12)
  union all
  select 'top_products', r::int, shop_id, shop_name, shop_slug, kind, item_id, item_name, image_path, price, sales, 0::numeric, 0
    from product_rank where sales > 0 and r <= least(greatest(_limit,1),12)
  order by 1,2
$$;
revoke all on function public.universe_market_pulse(integer) from public;
grant execute on function public.universe_market_pulse(integer) to anon, authenticated;
