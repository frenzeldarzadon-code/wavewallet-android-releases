create or replace function public.update_store_settings(
  _ecosystem_id uuid,
  _voucher_enabled boolean,
  _retail_enabled boolean,
  _cash_enabled boolean,
  _credit_enabled boolean,
  _pickup_enabled boolean,
  _delivery_enabled boolean,
  _public_storefront boolean
)
returns table (
  voucher_enabled boolean,
  retail_enabled boolean,
  cash_enabled boolean,
  credit_enabled boolean,
  pickup_enabled boolean,
  delivery_enabled boolean,
  public_storefront boolean,
  seeded integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.ecosystems; _actor text; _seeded integer := 0; _existing integer;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this shop';
  end if;

  if _retail_enabled and not (_cash_enabled or _credit_enabled) then
    raise exception 'Enable at least one retail payment method (cash or shop coins)';
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

  -- Turning the retail store on for the first time loads the shared starter
  -- catalog as unpublished drafts for THIS shop only. Nothing is published and
  -- no existing product is touched.
  if _row.store_retail_enabled then
    select count(*) into _existing from public.retail_products where ecosystem_id = _ecosystem_id;
    if _existing = 0 then
      insert into public.retail_products
        (ecosystem_id, template_id, name, description, category, brand, variant, size_label, unit,
         price, wholesale_price, stock, sku, active, published, public_visible)
      select _ecosystem_id, t.id, t.name, t.description, t.category, t.brand, t.variant, t.size_label,
             t.unit, 0, 0, 0, t.sku, true, false, true
        from public.retail_catalog_templates t
       where t.active;
      get diagnostics _seeded = row_count;
    end if;
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

revoke all on function public.update_store_settings(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.update_store_settings(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;