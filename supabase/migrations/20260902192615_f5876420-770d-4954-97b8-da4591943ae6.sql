-- 1. Storefront exposes points_price (public product field; no hierarchy/rates).
drop function if exists public.seller_storefront(text);
create or replace function public.seller_storefront(_handle text)
 returns table(seller_id uuid, seller_name text, seller_handle text, avatar_path text, store_name text, shop_id uuid, shop_name text, shop_slug text, product_id uuid, product_name text, description text, price numeric, available integer, points_price integer)
 language sql stable security definer set search_path to 'public'
as $function$
  with seller as (
    select p.id, p.full_name, p.handle, p.avatar_path,
           coalesce(nullif(btrim(p.preferences->>'storefront_name'), ''), p.full_name || '''s Store') as store_name
      from public.profiles p
     where lower(p.handle) = lower(ltrim(_handle, '@')) and p.deleted_at is null and p.status = 'active'
  )
  select s.id, s.full_name, s.handle, s.avatar_path, s.store_name,
         e.id, e.name, e.slug,
         v.id, v.name, v.description, coalesce(v.promo_price, v.credit_price),
         (select count(*)::int from public.voucher_codes c where c.product_id = v.id and c.status = 'unused'),
         v.points_price
    from seller s
    join public.shop_seller_authorizations a on a.user_id = s.id and a.active
    join public.ecosystems e on e.id = a.ecosystem_id
         and e.shop_kind = 'universe' and e.archived_at is null
         and e.public_storefront_enabled and e.store_voucher_enabled
         and (not e.is_test or public.can_see_test_shop(e.id))
    join public.voucher_products v on v.ecosystem_id = e.id and v.active and not v.archived
   order by e.name, v.name;
$function$;
grant execute on function public.seller_storefront(text) to anon, authenticated;

-- 2. Points purchase: Universe vouchers use the SELLING shop's points account (membership-free).
drop function if exists public.purchase_voucher_with_points(uuid);
create or replace function public.purchase_voucher_with_points(_product_id uuid, _seller_id uuid default null)
 returns table(tx_id text, code text, points_spent integer, product_name text, sale_id uuid)
 language plpgsql security definer set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _my_eco uuid; _p public.voucher_products; _pacct uuid; _role public.app_role;
        _code public.voucher_codes; _tx text; _sale uuid; _status public.account_status; _pts integer;
        _universe boolean := false; _seller uuid := null; _reseller uuid := null;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  perform public.require_operational();

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null then raise exception 'Product not available'; end if;
  _universe := public.is_universe_shop(_p.ecosystem_id);

  select ecosystem_id, status into _my_eco, _status from public.profiles where id = _subject and deleted_at is null;
  if _status is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;

  if _universe then
    -- Universe shop: points and rewards stay scoped to the SELLING shop; no membership needed.
    _my_eco := _p.ecosystem_id;
    if _seller_id is not null and _seller_id <> _subject then
      if not exists (select 1 from public.shop_seller_authorizations a
                      where a.user_id = _seller_id and a.ecosystem_id = _my_eco and a.active) then
        raise exception 'That seller is not authorized to sell this voucher';
      end if;
      _seller := _seller_id;
    end if;
  else
    if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
    if _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  end if;

  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;
  if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then
    raise exception 'This shop is temporarily frozen by the platform owner';
  end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;
  _pts := _p.points_price;
  if _pts is null or _pts <= 0 then raise exception 'This voucher cannot be bought with points'; end if;

  if _universe then
    select m.role into _role from public.ecosystem_memberships m
     where m.user_id = _subject and m.ecosystem_id = _my_eco and m.membership_state = 'active';
  else
    select role into _role from public.user_roles where user_id = _subject
     order by case role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
    select reseller_id into _reseller from public.profiles where id = _subject;
  end if;

  select * into _code from public.voucher_codes
   where product_id = _product_id and status = 'unused'
   order by created_at for update skip locked limit 1;
  if _code.id is null then raise exception 'No voucher codes are available for this product'; end if;

  select id into _pacct from public.points_accounts where user_id = _subject and ecosystem_id = _my_eco;
  if _pacct is null then raise exception 'You have no points in this shop yet'; end if;

  _tx := public.new_tx_id();

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned, seller_id)
  values (_my_eco, _p.id, _p.name, _subject, coalesce(_role,'customer'),
          _reseller,
          coalesce(_p.promo_price, _p.credit_price), 0, 0, 0, 'points', _tx, _pts, _pts, 0, _seller)
  returning id into _sale;

  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id)
  values (_pacct, _subject, _my_eco, 'debit', _pts, 0,
          'Voucher purchase — ' || _p.name, _tx, _op, _tx, 'spend', _sale);

  update public.voucher_codes
     set status = 'sold', sold_to = _subject, sale_id = _sale, sold_at = now()
   where id = _code.id and status = 'unused';
  if not found then raise exception 'That voucher code was just sold. Please try again.'; end if;

  perform public.log_operator_action(_subject, _my_eco, 'Voucher purchase (points)', 'voucher_sale', _sale, jsonb_build_object('product', _p.name, 'points_spent', _pts, 'tx_id', _tx, 'seller_id', _seller));
  return query select _tx, _code.code, _pts, _p.name, _sale;
end; $function$;
grant execute on function public.purchase_voucher_with_points(uuid, uuid) to authenticated;

-- 3. Rewards list: optional explicit Universe shop context.
drop function if exists public.list_rewards();
create or replace function public.list_rewards(_ecosystem_id uuid default null)
 returns table(id uuid, name text, description text, points_price integer, available integer, image_path text, rating_avg numeric, rating_count integer, redeemed_count integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare _eco uuid;
begin
  if _ecosystem_id is not null then
    if not public.is_universe_shop(_ecosystem_id) then return; end if;
    _eco := _ecosystem_id;
  else
    select pr.ecosystem_id into _eco from public.profiles pr where pr.id = auth.uid();
  end if;
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
grant execute on function public.list_rewards(uuid) to authenticated;

-- 4. Redemption request: reward of a Universe shop uses that shop's points account.
create or replace function public.request_redemption(_reward_id uuid)
 returns table(id uuid, code text, reward_name text, points_price integer, status text, tx_id text)
 language plpgsql security definer set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _my_eco uuid; _r public.reward_products; _acct uuid; _tx text;
        _code text; _red uuid; _status public.account_status; _me text;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  perform public.require_operational();
  select p.ecosystem_id, p.status, p.full_name into _my_eco, _status, _me
    from public.profiles p where p.id = _subject;
  if _status is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;

  select rp.* into _r from public.reward_products rp where rp.id = _reward_id for update;
  if _r.id is null then raise exception 'Reward not available'; end if;
  if public.is_universe_shop(_r.ecosystem_id) then
    _my_eco := _r.ecosystem_id;  -- shop-scoped points, no membership needed
  else
    if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
    if _r.ecosystem_id <> _my_eco then raise exception 'Reward not available'; end if;
  end if;
  if not _r.active or _r.archived then raise exception 'This reward is not available right now'; end if;
  if (_r.stock - _r.reserved) < 1 then raise exception 'This reward is out of stock'; end if;

  select pa.id into _acct from public.points_accounts pa where pa.user_id = _subject and pa.ecosystem_id = _my_eco;
  if _acct is null then raise exception 'You have no points in this shop yet'; end if;

  update public.reward_products rp set reserved = rp.reserved + 1 where rp.id = _r.id;

  _tx := public.new_tx_id();
  _code := 'RDM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));

  insert into public.reward_redemptions (ecosystem_id, reward_id, reward_name, points_price,
                                         user_id, user_name, code, status, tx_id, reward_image_path)
  values (_my_eco, _r.id, _r.name, _r.points_price, _subject, coalesce(_me,''), _code, 'pending', _tx, _r.image_path)
  returning reward_redemptions.id into _red;

  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type, redemption_id)
  values (_acct, _subject, _my_eco, 'debit', _r.points_price, 0,
          'Points held — ' || _r.name, _code, _op, _tx, 'hold', _red);

  perform public.log_operator_action(_subject, _my_eco, 'Reward redemption request', 'reward_redemption', _red, jsonb_build_object('reward', _r.name, 'points_price', _r.points_price, 'tx_id', _tx));
  return query select _red, _code, _r.name, _r.points_price, 'pending'::text, _tx;
end; $function$;

-- 5. Reward images of Universe shops are viewable by signed-in members.
drop policy if exists "Members view Universe shop reward images" on storage.objects;
create policy "Members view Universe shop reward images" on storage.objects
  for select to authenticated
  using (bucket_id = 'reward-images'
         and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
         and public.is_universe_shop(((storage.foldername(name))[1])::uuid));