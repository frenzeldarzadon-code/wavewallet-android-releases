-- Vouchers are never cart items. Retail checkout (quote + order) only accepts
-- retail_products; any voucher_products id is refused with a clear message so a
-- crafted request can never mix the two product types in one checkout.
create or replace function public.retail_assert_cart_items(_items jsonb)
returns void
language plpgsql stable set search_path = public as $$
declare _item jsonb; _id uuid; _qty int;
begin
  if _items is null or jsonb_typeof(_items) <> 'array' then return; end if;
  for _item in select * from jsonb_array_elements(_items) loop
    _qty := greatest(coalesce((_item->>'quantity')::int, 0), 0);
    if _qty = 0 then continue; end if;
    begin
      _id := (_item->>'product_id')::uuid;
    exception when others then
      raise exception 'Invalid cart item';
    end;
    if _id is null then raise exception 'Invalid cart item'; end if;
    if exists (select 1 from public.voucher_products v where v.id = _id) then
      raise exception 'Vouchers cannot be added to a cart. Buy vouchers directly from the shop''s voucher list.';
    end if;
  end loop;
end $$;
revoke all on function public.retail_assert_cart_items(jsonb) from public, anon;
grant execute on function public.retail_assert_cart_items(jsonb) to authenticated, service_role;

-- Patch the live retail_place_order in place (keeps every other rule byte-identical).
do $$
declare _def text; _marker text := E'raise exception ''Your cart is empty'';\n  end if;\n\n  _pct := round(public.retail_platform_fee_percent(), 2);';
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'retail_place_order';
  if _def is null or position(_marker in _def) = 0 then
    raise exception 'retail_place_order marker not found; refusing to patch';
  end if;
  if position('retail_assert_cart_items' in _def) = 0 then
    _def := replace(_def, _marker,
      E'raise exception ''Your cart is empty'';\n  end if;\n  perform public.retail_assert_cart_items(_items);\n\n  _pct := round(public.retail_platform_fee_percent(), 2);');
    execute _def;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.retail_checkout_quote(_ecosystem_id uuid, _items jsonb, _seller_id uuid DEFAULT NULL::uuid, _payment_method text DEFAULT 'credit'::text)
 RETURNS TABLE(total numeric, self_cashback numeric, buyer_charge numeric, self_purchase boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := public.effective_uid();
  _item jsonb; _p record; _qty int; _pct numeric(6,2); _unit numeric(12,2); _wholesale boolean;
  _seller_line numeric(14,2); _fee_line numeric(14,2);
  _total numeric(14,2) := 0; _cb numeric(14,2) := 0; _seller_total numeric(14,2) := 0;
  _self boolean := false; _seller uuid;
begin
  if _uid is null then return query select 0::numeric, 0::numeric, 0::numeric, false; return; end if;
  if _seller_id is not null and _seller_id <> _uid then _seller := _seller_id; end if;
  _self := public.retail_is_self_purchase(_uid, _seller, _ecosystem_id, _payment_method);
  _pct := round(public.retail_platform_fee_percent(), 2);
  if _items is null or jsonb_typeof(_items) <> 'array' then
    return query select 0::numeric, 0::numeric, 0::numeric, _self; return;
  end if;
  perform public.retail_assert_cart_items(_items);
  for _item in select * from jsonb_array_elements(_items) loop
    _qty := greatest(coalesce((_item->>'quantity')::int, 0), 0);
    if _qty = 0 then continue; end if;
    select * into _p from public.retail_products
     where id = (_item->>'product_id')::uuid and ecosystem_id = _ecosystem_id
       and active and published and not archived;
    if _p is null then continue; end if;
    _wholesale := coalesce(_p.wholesale_price, 0) > 0 and coalesce(_p.wholesale_min_qty, 0) > 0 and _qty >= _p.wholesale_min_qty;
    _unit := case when _wholesale then _p.wholesale_price else _p.price end;
    _seller_line := round(_unit * _qty, 2);
    _fee_line := round(_seller_line * _pct / 100, 2);
    _total := _total + _seller_line + _fee_line;
    _seller_total := _seller_total + _seller_line;
    if _self then
      _cb := _cb + public.retail_line_cashback(_p.cashback_mode, _p.cashback_value, _seller_line, _qty);
    end if;
  end loop;
  _cb := least(_cb, _seller_total, _total);
  return query select _total, _cb, round(_total - _cb, 2), _self;
end $function$;