-- ============================================================
-- A) Shop store configuration
-- ============================================================
ALTER TABLE public.ecosystems
  ADD COLUMN IF NOT EXISTS store_voucher_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS store_retail_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retail_cash_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS retail_credit_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS retail_pickup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS retail_delivery_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS public_storefront_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS admin_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_assigned_by uuid;

-- ============================================================
-- B) Notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS public.member_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ecosystem_id uuid REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.member_notifications TO authenticated;
GRANT ALL ON public.member_notifications TO service_role;
ALTER TABLE public.member_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own notifications" ON public.member_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Members mark own notifications read" ON public.member_notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS member_notifications_user_idx
  ON public.member_notifications (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.notify_member(
  _user_id uuid, _ecosystem_id uuid, _kind text, _title text, _body text, _link text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.member_notifications (user_id, ecosystem_id, kind, title, body, link)
  VALUES (_user_id, _ecosystem_id, _kind, _title, _body, _link);
$$;

-- ============================================================
-- C) Retail catalogue
-- ============================================================
CREATE TABLE IF NOT EXISTS public.retail_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  image_path text,
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sold_count integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  public_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.retail_products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retail_products TO authenticated;
GRANT ALL ON public.retail_products TO service_role;
ALTER TABLE public.retail_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public sees publicly listed retail products" ON public.retail_products
  FOR SELECT TO anon, authenticated USING (
    active AND NOT archived AND public_visible
    AND EXISTS (SELECT 1 FROM public.ecosystems e
                 WHERE e.id = ecosystem_id AND e.public_storefront_enabled
                   AND e.store_retail_enabled AND e.archived_at IS NULL)
  );
CREATE POLICY "Members see their shop retail products" ON public.retail_products
  FOR SELECT TO authenticated USING (public.has_membership(auth.uid(), ecosystem_id));
CREATE POLICY "Shop admins manage retail products" ON public.retail_products
  FOR ALL TO authenticated
  USING (public.is_ecosystem_admin(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_ecosystem_admin(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()));
CREATE TRIGGER retail_products_touch BEFORE UPDATE ON public.retail_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS retail_products_eco_idx ON public.retail_products (ecosystem_id);

-- ============================================================
-- D) Retail orders
-- ============================================================
CREATE TABLE IF NOT EXISTS public.retail_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL UNIQUE,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  customer_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  fulfillment text NOT NULL CHECK (fulfillment IN ('pickup','delivery')),
  delivery_address text,
  delivery_notes text,
  payment_method text NOT NULL CHECK (payment_method IN ('cash','credit')),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  credit_hold_tx text,
  credit_released boolean NOT NULL DEFAULT false,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.retail_orders TO authenticated;
GRANT ALL ON public.retail_orders TO service_role;
ALTER TABLE public.retail_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers read own retail orders" ON public.retail_orders
  FOR SELECT TO authenticated USING (customer_id = public.effective_uid());
CREATE POLICY "Shop managers read shop retail orders" ON public.retail_orders
  FOR SELECT TO authenticated USING (
    public.is_ecosystem_admin(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()));
CREATE TRIGGER retail_orders_touch BEFORE UPDATE ON public.retail_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS retail_orders_eco_idx ON public.retail_orders (ecosystem_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS retail_orders_customer_idx ON public.retail_orders (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.retail_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.retail_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.retail_products(id),
  product_name text NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.retail_order_items TO authenticated;
GRANT ALL ON public.retail_order_items TO service_role;
ALTER TABLE public.retail_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Order items follow the order" ON public.retail_order_items
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.retail_orders o WHERE o.id = order_id
      AND (o.customer_id = public.effective_uid()
           OR public.is_ecosystem_admin(auth.uid(), o.ecosystem_id)
           OR public.is_super_admin(auth.uid()))));
CREATE INDEX IF NOT EXISTS retail_order_items_order_idx ON public.retail_order_items (order_id);

-- ============================================================
-- E) Ratings and shop reviews
-- ============================================================
CREATE TABLE IF NOT EXISTS public.retail_product_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.retail_products(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.retail_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id)
);
GRANT SELECT ON public.retail_product_ratings TO anon;
GRANT SELECT ON public.retail_product_ratings TO authenticated;
GRANT ALL ON public.retail_product_ratings TO service_role;
ALTER TABLE public.retail_product_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Product ratings are public" ON public.retail_product_ratings
  FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.ecosystem_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  author_name text NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ecosystem_id, user_id)
);
GRANT SELECT ON public.ecosystem_reviews TO anon;
GRANT SELECT ON public.ecosystem_reviews TO authenticated;
GRANT ALL ON public.ecosystem_reviews TO service_role;
ALTER TABLE public.ecosystem_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shop reviews are public" ON public.ecosystem_reviews
  FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER ecosystem_reviews_touch BEFORE UPDATE ON public.ecosystem_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- F) Any approved member may invite into their shop
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_invite_members(_user_id uuid, _ecosystem_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id) OR EXISTS (
    SELECT 1 FROM public.ecosystem_memberships m
     WHERE m.user_id = _user_id AND m.ecosystem_id = _ecosystem_id
       AND m.membership_state = 'active');
