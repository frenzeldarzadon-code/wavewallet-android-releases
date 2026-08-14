-- 1. Shops are active as soon as they are created ---------------------------
CREATE OR REPLACE FUNCTION public.create_ecosystem(_name text, _slug text DEFAULT NULL::text, _description text DEFAULT NULL::text, _contact_email text DEFAULT NULL::text, _contact_phone text DEFAULT NULL::text, _plan_name text DEFAULT 'Starter'::text, _plan_price numeric DEFAULT 0, _grace_period_days integer DEFAULT 5, _signup_enabled boolean DEFAULT true)
 RETURNS ecosystems
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _base text;
  _candidate text;
  _n integer := 1;
  _row public.ecosystems;
  _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can create shops';
  end if;
  if coalesce(trim(_name),'') = '' then
    raise exception 'A shop needs a name';
  end if;
  if _plan_price < 0 then raise exception 'Plan price cannot be negative'; end if;
  if _grace_period_days < 0 or _grace_period_days > 90 then
    raise exception 'Grace period must be between 0 and 90 days';
  end if;

  _base := public.slugify(coalesce(nullif(trim(_slug),''), _name));
  if _base = '' then _base := 'shop'; end if;
  _candidate := _base;
  while exists (select 1 from public.ecosystems where slug = _candidate) loop
    _n := _n + 1;
    _candidate := _base || '-' || _n;
  end loop;

  insert into public.ecosystems
    (name, slug, description, contact_email, contact_phone,
     plan_name, plan_price, grace_period_days, signup_enabled,
     subscription_state, current_period_end)
  values
    (trim(_name), _candidate, nullif(trim(_description),''),
     nullif(lower(trim(_contact_email)),''), nullif(trim(_contact_phone),''),
     coalesce(nullif(trim(_plan_name),''), 'Starter'), _plan_price,
     _grace_period_days, coalesce(_signup_enabled, true),
     'active', null)
  returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.id, auth.uid(), coalesce(_actor,'Super admin'), 'Created shop', _row.name,
          jsonb_build_object('slug', _row.slug, 'status', 'active'));
  return _row;
end;
$function$;

-- 2. A shop without an assigned admin is not enterable ----------------------
CREATE OR REPLACE FUNCTION public.ecosystem_has_admin(_ecosystem_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.ecosystem_id = _ecosystem_id
      and ur.role = 'admin'
      and p.deleted_at is null
  ) or exists (
    select 1
    from public.ecosystem_memberships m
    join public.profiles p on p.id = m.user_id
    where m.ecosystem_id = _ecosystem_id
      and m.role = 'admin'
      and m.membership_state = 'active'
      and p.deleted_at is null
  );
$function$;

