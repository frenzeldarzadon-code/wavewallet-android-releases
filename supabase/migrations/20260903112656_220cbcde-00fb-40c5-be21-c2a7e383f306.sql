-- =====================================================================
-- A) Retail platform fee: agreed default is 1 % (product price only).
--    Historical orders carry their own platform_fee_percent snapshot and are
--    never touched here.
-- =====================================================================
alter table public.platform_settings alter column retail_platform_fee_percent set default 1;

do $$
declare _prev numeric;
begin
  select retail_platform_fee_percent into _prev from public.platform_settings where id = 1;
  if _prev = 0 then
    update public.platform_settings
       set retail_platform_fee_percent = 1, updated_at = now()
     where id = 1;
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (null, null, 'System migration', 'Updated platform money settings', 'Platform settings',
            jsonb_build_object(
              'previous', jsonb_build_object('retail_platform_fee_percent', _prev),
              'new', jsonb_build_object('retail_platform_fee_percent', 1),
              'reason', 'Agreed Retail platform fee default is 1 %; earlier R2 correction had set 0 %',
              'applies_to', 'future transactions only'));
  end if;
end $$;

create or replace function public.retail_platform_fee_percent()
returns numeric
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select retail_platform_fee_percent from public.platform_settings where id = 1), 1)::numeric;
$function$;

create or replace function public.set_platform_money_settings(
  _cashback_reseller integer, _cashback_subreseller integer, _credits_per_unit numeric,
  _php_per_unit numeric, _withdrawal_fee numeric, _shop_transfer_fee numeric default null,
  _cash_in_fee numeric default null, _retail_fee numeric default null, _voucher_fee numeric default null)
returns platform_settings
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.platform_settings; _prev public.platform_settings; _actor text;
        _fee numeric; _cin numeric; _rfee numeric; _vfee numeric;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can change money settings';
  end if;
  if _cashback_reseller is null or _cashback_subreseller is null
     or _cashback_reseller < 0 or _cashback_subreseller < 0 then
    raise exception 'Cashback percentages must be zero or more';
  end if;
  if _cashback_reseller + _cashback_subreseller > 100 then
    raise exception 'Reseller + subreseller cashback cannot exceed 100%%';
  end if;
  if coalesce(_credits_per_unit,0) <= 0 or coalesce(_php_per_unit,0) <= 0 then
    raise exception 'The credit valuation must use positive amounts';
  end if;
  if _withdrawal_fee is null or _withdrawal_fee < 0 or _withdrawal_fee > 100 then
    raise exception 'The cash out fee must be between 0%% and 100%%';
  end if;

  select * into _prev from public.platform_settings where id = 1;
  _fee := coalesce(_shop_transfer_fee, _prev.shop_transfer_fee_credits, 5);
  if _fee < 0 then raise exception 'The shop transfer fee cannot be negative'; end if;
  _cin := coalesce(_cash_in_fee, _prev.cash_in_fee_percent, 0);
  if _cin < 0 or _cin > 100 then
    raise exception 'The cash in fee must be between 0%% and 100%%';
  end if;
  _rfee := coalesce(_retail_fee, _prev.retail_platform_fee_percent, 1);
  if _rfee < 0 or _rfee > 100 then
    raise exception 'The retail platform fee must be between 0%% and 100%%';
  end if;

  _vfee := coalesce(_voucher_fee, _prev.voucher_platform_fee_percent, 1);
  if _vfee < 0 or _vfee > 100 then
    raise exception 'The voucher platform fee must be between 0%% and 100%%';
  end if;

  update public.platform_settings
     set cashback_reseller_percent = _cashback_reseller,
         cashback_subreseller_percent = _cashback_subreseller,
         cash_out_credits_per_unit = _credits_per_unit,
         cash_out_php_per_unit = _php_per_unit,
         withdrawal_fee_percent = _withdrawal_fee,
         shop_transfer_fee_credits = _fee,
         cash_in_fee_percent = _cin,
         retail_platform_fee_percent = _rfee,
         voucher_platform_fee_percent = _vfee,
         updated_at = now(), updated_by = auth.uid()
   where id = 1
   returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce(_actor,'Super Admin'), 'Updated platform money settings', 'Platform settings',
          jsonb_build_object(
            'previous', jsonb_build_object(
              'cashback_reseller_percent', _prev.cashback_reseller_percent,
              'cashback_subreseller_percent', _prev.cashback_subreseller_percent,
              'cash_out_credits_per_unit', _prev.cash_out_credits_per_unit,
              'cash_out_php_per_unit', _prev.cash_out_php_per_unit,
              'withdrawal_fee_percent', _prev.withdrawal_fee_percent,
              'cash_in_fee_percent', _prev.cash_in_fee_percent,
              'shop_transfer_fee_credits', _prev.shop_transfer_fee_credits,
              'retail_platform_fee_percent', _prev.retail_platform_fee_percent,
              'voucher_platform_fee_percent', _prev.voucher_platform_fee_percent),
            'new', jsonb_build_object(
              'cashback_reseller_percent', _cashback_reseller,
              'cashback_subreseller_percent', _cashback_subreseller,
              'cash_out_credits_per_unit', _credits_per_unit,
              'cash_out_php_per_unit', _php_per_unit,
              'withdrawal_fee_percent', _withdrawal_fee,
              'cash_in_fee_percent', _cin,
              'shop_transfer_fee_credits', _fee,
              'retail_platform_fee_percent', _rfee,
              'voucher_platform_fee_percent', _vfee),
            'applies_to', 'future transactions only'));
  return _row;