$$;

CREATE OR REPLACE FUNCTION public.search_universe_members(_ecosystem_id uuid, _q text, _limit integer DEFAULT 10)
 RETURNS TABLE(user_id uuid, full_name text, handle text, avatar_path text, masked_email text, phone text, already_member boolean, pending_invitation boolean, pending_application boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  _term text := btrim(coalesce(_q, ''));
  _digits text := regexp_replace(coalesce(_q, ''), '[^0-9]', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not public.can_invite_members(auth.uid(), _ecosystem_id) then
    raise exception 'You are not allowed to invite members to this shop';
  end if;
  if length(_term) < 2 then
    return;
  end if;

  return query
  select p.id,
         p.full_name,
         p.handle,
         p.avatar_path,
         case when p.email = '' then null
              else left(p.email, 2) || '***' || substring(p.email from position('@' in p.email))
         end as masked_email,
         nullif(p.phone, '') as phone,
         exists (select 1 from public.ecosystem_memberships m
                  where m.user_id = p.id and m.ecosystem_id = _ecosystem_id
                    and m.membership_state = 'active') as already_member,
         exists (select 1 from public.ecosystem_invitations i
                  where i.user_id = p.id and i.ecosystem_id = _ecosystem_id
                    and i.status = 'pending') as pending_invitation,
         exists (select 1 from public.membership_applications a
                  where a.user_id = p.id and a.ecosystem_id = _ecosystem_id
                    and a.status = 'pending') as pending_application
    from public.profiles p
   where p.deleted_at is null
     and (
       (p.handle is not null
         and public.normalize_handle(p.handle) like public.normalize_handle(_term) || '%')
       or lower(p.full_name) like '%' || lower(_term) || '%'
       or lower(p.email) = lower(_term)
       or (length(_digits) >= 6 and regexp_replace(p.phone, '[^0-9]', '', 'g') like '%' || _digits || '%')
     )
   order by case when p.handle is not null
                  and public.normalize_handle(p.handle) = public.normalize_handle(_term) then 0
                 when lower(p.full_name) = lower(_term) then 1
                 else 2 end,
            p.full_name
   limit least(greatest(coalesce(_limit, 10), 1), 25);
end;
$function$;

CREATE OR REPLACE FUNCTION public.invite_universe_member(_ecosystem_id uuid, _user_id uuid, _message text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  _actor_name text;
  _actor_role public.app_role;
  _days integer;
  _id uuid;
begin
  perform public.assert_actor_active();
  if not public.can_invite_members(auth.uid(), _ecosystem_id) then
    raise exception 'You are not allowed to invite members to this shop';
  end if;
  if _user_id = auth.uid() then
    raise exception 'You cannot invite yourself';
  end if;
  if not exists (select 1 from public.profiles where id = _user_id and deleted_at is null) then
    raise exception 'That Universe member no longer exists';
  end if;
  if exists (select 1 from public.ecosystem_memberships m
              where m.user_id = _user_id and m.ecosystem_id = _ecosystem_id
                and m.membership_state = 'active') then
    raise exception 'That member already belongs to this shop';
  end if;

  perform public.expire_stale_member_invitations();

  if exists (select 1 from public.ecosystem_invitations i
              where i.user_id = _user_id and i.ecosystem_id = _ecosystem_id
                and i.status = 'pending') then
    raise exception 'An invitation for this member is already pending';
  end if;
  if exists (select 1 from public.membership_applications a
              where a.user_id = _user_id and a.ecosystem_id = _ecosystem_id
                and a.status = 'pending') then
    raise exception 'This member already has a pending application for this shop';
  end if;

  select coalesce(full_name, email) into _actor_name from public.profiles where id = auth.uid();
  select role into _actor_role from public.user_roles
   where user_id = auth.uid()
     and (ecosystem_id = _ecosystem_id or role = 'super_admin')
   order by case role when 'super_admin' then 0 when 'admin' then 1 when 'reseller' then 2 else 3 end
   limit 1;
  select coalesce(member_invitation_expiry_days, 14) into _days
    from public.platform_settings where id = 1;

  insert into public.ecosystem_invitations
    (ecosystem_id, user_id, invited_by, inviter_name, inviter_role, role, message, expires_at)
  values (_ecosystem_id, _user_id, auth.uid(), coalesce(_actor_name, 'Unknown'),
          coalesce(_actor_role, public.membership_role(auth.uid(), _ecosystem_id)),
          'customer', nullif(btrim(coalesce(_message, '')), ''),
          now() + make_interval(days => greatest(coalesce(_days, 14), 1)))
  returning id into _id;

  perform public.notify_member(_user_id, _ecosystem_id, 'shop_invitation',
    'You were invited to a shop',
    coalesce(_actor_name, 'A member') || ' invited you to join ' ||
      (select name from public.ecosystems where id = _ecosystem_id), '/universe');

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor_name, 'Unknown'),
          'Invited Universe member to shop', _user_id::text,
          jsonb_build_object('invitation_id', _id, 'user_id', _user_id,
                             'actor_role', _actor_role, 'status', 'pending'));
  return _id;
end;
$function$;

-- ============================================================
-- G) Super Admin shop admin assignment
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_shop_admin(_ecosystem_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  _shop text; _old uuid; _old_name text; _new_name text; _op text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can assign a shop admin';
  end if;
  select name into _shop from public.ecosystems where id = _ecosystem_id;
  if _shop is null then raise exception 'Shop not found'; end if;
  if not exists (select 1 from public.profiles where id = _user_id and deleted_at is null) then
    raise exception 'That account no longer exists';
  end if;

  select ur.user_id into _old from public.user_roles ur
   where ur.ecosystem_id = _ecosystem_id and ur.role = 'admin' limit 1;
  if _old = _user_id then
    raise exception 'That member already manages this shop';
  end if;

  -- Step the previous admin down to customer, keeping their membership + wallets.
  if _old is not null then
    update public.user_roles set role = 'customer'
      where user_id = _old and ecosystem_id = _ecosystem_id and role = 'admin';
    update public.ecosystem_memberships set role = 'customer'
      where user_id = _old and ecosystem_id = _ecosystem_id;
    select full_name into _old_name from public.profiles where id = _old;
  end if;

  -- Promote the new admin, creating the membership when they are new to the shop.
  insert into public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  values (_user_id, _ecosystem_id, 'admin', 'active')
  on conflict (user_id, ecosystem_id)
  do update set role = 'admin', membership_state = 'active';

  delete from public.user_roles
   where user_id = _user_id and ecosystem_id = _ecosystem_id;
  insert into public.user_roles (user_id, ecosystem_id, role)
  values (_user_id, _ecosystem_id, 'admin')
  on conflict (user_id, role) do nothing;

  perform public.ensure_membership_wallets(_user_id, _ecosystem_id);

  update public.ecosystems
     set admin_assigned_at = now(), admin_assigned_by = auth.uid()
   where id = _ecosystem_id;

  select full_name into _new_name from public.profiles where id = _user_id;
  select coalesce(full_name, 'Platform owner') into _op from public.profiles where id = auth.uid();

  perform public.notify_member(_user_id, _ecosystem_id, 'shop_admin_assigned',
    'You now manage ' || _shop,
    'The platform owner assigned you as the shop admin of ' || _shop || '.', '/admin');

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), _op,
          case when _old is null then 'Assigned shop admin' else 'Replaced shop admin' end,
          coalesce(_new_name, _user_id::text),
          jsonb_build_object('ecosystem_id', _ecosystem_id, 'shop', _shop,
                             'previous_admin_id', _old, 'previous_admin_name', _old_name,
                             'new_admin_id', _user_id, 'new_admin_name', _new_name,
                             'operator_id', auth.uid(), 'at', now()));
