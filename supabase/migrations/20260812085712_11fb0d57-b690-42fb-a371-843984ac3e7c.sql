CREATE OR REPLACE FUNCTION public.list_shop_products()
 RETURNS TABLE(id uuid, name text, description text, credit_price numeric, points_price integer, promo_price numeric, promo_note text, available integer)
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
             where c.product_id = p.id and c.status = 'unused')
    from public.voucher_products p
    where p.ecosystem_id = _eco and p.active and not p.archived
    order by p.credit_price;
end; $function$;

CREATE OR REPLACE FUNCTION public.list_rewards()
 RETURNS TABLE(id uuid, name text, description text, points_price integer, available integer, image_path text)
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
           greatest(r.stock - r.reserved, 0), r.image_path
    from public.reward_products r
    where r.ecosystem_id = _eco and r.active and not r.archived
    order by r.points_price;
end; $function$;