-- Retail storefront identity & availability (presentation + guard only).
alter table public.ecosystems
  add column if not exists retail_logo_path text,
  add column if not exists retail_cover_path text,
  add column if not exists retail_accepting_orders boolean not null default true,
  add column if not exists retail_paused_note text;

alter table public.ecosystems
  drop constraint if exists ecosystems_retail_paused_note_len;
alter table public.ecosystems
  add constraint ecosystems_retail_paused_note_len
  check (retail_paused_note is null or char_length(retail_paused_note) <= 160);

-- Shop admin (or platform owner) edits their own shop's storefront identity.
create or replace function public.update_retail_storefront(
  _ecosystem_id uuid,
  _logo_path text default null,
  _cover_path text default null,
  _accepting_orders boolean default null,
  _paused_note text default null,
  _clear_logo boolean default false,
  _clear_cover boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare _actor text; _prev public.ecosystems; _prefix text;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Only the shop admin can edit the storefront';
  end if;
  select * into _prev from public.ecosystems where id = _ecosystem_id and archived_at is null;
  if _prev.id is null then raise exception 'Shop not found'; end if;
  if not _prev.store_retail_enabled then raise exception 'This shop has no retail store'; end if;

  _prefix := _ecosystem_id::text || '/storefront/';
  if _logo_path is not null and position(_prefix in _logo_path) <> 1 then
    raise exception 'Logo must be uploaded to this shop''s own storefront folder';
  end if;
  if _cover_path is not null and position(_prefix in _cover_path) <> 1 then
    raise exception 'Cover must be uploaded to this shop''s own storefront folder';
  end if;

  update public.ecosystems
     set retail_logo_path = case when _clear_logo then null else coalesce(_logo_path, retail_logo_path) end,
         retail_cover_path = case when _clear_cover then null else coalesce(_cover_path, retail_cover_path) end,
         retail_accepting_orders = coalesce(_accepting_orders, retail_accepting_orders),
         retail_paused_note = case when _paused_note is null then retail_paused_note
                                   else nullif(left(trim(_paused_note), 160), '') end
   where id = _ecosystem_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Admin'), 'Updated retail storefront', _prev.name,
          jsonb_build_object('accepting_before', _prev.retail_accepting_orders,
                             'accepting_after', coalesce(_accepting_orders, _prev.retail_accepting_orders),
                             'logo_changed', _logo_path is not null or _clear_logo,
                             'cover_changed', _cover_path is not null or _clear_cover));
end;
$$;
revoke all on function public.update_retail_storefront(uuid, text, text, boolean, text, boolean, boolean) from public, anon;
grant execute on function public.update_retail_storefront(uuid, text, text, boolean, text, boolean, boolean) to authenticated;

-- Paused shops accept no NEW retail orders; existing orders are never affected.
create or replace function public.retail_orders_require_open_shop()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.ecosystems e
                  where e.id = new.ecosystem_id and e.retail_accepting_orders) then
    raise exception 'This shop is temporarily closed for new orders';
  end if;
  return new;
end;
$$;
drop trigger if exists retail_orders_require_open_shop on public.retail_orders;
create trigger retail_orders_require_open_shop
  before insert on public.retail_orders
  for each row execute function public.retail_orders_require_open_shop();

-- Store settings read (admin card + member storefront) gains storefront fields.
drop function if exists public.shop_store_settings(uuid);
create function public.shop_store_settings(_ecosystem_id uuid)
returns table(voucher_enabled boolean, retail_enabled boolean, cash_enabled boolean, credit_enabled boolean,
              pickup_enabled boolean, delivery_enabled boolean, public_storefront boolean, contact_email text,
              cod_enabled boolean, delivery_fee numeric, delivery_pct integer, collector_pct integer,
              logo_path text, cover_path text, accepting_orders boolean, paused_note text)
language sql stable security definer set search_path = public as $$
  select e.store_voucher_enabled, e.store_retail_enabled, e.retail_cash_enabled,
         e.retail_credit_enabled, e.retail_pickup_enabled, e.retail_delivery_enabled,
         e.public_storefront_enabled,
         case when public.is_ecosystem_admin(auth.uid(), e.id) or public.is_super_admin(auth.uid())
              then e.contact_email else null end,
         e.retail_cod_enabled and public.is_universe_shop(e.id), e.retail_delivery_fee,
         e.retail_delivery_split_delivery_pct, e.retail_delivery_split_collector_pct,
         e.retail_logo_path, e.retail_cover_path, e.retail_accepting_orders, e.retail_paused_note
    from public.ecosystems e where e.id = _ecosystem_id;