end $function$;

-- =====================================================================
-- B) Shop type — derived from the existing shop record (shop_kind + store
--    flags). No new table, no new column.
--      new_generation   shop_kind = 'subscription' (isolated shop wallets)
--      universe_voucher shop_kind universe/legacy, voucher on, retail off
--      universe_retail  shop_kind universe/legacy, retail on, voucher off
--      universe_mixed / universe_unset  legacy states needing admin confirmation
-- =====================================================================
create or replace function public.shop_type(_ecosystem_id uuid)
returns text
language sql stable security definer set search_path to 'public'
as $function$
  select case
           when e.shop_kind = 'subscription' then 'new_generation'
           when e.store_retail_enabled and not e.store_voucher_enabled then 'universe_retail'
           when e.store_voucher_enabled and not e.store_retail_enabled then 'universe_voucher'
           when e.store_voucher_enabled and e.store_retail_enabled then 'universe_mixed'
           else 'universe_unset'
         end
    from public.ecosystems e where e.id = _ecosystem_id;
$function$;
revoke all on function public.shop_type(uuid) from public, anon;
grant execute on function public.shop_type(uuid) to authenticated, service_role;

-- Switch a Universe shop between Voucher and Retail. New Generation shops are
-- isolated by wallet model and never convert; a Retail shop with open orders
-- cannot be switched away from Retail.
create or replace function public.set_shop_type(_ecosystem_id uuid, _shop_type text)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare _eco public.ecosystems; _actor text; _open integer := 0; _seeded integer := 0; _before text;
begin
  perform public.assert_actor_active();
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this shop';
  end if;
  select * into _eco from public.ecosystems where id = _ecosystem_id for update;
  if _eco.id is null then raise exception 'Shop not found'; end if;
  if _eco.archived_at is not null then raise exception 'This shop is archived'; end if;
  _before := public.shop_type(_ecosystem_id);

  if _shop_type not in ('universe_voucher','universe_retail') then
    raise exception 'A shop is either New Generation, Universe Voucher or Universe Retail';
  end if;
  if _eco.shop_kind = 'subscription' then
    raise exception 'A New Generation shop stays isolated from Universe commerce — its type cannot be changed';
  end if;
  if _before = _shop_type then return _before; end if;

  if _shop_type = 'universe_voucher' then
    select count(*) into _open from public.retail_orders o
     where o.ecosystem_id = _ecosystem_id
       and (o.status = 'pending'
            or (o.status = 'approved' and o.fulfillment_status not in ('completed','closed')));
    if _open > 0 then
      raise exception 'Finish or cancel % open retail order(s) before switching this shop to Vouchers', _open;
    end if;
    update public.ecosystems
       set store_voucher_enabled = true, store_retail_enabled = false, updated_at = now()
     where id = _ecosystem_id;
  else
    if not (_eco.retail_cash_enabled or _eco.retail_credit_enabled) then
      raise exception 'Enable at least one retail payment method (cash or coins) first';
    end if;
    update public.ecosystems
       set store_voucher_enabled = false, store_retail_enabled = true, updated_at = now()
     where id = _ecosystem_id;
    -- Same starter catalog behaviour as turning the retail store on.
    if not exists (select 1 from public.retail_products p where p.ecosystem_id = _ecosystem_id) then
      _seeded := public.seed_retail_catalog(_ecosystem_id);
    end if;
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Changed shop type', _eco.name,
          jsonb_build_object('from', _before, 'to', _shop_type, 'seeded', _seeded));
  return _shop_type;
