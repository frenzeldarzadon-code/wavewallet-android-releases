-- 1. Allow a single linked shop/product in post extras (shape only; visibility is checked on insert).
CREATE OR REPLACE FUNCTION public.social_clean_post_meta(_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare _out jsonb := '{}'::jsonb; _loc jsonb; _f jsonb; _l jsonb; _lat numeric; _lng numeric; _label text;
        _uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if _meta is null or jsonb_typeof(_meta) <> 'object' then return '{}'::jsonb; end if;

  _loc := _meta -> 'location';
  if _loc is not null and jsonb_typeof(_loc) = 'object' then
    _label := left(btrim(coalesce(_loc ->> 'label','')), 80);
    if length(_label) >= 2 then
      _lat := null; _lng := null;
      if jsonb_typeof(_loc -> 'lat') = 'number' and jsonb_typeof(_loc -> 'lng') = 'number' then
        _lat := round((_loc ->> 'lat')::numeric, 2);
        _lng := round((_loc ->> 'lng')::numeric, 2);
        if _lat < -90 or _lat > 90 or _lng < -180 or _lng > 180 then _lat := null; _lng := null; end if;
      end if;
      _out := _out || jsonb_strip_nulls(jsonb_build_object('location',
                jsonb_build_object('label', _label, 'lat', _lat, 'lng', _lng)));
    end if;
  end if;

  _f := _meta -> 'feeling';
  if _f is not null and jsonb_typeof(_f) = 'object'
     and length(btrim(coalesce(_f ->> 'label',''))) between 1 and 40 then
    _out := _out || jsonb_build_object('feeling', jsonb_build_object(
      'kind', case when _f ->> 'kind' = 'activity' then 'activity' else 'feeling' end,
      'label', left(btrim(_f ->> 'label'), 40),
      'emoji', left(coalesce(_f ->> 'emoji',''), 8)));
  end if;

  if jsonb_typeof(_meta -> 'style') = 'string' and (_meta ->> 'style') ~ '^[a-z0-9_-]{1,32}$' then
    _out := _out || jsonb_build_object('style', _meta ->> 'style');
  end if;

  if jsonb_typeof(_meta -> 'dm_invite') = 'boolean' and (_meta ->> 'dm_invite')::boolean then
    _out := _out || jsonb_build_object('dm_invite', true);
  end if;

  _l := _meta -> 'link';
  if _l is not null and jsonb_typeof(_l) = 'object'
     and coalesce(_l ->> 'shop_id','') ~ _uuid_re then
    if _l ->> 'kind' = 'shop' then
      _out := _out || jsonb_build_object('link', jsonb_build_object(
        'kind', 'shop', 'shop_id', lower(_l ->> 'shop_id')));
    elsif _l ->> 'kind' = 'product'
      and coalesce(_l ->> 'product_id','') ~ _uuid_re
      and (_l ->> 'product_kind') in ('retail','voucher') then
      _out := _out || jsonb_build_object('link', jsonb_build_object(
        'kind', 'product', 'shop_id', lower(_l ->> 'shop_id'),
        'product_id', lower(_l ->> 'product_id'), 'product_kind', _l ->> 'product_kind'));
    end if;
  end if;
  return _out;
end $function$;

-- 2. Same public-visibility rule the Universe marketplace already applies.
CREATE OR REPLACE FUNCTION public.social_link_visible(_link jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with shop as (
    select e.id, e.store_retail_enabled, e.store_voucher_enabled
      from public.ecosystems e
     where e.id = (_link ->> 'shop_id')::uuid
       and e.archived_at is null and e.public_storefront_enabled
       and public.is_universe_shop(e.id)
       and (e.store_retail_enabled or e.store_voucher_enabled)
       and (not e.is_test or public.can_see_test_shop(e.id))
  )
  select case
    when _link ->> 'kind' = 'shop' then exists (select 1 from shop)
    when _link ->> 'kind' = 'product' and _link ->> 'product_kind' = 'retail' then exists (
      select 1 from public.retail_products p join shop s on s.id = p.ecosystem_id
       where p.id = (_link ->> 'product_id')::uuid and s.store_retail_enabled
         and p.active and p.published and not p.archived and p.public_visible)
    when _link ->> 'kind' = 'product' and _link ->> 'product_kind' = 'voucher' then exists (
      select 1 from public.voucher_products v join shop s on s.id = v.ecosystem_id
       where v.id = (_link ->> 'product_id')::uuid and s.store_voucher_enabled
         and v.active and not v.archived)
    else false end;
$function$;

REVOKE ALL ON FUNCTION public.social_link_visible(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_link_visible(jsonb) TO authenticated, service_role;

-- 3. Guard on insert: a post may only link something the Universe may see.
CREATE OR REPLACE FUNCTION public.social_posts_check_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.meta is not null and new.meta ? 'link'
     and not public.social_link_visible(new.meta -> 'link') then
    raise exception 'That shop or product is not available to link';
  end if;
  return new;
end $function$;

DROP TRIGGER IF EXISTS social_posts_check_link ON public.social_posts;
CREATE TRIGGER social_posts_check_link
  BEFORE INSERT ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.social_posts_check_link();

-- 4. Picker search: visible Universe shops and their published products.
CREATE OR REPLACE FUNCTION public.universe_link_search(_q text DEFAULT NULL::text, _kind text DEFAULT 'shop'::text, _limit integer DEFAULT 20)
 RETURNS TABLE(kind text, shop_id uuid, shop_name text, shop_slug text, shop_type text,
               logo_path text, cover_path text,
               product_id uuid, product_kind text, product_name text, image_path text, price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with shops as (
    select e.id, e.name, e.slug,
           case when e.store_retail_enabled and e.store_voucher_enabled then 'retail+voucher'
                when e.store_retail_enabled then 'retail' else 'voucher' end shop_type,
           e.retail_logo_path logo, e.retail_cover_path cover,
           e.store_retail_enabled, e.store_voucher_enabled
      from public.ecosystems e
     where auth.uid() is not null
       and e.archived_at is null and e.public_storefront_enabled
       and public.is_universe_shop(e.id)
       and (e.store_retail_enabled or e.store_voucher_enabled)
       and (not e.is_test or public.can_see_test_shop(e.id))
  ), q as (select nullif(lower(btrim(coalesce(_q,''))), '') term),
  rows_ as (
    select 'shop'::text kind, s.id shop_id, s.name shop_name, s.slug shop_slug, s.shop_type, s.logo logo_path, s.cover cover_path,
           null::uuid product_id, null::text product_kind, null::text product_name, null::text image_path, null::numeric price,
           s.name sort_a, ''::text sort_b
      from shops s, q
     where coalesce(_kind,'shop') = 'shop'
       and (q.term is null or lower(s.name) like '%' || q.term || '%')
    union all
    select 'product', s.id, s.name, s.slug, s.shop_type, s.logo, s.cover,
           p.id, 'retail', p.name, p.image_path,
           round((p.price * (1 + public.retail_platform_fee_percent()/100.0))::numeric, 2),
           p.name, s.name
      from public.retail_products p join shops s on s.id = p.ecosystem_id, q
     where coalesce(_kind,'shop') = 'product' and s.store_retail_enabled
       and p.active and p.published and not p.archived and p.public_visible
       and (q.term is null or lower(p.name) like '%' || q.term || '%' or lower(s.name) like '%' || q.term || '%')
    union all
    select 'product', s.id, s.name, s.slug, s.shop_type, s.logo, s.cover,
           v.id, 'voucher', v.name, null::text, v.credit_price,
           v.name, s.name
      from public.voucher_products v join shops s on s.id = v.ecosystem_id, q
     where coalesce(_kind,'shop') = 'product' and s.store_voucher_enabled
       and v.active and not v.archived
       and (q.term is null or lower(v.name) like '%' || q.term || '%' or lower(s.name) like '%' || q.term || '%')
  )
  select kind, shop_id, shop_name, shop_slug, shop_type, logo_path, cover_path,
         product_id, product_kind, product_name, image_path, price
    from rows_
   order by sort_a, sort_b
   limit least(greatest(coalesce(_limit,20),1),50);
$function$;

REVOKE ALL ON FUNCTION public.universe_link_search(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.universe_link_search(text, text, integer) TO authenticated, service_role;

-- 5. Resolve linked references on render: current name/image/price, visibility re-applied.
CREATE OR REPLACE FUNCTION public.social_link_cards(_links jsonb)
 RETURNS TABLE(kind text, shop_id uuid, shop_name text, shop_slug text, shop_type text,
               logo_path text, cover_path text,
               product_id uuid, product_kind text, product_name text, image_path text, price numeric,
               available integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with refs as (
    select distinct l ->> 'kind' kind,
           nullif(l ->> 'shop_id','')::uuid shop_id,
           nullif(l ->> 'product_id','')::uuid product_id,
           l ->> 'product_kind' product_kind
      from jsonb_array_elements(case when jsonb_typeof(_links) = 'array' then _links else '[]'::jsonb end) l
     where auth.uid() is not null
       and coalesce(l ->> 'shop_id','') ~ '^[0-9a-fA-F-]{36}$'
       and (l ->> 'kind' = 'shop' or coalesce(l ->> 'product_id','') ~ '^[0-9a-fA-F-]{36}$')
     limit 200
  ), shops as (
    select e.id, e.name, e.slug,
           case when e.store_retail_enabled and e.store_voucher_enabled then 'retail+voucher'
                when e.store_retail_enabled then 'retail' else 'voucher' end shop_type,
           e.retail_logo_path logo, e.retail_cover_path cover,
           e.store_retail_enabled, e.store_voucher_enabled
      from public.ecosystems e
     where e.id in (select shop_id from refs)
       and e.archived_at is null and e.public_storefront_enabled
       and public.is_universe_shop(e.id)
       and (e.store_retail_enabled or e.store_voucher_enabled)
       and (not e.is_test or public.can_see_test_shop(e.id))
  )
  select 'shop', s.id, s.name, s.slug, s.shop_type, s.logo, s.cover,
         null::uuid, null::text, null::text, null::text, null::numeric, null::int
    from refs r join shops s on s.id = r.shop_id where r.kind = 'shop'
  union all
  select 'product', s.id, s.name, s.slug, s.shop_type, s.logo, s.cover,
         p.id, 'retail', p.name, p.image_path,
         round((p.price * (1 + public.retail_platform_fee_percent()/100.0))::numeric, 2), p.stock
    from refs r join shops s on s.id = r.shop_id
    join public.retail_products p on p.id = r.product_id and p.ecosystem_id = s.id
   where r.kind = 'product' and r.product_kind = 'retail' and s.store_retail_enabled
     and p.active and p.published and not p.archived and p.public_visible
  union all
  select 'product', s.id, s.name, s.slug, s.shop_type, s.logo, s.cover,
         v.id, 'voucher', v.name, null::text, v.credit_price,
         (select count(*)::int from public.voucher_codes c where c.product_id = v.id and c.status = 'unused')
    from refs r join shops s on s.id = r.shop_id
    join public.voucher_products v on v.id = r.product_id and v.ecosystem_id = s.id
   where r.kind = 'product' and r.product_kind = 'voucher' and s.store_voucher_enabled
     and v.active and not v.archived;
$function$;

REVOKE ALL ON FUNCTION public.social_link_cards(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_link_cards(jsonb) TO authenticated, service_role;