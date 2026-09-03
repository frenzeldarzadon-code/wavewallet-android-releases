CREATE OR REPLACE FUNCTION public.retail_order_items_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if TG_OP = 'UPDATE' then
    raise exception 'Retail order items are an immutable snapshot';
  end if;
  -- Inside a BEFORE trigger pg_trigger_depth() is 1 for a direct statement.
  -- FK cascades (shop purge) arrive through the RI trigger, i.e. depth > 1.
  if TG_OP = 'DELETE' and pg_trigger_depth() <= 1 then
    raise exception 'Retail order items cannot be deleted';
  end if;
  return coalesce(NEW, OLD);
end $function$;