end $function$;
revoke all on function public.set_shop_type(uuid, text) from public, anon;
grant execute on function public.set_shop_type(uuid, text) to authenticated, service_role;

-- Members create Universe shops themselves (Voucher or Retail). No one-shop
-- limit: a member may run several shops, each with its own admin membership.
create or replace function public.create_universe_shop(_name text, _shop_type text, _description text default null)
returns ecosystems
language plpgsql security definer set search_path to 'public'
as $function$
declare _uid uuid := auth.uid(); _base text; _candidate text; _n int := 1;
        _row public.ecosystems; _me text; _seeded integer := 0;
begin
  if _uid is null then raise exception 'Sign in to create a shop'; end if;
  perform public.assert_actor_active();
  if public.acting_as() is not null then
    raise exception 'Shops cannot be created while acting as another member';
  end if;
  if coalesce(trim(_name),'') = '' or length(trim(_name)) < 3 then
    raise exception 'Give your shop a name (at least 3 characters)';
  end if;
  if _shop_type not in ('universe_voucher','universe_retail') then
    raise exception 'Choose Universe Voucher or Universe Retail';
  end if;

  _base := public.slugify(_name);
  if _base = '' then _base := 'shop'; end if;
  _candidate := _base;
  while exists (select 1 from public.ecosystems where slug = _candidate) loop
    _n := _n + 1;
    _candidate := _base || '-' || _n;
  end loop;

  insert into public.ecosystems
    (name, slug, description, shop_kind, store_voucher_enabled, store_retail_enabled,
     plan_name, plan_price, grace_period_days, signup_enabled,
     subscription_state, current_period_end, public_storefront_enabled)
  values
    (trim(_name), _candidate, nullif(trim(_description),''), 'universe',
     _shop_type = 'universe_voucher', _shop_type = 'universe_retail',
     'Starter', 0, 0, true, 'active', null, true)
  returning * into _row;

  insert into public.ecosystem_memberships
    (user_id, ecosystem_id, role, status, membership_state, joined_at)
  values (_uid, _row.id, 'admin', 'active', 'active', now())
  on conflict do nothing;

  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_uid, 'admin', _row.id)
  on conflict do nothing;

  update public.profiles set ecosystem_id = coalesce(ecosystem_id, _row.id) where id = _uid;
  perform public.ensure_global_wallet(_uid);

  if _shop_type = 'universe_retail' then
    _seeded := public.seed_retail_catalog(_row.id);
  end if;

  select full_name into _me from public.profiles where id = _uid;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.id, _uid, coalesce(_me,'Member'), 'Created shop', _row.name,
          jsonb_build_object('slug', _row.slug, 'shop_type', _shop_type, 'seeded', _seeded));
  return _row;
end $function$;
revoke all on function public.create_universe_shop(text, text, text) from public, anon;
grant execute on function public.create_universe_shop(text, text, text) to authenticated, service_role;

-- Super Admin creation: explicit shop type. Starter catalog only for Retail.
drop function if exists public.create_ecosystem(text, text, text, text, text, text, numeric, integer, boolean);
create or replace function public.create_ecosystem(
  _name text, _slug text default null, _description text default null,
  _contact_email text default null, _contact_phone text default null,
  _plan_name text default 'Starter', _plan_price numeric default 0,
  _grace_period_days integer default 5, _signup_enabled boolean default true,
  _shop_type text default 'new_generation')