end $$;

-- ============================================================
-- H) Retail reads
-- ============================================================
CREATE OR REPLACE FUNCTION public.shop_store_settings(_ecosystem_id uuid)
RETURNS TABLE(voucher_enabled boolean, retail_enabled boolean, cash_enabled boolean,
              credit_enabled boolean, pickup_enabled boolean, delivery_enabled boolean,
              public_storefront boolean, contact_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.store_voucher_enabled, e.store_retail_enabled, e.retail_cash_enabled,
         e.retail_credit_enabled, e.retail_pickup_enabled, e.retail_delivery_enabled,
         e.public_storefront_enabled,
         CASE WHEN public.is_ecosystem_admin(auth.uid(), e.id) OR public.is_super_admin(auth.uid())
              THEN e.contact_email ELSE NULL END
    FROM public.ecosystems e WHERE e.id = _ecosystem_id;
$$;

CREATE OR REPLACE FUNCTION public.list_retail_products(_ecosystem_id uuid)
RETURNS TABLE(id uuid, name text, description text, image_path text, price numeric,
              stock integer, sold_count integer, public_visible boolean,
              rating_avg numeric, rating_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.description, p.image_path, p.price, p.stock, p.sold_count, p.public_visible,
         coalesce((select round(avg(r.rating)::numeric,2) from public.retail_product_ratings r
                    where r.product_id = p.id), 0)::numeric,
         coalesce((select count(*)::int from public.retail_product_ratings r
                    where r.product_id = p.id), 0)
    FROM public.retail_products p
   WHERE p.ecosystem_id = _ecosystem_id
     AND p.active AND NOT p.archived
     AND (public.has_membership(auth.uid(), _ecosystem_id)
          OR (p.public_visible AND EXISTS (SELECT 1 FROM public.ecosystems e
                WHERE e.id = _ecosystem_id AND e.public_storefront_enabled)))
   ORDER BY p.name;
$$;

CREATE OR REPLACE FUNCTION public.public_shop_overview(_slug text)
RETURNS TABLE(id uuid, name text, slug text, description text, contact_email text, contact_phone text,
              facebook_page_url text, admin_name text, member_count integer, product_count integer,
              sales_count integer, rating_avg numeric, rating_count integer,
              voucher_enabled boolean, retail_enabled boolean, storefront_public boolean,
              has_admin boolean, is_member boolean, pending_application boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
            WHERE a.ecosystem_id = e.id AND a.user_id = auth.uid() AND a.status = 'pending')
    FROM public.ecosystems e
   WHERE e.slug = _slug AND e.archived_at IS NULL AND e.public_storefront_enabled;
$$;

CREATE OR REPLACE FUNCTION public.public_shop_products(_slug text)
RETURNS TABLE(kind text, id uuid, name text, description text, image_path text, price numeric,
              available integer, rating_avg numeric, rating_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH shop AS (
    SELECT e.* FROM public.ecosystems e
     WHERE e.slug = _slug AND e.archived_at IS NULL AND e.public_storefront_enabled)
  SELECT 'retail'::text, p.id, p.name, p.description, p.image_path, p.price, p.stock,
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.retail_product_ratings r
                    WHERE r.product_id = p.id),0)::numeric,
         coalesce((SELECT count(*)::int FROM public.retail_product_ratings r
                    WHERE r.product_id = p.id),0)
    FROM public.retail_products p JOIN shop s ON s.id = p.ecosystem_id
   WHERE s.store_retail_enabled AND p.active AND NOT p.archived AND p.public_visible
  UNION ALL
  SELECT 'voucher'::text, v.id, v.name, v.description, NULL, v.credit_price,
         (SELECT count(*)::int FROM public.voucher_codes c
           WHERE c.product_id = v.id AND c.status = 'unused'),
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.product_ratings r
                    WHERE r.product_id = v.id),0)::numeric,
         coalesce((SELECT count(*)::int FROM public.product_ratings r
                    WHERE r.product_id = v.id),0)
    FROM public.voucher_products v JOIN shop s ON s.id = v.ecosystem_id
   WHERE s.store_voucher_enabled AND v.active AND NOT v.archived
   ORDER BY 1, 3;