$$;
grant execute on function public.shop_store_settings(uuid) to authenticated, anon;

-- Public storefront overview gains the same customer-safe storefront fields.
drop function if exists public.public_shop_overview(text);
create function public.public_shop_overview(_slug text)
 returns table(id uuid, name text, slug text, description text, contact_email text, contact_phone text,
               facebook_page_url text, admin_name text, member_count integer, product_count integer,
               sales_count integer, rating_avg numeric, rating_count integer, voucher_enabled boolean,
               retail_enabled boolean, storefront_public boolean, has_admin boolean, is_member boolean,
               pending_application boolean, logo_path text, cover_path text, accepting_orders boolean,
               paused_note text)
 language sql stable security definer set search_path to 'public' as $function$
  SELECT e.id, e.name, e.slug, e.description, e.contact_email, e.contact_phone, e.facebook_page_url,
         (SELECT pr.full_name FROM public.user_roles ur
            JOIN public.profiles pr ON pr.id = ur.user_id
           WHERE ur.ecosystem_id = e.id AND ur.role = 'admin' LIMIT 1),
         (SELECT count(*)::int FROM public.ecosystem_memberships m
           WHERE m.ecosystem_id = e.id AND m.membership_state = 'active'),
         (SELECT count(*)::int FROM public.retail_products p
           WHERE p.ecosystem_id = e.id AND p.active AND NOT p.archived AND p.public_visible)
         + (SELECT count(*)::int FROM public.voucher_products v
             WHERE v.ecosystem_id = e.id AND v.active AND NOT v.archived),
         (SELECT count(*)::int FROM public.voucher_sales s
           WHERE s.ecosystem_id = e.id AND s.refunded_at IS NULL)
         + (SELECT count(*)::int FROM public.retail_orders o
             WHERE o.ecosystem_id = e.id AND o.status = 'approved'),
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.ecosystem_reviews r
                    WHERE r.ecosystem_id = e.id), 0)::numeric,
         coalesce((SELECT count(*)::int FROM public.ecosystem_reviews r
                    WHERE r.ecosystem_id = e.id), 0),
         e.store_voucher_enabled, e.store_retail_enabled, e.public_storefront_enabled,
         public.ecosystem_has_admin(e.id),
         auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.ecosystem_memberships m
            WHERE m.ecosystem_id = e.id AND m.user_id = auth.uid() AND m.membership_state = 'active'),
         auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.membership_applications a
            WHERE a.ecosystem_id = e.id AND a.user_id = auth.uid() AND a.status = 'pending'),
         e.retail_logo_path, e.retail_cover_path, e.retail_accepting_orders, e.retail_paused_note
    FROM public.ecosystems e
   WHERE e.slug = _slug AND e.archived_at IS NULL AND e.public_storefront_enabled
     AND (NOT e.is_test OR public.can_see_test_shop(e.id));
$function$;
grant execute on function public.public_shop_overview(text) to authenticated, anon;

-- Storage: shop logo/cover follow the public-storefront rule, like product photos.
drop policy if exists "Retail images follow product visibility" on storage.objects;
create policy "Retail images follow product visibility"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'retail-images'
    and (
      exists (
        select 1 from public.retail_products p
        join public.ecosystems e on e.id = p.ecosystem_id
        where p.image_path = storage.objects.name
          and p.active and not p.archived and p.public_visible
          and e.public_storefront_enabled and e.store_retail_enabled
          and e.archived_at is null
      )
      or exists (
        select 1 from public.ecosystems e
        where (e.retail_logo_path = storage.objects.name or e.retail_cover_path = storage.objects.name)
          and e.public_storefront_enabled and e.store_retail_enabled
          and e.archived_at is null
      )
      or (
        split_part(storage.objects.name, '/', 1)
          ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and (
          public.is_super_admin(auth.uid())
          or public.is_ecosystem_admin(auth.uid(), split_part(storage.objects.name, '/', 1)::uuid)
          or public.has_membership(auth.uid(), split_part(storage.objects.name, '/', 1)::uuid)
        )
      )
    )
  );