GRANT EXECUTE ON FUNCTION public.ecosystem_has_admin(uuid) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.joinable_ecosystems()
 RETURNS TABLE(id uuid, name text, slug text, description text, pending boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.name, e.slug, e.description,
         EXISTS (SELECT 1 FROM public.membership_applications a
                  WHERE a.user_id = public.effective_uid()
                    AND a.ecosystem_id = e.id AND a.status = 'pending')
  FROM public.ecosystems e
  WHERE e.signup_enabled AND e.archived_at IS NULL
    AND e.subscription_state = 'active'
    AND NOT COALESCE(e.operations_frozen, false)
    AND public.ecosystem_has_admin(e.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.ecosystem_memberships m
       WHERE m.user_id = public.effective_uid()
         AND m.ecosystem_id = e.id AND m.membership_state = 'active')
  ORDER BY e.name;
$function$;

CREATE OR REPLACE FUNCTION public.list_signup_ecosystems()
 RETURNS TABLE(id uuid, name text, slug text, description text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id, e.name, e.slug, e.description
  from public.ecosystems e
  where e.signup_enabled
    and e.archived_at is null
    and e.subscription_state = 'active'
    and not coalesce(e.operations_frozen, false)
    and public.ecosystem_has_admin(e.id)
  order by e.name
$function$;

CREATE OR REPLACE FUNCTION public.switch_ecosystem(_ecosystem_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _m public.ecosystem_memberships%rowtype;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.acting_as() IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot switch shops while acting as another member';
  END IF;

  SELECT * INTO _m FROM public.ecosystem_memberships
  WHERE user_id = _uid AND ecosystem_id = _ecosystem_id AND membership_state = 'active';
  IF _m.id IS NULL THEN RAISE EXCEPTION 'You do not have an approved membership in that shop'; END IF;
  IF _m.status <> 'active' THEN RAISE EXCEPTION 'Your membership in that shop is suspended'; END IF;

  -- A shop with no assigned admin is not open for business yet. Platform
  -- owners keep access so they can assign one.
  IF NOT public.ecosystem_has_admin(_ecosystem_id)
     AND NOT public.is_super_admin(_uid)
     AND _m.role <> 'admin' THEN
    RAISE EXCEPTION 'This shop has no admin assigned yet and is not open';
  END IF;

  PERFORM public.ensure_membership_wallets(_uid, _ecosystem_id);

  UPDATE public.profiles SET
    active_ecosystem_id = _ecosystem_id,
    ecosystem_id = _ecosystem_id,
    status = _m.status,
    reseller_id = _m.reseller_id,
    reseller_discount_percent = COALESCE(_m.reseller_discount_percent, 0),
    reseller_commission_percent = _m.reseller_commission_percent,
    sale_commission_percent = _m.sale_commission_percent,
    handle = _m.handle
  WHERE id = _uid;

  DELETE FROM public.user_roles WHERE user_id = _uid AND role <> 'super_admin';
  INSERT INTO public.user_roles (user_id, role, ecosystem_id)
  VALUES (_uid, _m.role, _ecosystem_id)
  ON CONFLICT (user_id, role) DO UPDATE SET ecosystem_id = excluded.ecosystem_id;

  PERFORM public.log_operator_action(
    _uid, _ecosystem_id, 'switch_ecosystem', 'ecosystem_membership', _m.id,
    jsonb_build_object('ecosystem_id', _ecosystem_id, 'role', _m.role)
  );

  RETURN _ecosystem_id;
END $function$;

-- 3. Ratings -----------------------------------------------------------------
CREATE TABLE public.product_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.voucher_products(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL UNIQUE REFERENCES public.voucher_sales(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_ratings_product_idx ON public.product_ratings(product_id);
GRANT SELECT ON public.product_ratings TO authenticated;
GRANT ALL ON public.product_ratings TO service_role;
ALTER TABLE public.product_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read ratings in their shops" ON public.product_ratings
  FOR SELECT TO authenticated
  USING (public.has_membership(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()));

CREATE TABLE public.reward_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  reward_id uuid NOT NULL REFERENCES public.reward_products(id) ON DELETE CASCADE,
  redemption_id uuid NOT NULL UNIQUE REFERENCES public.reward_redemptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reward_ratings_reward_idx ON public.reward_ratings(reward_id);
GRANT SELECT ON public.reward_ratings TO authenticated;
GRANT ALL ON public.reward_ratings TO service_role;
ALTER TABLE public.reward_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read reward ratings in their shops" ON public.reward_ratings
  FOR SELECT TO authenticated
  USING (public.has_membership(auth.uid(), ecosystem_id) OR public.is_super_admin(auth.uid()));

-- Rate a completed voucher purchase (one rating per sale, editable by author).
CREATE OR REPLACE FUNCTION public.rate_voucher_sale(_sale_id uuid, _rating integer, _comment text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _uid uuid := public.effective_uid(); _s public.voucher_sales; _id uuid;
begin
  if _uid is null then raise exception 'Not signed in'; end if;
  if _rating < 1 or _rating > 5 then raise exception 'Rating must be between 1 and 5'; end if;
  select * into _s from public.voucher_sales where id = _sale_id;
  if _s.id is null or _s.buyer_id <> _uid then
    raise exception 'You can only rate your own purchases';
  end if;
  if _s.refunded_at is not null then
    raise exception 'Refunded purchases cannot be rated';
  end if;

  insert into public.product_ratings (ecosystem_id, product_id, sale_id, user_id, rating, comment)
  values (_s.ecosystem_id, _s.product_id, _s.id, _uid, _rating, nullif(btrim(coalesce(_comment,'')),''))
  on conflict (sale_id) do update
    set rating = excluded.rating, comment = excluded.comment, updated_at = now()
  returning id into _id;
  return _id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rate_reward_redemption(_redemption_id uuid, _rating integer, _comment text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _uid uuid := public.effective_uid(); _r public.reward_redemptions; _id uuid;
begin
  if _uid is null then raise exception 'Not signed in'; end if;
  if _rating < 1 or _rating > 5 then raise exception 'Rating must be between 1 and 5'; end if;
  select * into _r from public.reward_redemptions where id = _redemption_id;
  if _r.id is null or _r.user_id <> _uid then
    raise exception 'You can only rate your own redemptions';
  end if;
  if _r.status <> 'claimed' then
    raise exception 'You can rate a reward once it has been claimed';
  end if;

  insert into public.reward_ratings (ecosystem_id, reward_id, redemption_id, user_id, rating, comment)
  values (_r.ecosystem_id, _r.reward_id, _r.id, _uid, _rating, nullif(btrim(coalesce(_comment,'')),''))
  on conflict (redemption_id) do update
    set rating = excluded.rating, comment = excluded.comment, updated_at = now()
  returning id into _id;
  return _id;
end;
$function$;

-- What the signed-in member may rate right now, in their active shop.
CREATE OR REPLACE FUNCTION public.my_rating_eligibility()
 RETURNS TABLE(kind text, item_id uuid, item_name text, transaction_id uuid, my_rating integer, transacted_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'voucher'::text, s.product_id, s.product_name, s.id, r.rating::int, s.created_at
    from public.voucher_sales s
    left join public.product_ratings r on r.sale_id = s.id
   where s.buyer_id = public.effective_uid()
     and s.refunded_at is null
     and s.ecosystem_id = public.active_ecosystem(public.effective_uid())
  union all
  select 'reward'::text, d.reward_id, d.reward_name, d.id, rr.rating::int, d.created_at
    from public.reward_redemptions d
    left join public.reward_ratings rr on rr.redemption_id = d.id
   where d.user_id = public.effective_uid()
     and d.status = 'claimed'
     and d.ecosystem_id = public.active_ecosystem(public.effective_uid())
  order by 6 desc
  limit 200;
$function$;

GRANT EXECUTE ON FUNCTION public.rate_voucher_sale(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rate_reward_redemption(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_rating_eligibility() TO authenticated;

-- 4. Listings expose rating aggregates and true sold counts ------------------
DROP FUNCTION IF EXISTS public.list_shop_products();
CREATE FUNCTION public.list_shop_products()
 RETURNS TABLE(id uuid, name text, description text, credit_price numeric, points_price integer, promo_price numeric, promo_note text, available integer, rating_avg numeric, rating_count integer, sold_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eco uuid;
begin
  select pr.ecosystem_id into _eco from public.profiles pr where pr.id = auth.uid();
  if _eco is null then return; end if;
  return query
    select p.id, p.name, p.description, p.credit_price, p.points_price, p.promo_price, p.promo_note,
           (select count(*)::int from public.voucher_codes c
             where c.product_id = p.id and c.status = 'unused'),
           coalesce((select round(avg(r.rating)::numeric, 2) from public.product_ratings r
                      where r.product_id = p.id), 0)::numeric,
           coalesce((select count(*)::int from public.product_ratings r
                      where r.product_id = p.id), 0),
           coalesce((select sum(s.quantity)::int from public.voucher_sales s
                      where s.product_id = p.id and s.refunded_at is null), 0)
    from public.voucher_products p
    where p.ecosystem_id = _eco and p.active and not p.archived
    order by p.credit_price;
end; $function$;

DROP FUNCTION IF EXISTS public.list_rewards();
CREATE FUNCTION public.list_rewards()
 RETURNS TABLE(id uuid, name text, description text, points_price integer, available integer, image_path text, rating_avg numeric, rating_count integer, redeemed_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eco uuid;
begin
  select pr.ecosystem_id into _eco from public.profiles pr where pr.id = auth.uid();
  if _eco is null then return; end if;
  return query
    select r.id, r.name, r.description, r.points_price,
           greatest(r.stock - r.reserved, 0), r.image_path,
           coalesce((select round(avg(g.rating)::numeric, 2) from public.reward_ratings g
                      where g.reward_id = r.id), 0)::numeric,
           coalesce((select count(*)::int from public.reward_ratings g
                      where g.reward_id = r.id), 0),
           coalesce((select count(*)::int from public.reward_redemptions d
                      where d.reward_id = r.id and d.status = 'claimed'), 0)
    from public.reward_products r
    where r.ecosystem_id = _eco and r.active and not r.archived
    order by r.points_price;
end; $function$;

GRANT EXECUTE ON FUNCTION public.list_shop_products() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_rewards() TO authenticated;