returns ecosystems
language plpgsql security definer set search_path to 'public'
as $function$
declare
  _base text; _candidate text; _n integer := 1; _row public.ecosystems; _actor text; _kind text;
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
  if _shop_type not in ('new_generation','universe_voucher','universe_retail') then
    raise exception 'A shop is either New Generation, Universe Voucher or Universe Retail';
  end if;
  _kind := case when _shop_type = 'new_generation' then 'subscription' else 'universe' end;

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
     subscription_state, current_period_end, shop_kind,
     store_voucher_enabled, store_retail_enabled)
  values
    (trim(_name), _candidate, nullif(trim(_description),''),
     nullif(lower(trim(_contact_email)),''), nullif(trim(_contact_phone),''),
     coalesce(nullif(trim(_plan_name),''), 'Starter'), _plan_price,
     _grace_period_days, coalesce(_signup_enabled, true),
     'active', null, _kind,
     _shop_type <> 'universe_retail', _shop_type = 'universe_retail')
  returning * into _row;

  if _shop_type = 'universe_retail' then
    perform public.seed_retail_catalog(_row.id);
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.id, auth.uid(), coalesce(_actor,'Super admin'), 'Created shop', _row.name,
          jsonb_build_object('slug', _row.slug, 'status', 'active', 'shop_type', _shop_type));
  return _row;
end;
$function$;
revoke all on function public.create_ecosystem(text, text, text, text, text, text, numeric, integer, boolean, text) from public, anon;
grant execute on function public.create_ecosystem(text, text, text, text, text, text, numeric, integer, boolean, text) to authenticated, service_role;

-- A Universe shop is one type at a time; the type switch is set_shop_type.
create or replace function public.update_store_settings(
  _ecosystem_id uuid, _voucher_enabled boolean, _retail_enabled boolean, _cash_enabled boolean,
  _credit_enabled boolean, _pickup_enabled boolean, _delivery_enabled boolean, _public_storefront boolean)
returns table(voucher_enabled boolean, retail_enabled boolean, cash_enabled boolean, credit_enabled boolean,
              pickup_enabled boolean, delivery_enabled boolean, public_storefront boolean, seeded integer)
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.ecosystems; _actor text; _seeded integer := 0; _kind text;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this shop';
  end if;

  if _retail_enabled and not (_cash_enabled or _credit_enabled) then
    raise exception 'Enable at least one retail payment method (cash or shop coins)';
  end if;

  select shop_kind into _kind from public.ecosystems where id = _ecosystem_id;
  if _kind <> 'subscription' and coalesce(_voucher_enabled, false) and coalesce(_retail_enabled, false) then
    raise exception 'A Universe shop is either a Voucher shop or a Retail shop — change the Shop type instead';
  end if;

  update public.ecosystems
     set store_voucher_enabled    = coalesce(_voucher_enabled, store_voucher_enabled),
         store_retail_enabled     = coalesce(_retail_enabled, store_retail_enabled),
         retail_cash_enabled      = coalesce(_cash_enabled, retail_cash_enabled),
         retail_credit_enabled    = coalesce(_credit_enabled, retail_credit_enabled),
         retail_pickup_enabled    = coalesce(_pickup_enabled, retail_pickup_enabled),
         retail_delivery_enabled  = coalesce(_delivery_enabled, retail_delivery_enabled),
         public_storefront_enabled= coalesce(_public_storefront, public_storefront_enabled)
   where id = _ecosystem_id
  returning * into _row;

  if _row.id is null then raise exception 'Shop not found'; end if;

  if _row.store_retail_enabled then
    insert into public.retail_products
      (ecosystem_id, template_id, name, description, category, brand, variant, size_label, unit,
       image_path, price, wholesale_price, wholesale_min_qty, stock, sku, active, published, public_visible)
    select _ecosystem_id, t.id, t.name, t.description, t.category, t.brand, t.variant, t.size_label,
           t.unit, t.image_path, t.default_price, t.default_wholesale_price, t.wholesale_min_qty,
           0, t.sku, true, false, true
      from public.retail_catalog_templates t
     where t.active
       and not exists (select 1 from public.retail_products p
                        where p.ecosystem_id = _ecosystem_id and p.template_id = t.id);
    get diagnostics _seeded = row_count;

    update public.retail_products p
       set image_path = t.image_path
      from public.retail_catalog_templates t
     where p.template_id = t.id
       and p.ecosystem_id = _ecosystem_id
       and p.image_path is null
       and t.image_path is not null;
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Updated store settings', _row.name,
          jsonb_build_object('voucher', _row.store_voucher_enabled,
                             'retail', _row.store_retail_enabled,
                             'seeded', _seeded));

  return query select _row.store_voucher_enabled, _row.store_retail_enabled,
                      _row.retail_cash_enabled, _row.retail_credit_enabled,
                      _row.retail_pickup_enabled, _row.retail_delivery_enabled,
                      _row.public_storefront_enabled, _seeded;
end;
$function$;