$$;

CREATE OR REPLACE FUNCTION public.public_shop_reviews(_slug text, _limit integer DEFAULT 20)
RETURNS TABLE(id uuid, author_name text, rating integer, comment text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.author_name, r.rating, r.comment, r.created_at
    FROM public.ecosystem_reviews r
    JOIN public.ecosystems e ON e.id = r.ecosystem_id
   WHERE e.slug = _slug AND e.public_storefront_enabled
   ORDER BY r.created_at DESC
   LIMIT least(greatest(coalesce(_limit, 20), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.list_public_shops(_q text DEFAULT NULL, _limit integer DEFAULT 30)
RETURNS TABLE(id uuid, name text, slug text, description text, member_count integer,
              rating_avg numeric, rating_count integer, voucher_enabled boolean, retail_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.name, e.slug, e.description,
         (SELECT count(*)::int FROM public.ecosystem_memberships m
           WHERE m.ecosystem_id = e.id AND m.membership_state = 'active'),
         coalesce((SELECT round(avg(r.rating)::numeric,2) FROM public.ecosystem_reviews r
                    WHERE r.ecosystem_id = e.id),0)::numeric,
         coalesce((SELECT count(*)::int FROM public.ecosystem_reviews r
                    WHERE r.ecosystem_id = e.id),0),
         e.store_voucher_enabled, e.store_retail_enabled
    FROM public.ecosystems e
   WHERE e.archived_at IS NULL AND e.public_storefront_enabled
     AND (_q IS NULL OR btrim(_q) = '' OR lower(e.name) LIKE '%' || lower(btrim(_q)) || '%')
   ORDER BY e.name
   LIMIT least(greatest(coalesce(_limit, 30), 1), 100);
$$;

-- ============================================================
-- I) Placing and reviewing retail orders
-- ============================================================
CREATE OR REPLACE FUNCTION public.retail_place_order(
  _ecosystem_id uuid, _items jsonb, _fulfillment text, _payment_method text,
  _address text DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS TABLE(order_id uuid, order_no text, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  _uid uuid := public.effective_uid();
  _eco record; _item jsonb; _p record; _qty int; _total numeric(14,2) := 0;
  _oid uuid; _ono text; _acct uuid; _name text; _tx text;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  perform public.assert_actor_active();
  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco is null then raise exception 'Shop not found'; end if;
  if not _eco.store_retail_enabled then raise exception 'This shop has no retail store'; end if;
  if coalesce(_eco.operations_frozen, false) then raise exception 'This shop is temporarily frozen'; end if;
  if not public.has_membership(_uid, _ecosystem_id) then
    raise exception 'Join this shop before ordering';
  end if;
  if _fulfillment not in ('pickup','delivery') then raise exception 'Choose pickup or delivery'; end if;
  if _fulfillment = 'pickup' and not _eco.retail_pickup_enabled then
    raise exception 'This shop does not offer pickup'; end if;
  if _fulfillment = 'delivery' then
    if not _eco.retail_delivery_enabled then raise exception 'This shop does not offer delivery'; end if;
    if btrim(coalesce(_address, '')) = '' then raise exception 'A delivery address is required'; end if;
  end if;
  if _payment_method not in ('cash','credit') then raise exception 'Choose a payment method'; end if;
  if _payment_method = 'cash' and not _eco.retail_cash_enabled then
    raise exception 'This shop does not accept cash'; end if;
  if _payment_method = 'credit' and not _eco.retail_credit_enabled then
    raise exception 'This shop does not accept credit payment'; end if;
  if _items is null or jsonb_array_length(_items) = 0 then raise exception 'Your cart is empty'; end if;

  select coalesce(full_name, 'Member') into _name from public.profiles where id = _uid;
  _ono := 'RO-' || to_char(now(), 'YYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));

  insert into public.retail_orders
    (order_no, ecosystem_id, customer_id, customer_name, fulfillment, delivery_address,
     delivery_notes, payment_method, total)
  values (_ono, _ecosystem_id, _uid, _name, _fulfillment,
          nullif(btrim(coalesce(_address,'')), ''), nullif(btrim(coalesce(_notes,'')), ''),
          _payment_method, 0)
  returning id into _oid;

  for _item in select * from jsonb_array_elements(_items) loop
    _qty := greatest(coalesce((_item->>'quantity')::int, 0), 0);
    if _qty = 0 then continue; end if;
    select * into _p from public.retail_products
     where id = (_item->>'product_id')::uuid and ecosystem_id = _ecosystem_id
       and active and not archived
     for update;
    if _p is null then raise exception 'A product in your cart is no longer available'; end if;
    if _p.stock < _qty then
      raise exception '% has only % left', _p.name, _p.stock;
    end if;
    update public.retail_products set stock = stock - _qty where id = _p.id;
    insert into public.retail_order_items
      (order_id, product_id, product_name, unit_price, quantity, line_total)
    values (_oid, _p.id, _p.name, _p.price, _qty, round(_p.price * _qty, 2));
    _total := _total + round(_p.price * _qty, 2);
  end loop;

  if _total <= 0 then raise exception 'Your cart is empty'; end if;

  if _payment_method = 'credit' then
    perform public.ensure_membership_wallets(_uid, _ecosystem_id);
    select id into _acct from public.credit_accounts
     where user_id = _uid and ecosystem_id = _ecosystem_id;
    if _acct is null then raise exception 'No credit wallet for this shop'; end if;
    _tx := public.new_tx_id();
    insert into public.credit_ledger
      (account_id, user_id, ecosystem_id, direction, amount, reason, reference, actor_id, tx_id)
    values (_acct, _uid, _ecosystem_id, 'debit', _total,
            'Retail order hold', _ono, _uid, _tx);
    update public.retail_orders set credit_hold_tx = _tx where id = _oid;
  end if;

  update public.retail_orders set total = _total where id = _oid;

  perform public.notify_member(u.user_id, _ecosystem_id, 'retail_order',
    'New retail order ' || _ono,
    _name || ' placed a ' || _payment_method || ' order worth ' || _total::text || ' credits.',
    '/admin/orders')
    from public.user_roles u
   where u.ecosystem_id = _ecosystem_id and u.role = 'admin';

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, _uid, _name, 'Placed retail order', _ono,
          jsonb_build_object('order_id', _oid, 'total', _total,
                             'payment_method', _payment_method, 'fulfillment', _fulfillment));

  return query select _oid, _ono, _total;
end $$;

CREATE OR REPLACE FUNCTION public.retail_review_order(_order_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _o record; _acct uuid; _actor text; _it record;
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o is null then raise exception 'Order not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _o.ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Only the shop admin can review orders';
  end if;
  if _o.status <> 'pending' then
    raise exception 'This order was already %', _o.status;
  end if;

  select coalesce(full_name, 'Admin') into _actor from public.profiles where id = auth.uid();

  if _approve then
    update public.retail_products p
       set sold_count = p.sold_count + i.quantity
      from public.retail_order_items i
     where i.order_id = _o.id and p.id = i.product_id;
    update public.retail_orders
       set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(coalesce(_note,'')), '')
     where id = _o.id and status = 'pending';
  else
    -- Restore reserved stock and return any held credits in full.
    for _it in select * from public.retail_order_items where order_id = _o.id loop
      update public.retail_products set stock = stock + _it.quantity where id = _it.product_id;
    end loop;
    if _o.payment_method = 'credit' and _o.credit_hold_tx is not null and not _o.credit_released then
      select id into _acct from public.credit_accounts
       where user_id = _o.customer_id and ecosystem_id = _o.ecosystem_id;
      insert into public.credit_ledger
        (account_id, user_id, ecosystem_id, direction, amount, reason, reference, actor_id, tx_id)
      values (_acct, _o.customer_id, _o.ecosystem_id, 'credit', _o.total,
              'Retail order refund', _o.order_no, auth.uid(), public.new_tx_id());
    end if;
    update public.retail_orders
       set status = 'rejected', credit_released = true, decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(coalesce(_note,'')), '')
     where id = _o.id and status = 'pending';
  end if;

  perform public.notify_member(_o.customer_id, _o.ecosystem_id, 'retail_order',
    'Order ' || _o.order_no || (case when _approve then ' approved' else ' rejected' end),
    coalesce(nullif(btrim(coalesce(_note,'')), ''),
             case when _approve then 'Your order is confirmed.' else 'Your order was rejected and nothing was charged.' end),
    '/app/store');

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_o.ecosystem_id, auth.uid(), _actor,
          case when _approve then 'Approved retail order' else 'Rejected retail order' end,
          _o.order_no,
          jsonb_build_object('order_id', _o.id, 'total', _o.total,
                             'customer_id', _o.customer_id, 'note', _note));
end $$;

CREATE OR REPLACE FUNCTION public.cancel_retail_order(_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _o record; _acct uuid; _it record;
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o is null then raise exception 'Order not found'; end if;
  if _o.customer_id <> public.effective_uid() then raise exception 'Not your order'; end if;
  if _o.status <> 'pending' then raise exception 'This order was already %', _o.status; end if;
  for _it in select * from public.retail_order_items where order_id = _o.id loop
    update public.retail_products set stock = stock + _it.quantity where id = _it.product_id;
  end loop;
  if _o.payment_method = 'credit' and _o.credit_hold_tx is not null and not _o.credit_released then
    select id into _acct from public.credit_accounts
     where user_id = _o.customer_id and ecosystem_id = _o.ecosystem_id;
    insert into public.credit_ledger
      (account_id, user_id, ecosystem_id, direction, amount, reason, reference, actor_id, tx_id)
    values (_acct, _o.customer_id, _o.ecosystem_id, 'credit', _o.total,
            'Retail order refund', _o.order_no, _o.customer_id, public.new_tx_id());
  end if;
  update public.retail_orders
     set status = 'cancelled', credit_released = true, decided_at = now()
   where id = _o.id and status = 'pending';
end $$;

CREATE OR REPLACE FUNCTION public.list_retail_orders(_ecosystem_id uuid, _status text DEFAULT NULL)
RETURNS TABLE(id uuid, order_no text, customer_id uuid, customer_name text, status text,
              fulfillment text, delivery_address text, delivery_notes text, payment_method text,
              total numeric, decision_note text, created_at timestamptz, items jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.order_no, o.customer_id, o.customer_name, o.status, o.fulfillment,
         o.delivery_address, o.delivery_notes, o.payment_method, o.total, o.decision_note, o.created_at,
         coalesce((SELECT jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity,
                    'unit_price', i.unit_price, 'line_total', i.line_total, 'product_id', i.product_id)
                    ORDER BY i.product_name)
                     FROM public.retail_order_items i WHERE i.order_id = o.id), '[]'::jsonb)
    FROM public.retail_orders o
   WHERE o.ecosystem_id = _ecosystem_id
     AND (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) OR public.is_super_admin(auth.uid()))
     AND (_status IS NULL OR _status = 'all' OR o.status = _status)
   ORDER BY o.created_at DESC
   LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION public.my_retail_orders(_ecosystem_id uuid)
RETURNS TABLE(id uuid, order_no text, status text, fulfillment text, delivery_address text,
              delivery_notes text, payment_method text, total numeric, decision_note text,
              created_at timestamptz, items jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.order_no, o.status, o.fulfillment, o.delivery_address, o.delivery_notes,
         o.payment_method, o.total, o.decision_note, o.created_at,
         coalesce((SELECT jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity,
                    'unit_price', i.unit_price, 'line_total', i.line_total, 'product_id', i.product_id)
                    ORDER BY i.product_name)
                     FROM public.retail_order_items i WHERE i.order_id = o.id), '[]'::jsonb)
    FROM public.retail_orders o
   WHERE o.ecosystem_id = _ecosystem_id AND o.customer_id = public.effective_uid()
   ORDER BY o.created_at DESC
   LIMIT 100;
$$;

-- ============================================================
-- J) Reviews written by real customers only
-- ============================================================
CREATE OR REPLACE FUNCTION public.rate_retail_product(_order_id uuid, _product_id uuid, _rating integer, _comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _o record;
begin
  select * into _o from public.retail_orders where id = _order_id;
  if _o is null or _o.customer_id <> public.effective_uid() then raise exception 'Not your order'; end if;
  if _o.status <> 'approved' then raise exception 'You can rate a product after the order is approved'; end if;
  if not exists (select 1 from public.retail_order_items where order_id = _order_id and product_id = _product_id) then
    raise exception 'That product is not part of this order';
  end if;
  if _rating < 1 or _rating > 5 then raise exception 'Rate between 1 and 5'; end if;
  insert into public.retail_product_ratings (ecosystem_id, product_id, order_id, user_id, rating, comment)
  values (_o.ecosystem_id, _product_id, _order_id, _o.customer_id, _rating, nullif(btrim(coalesce(_comment,'')),''))
  on conflict (order_id, product_id) do update
    set rating = excluded.rating, comment = excluded.comment;
end $$;

CREATE OR REPLACE FUNCTION public.can_review_shop(_user_id uuid, _ecosystem_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.ecosystem_memberships m
             WHERE m.user_id = _user_id AND m.ecosystem_id = _ecosystem_id
               AND m.membership_state = 'active')
    OR EXISTS (SELECT 1 FROM public.voucher_sales s
                WHERE s.buyer_id = _user_id AND s.ecosystem_id = _ecosystem_id AND s.refunded_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.retail_orders o
                WHERE o.customer_id = _user_id AND o.ecosystem_id = _ecosystem_id AND o.status = 'approved'));
$$;

CREATE OR REPLACE FUNCTION public.rate_shop(_ecosystem_id uuid, _rating integer, _comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _uid uuid := public.effective_uid(); _name text;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  if _rating < 1 or _rating > 5 then raise exception 'Rate between 1 and 5'; end if;
  if not public.can_review_shop(_uid, _ecosystem_id) then
    raise exception 'Only members and customers of this shop can review it';
  end if;
  select coalesce(full_name, 'Member') into _name from public.profiles where id = _uid;
  insert into public.ecosystem_reviews (ecosystem_id, user_id, author_name, rating, comment)
  values (_ecosystem_id, _uid, _name, _rating, nullif(btrim(coalesce(_comment,'')),''))
  on conflict (ecosystem_id, user_id) do update
    set rating = excluded.rating, comment = excluded.comment, author_name = excluded.author_name;
end $$;

-- ============================================================
-- K) Execute grants
-- ============================================================
GRANT EXECUTE ON FUNCTION public.public_shop_overview(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_shop_products(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_shop_reviews(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_shops(text, integer) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_member(uuid, uuid, text, text, text, text) FROM anon, authenticated;
