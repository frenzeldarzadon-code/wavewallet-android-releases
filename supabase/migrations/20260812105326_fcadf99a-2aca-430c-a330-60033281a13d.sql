REVOKE EXECUTE ON FUNCTION public.can_load_credits(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.promote_to_subreseller(uuid, integer, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.purchase_voucher(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reverse_sale_commission(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sale_commission_rate_for(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_ecosystem_sale_commission(uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_sale_commission(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_subreseller_parent(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.slugify(text) FROM anon;

CREATE OR REPLACE FUNCTION public.block_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if current_setting('wavewallet.retention_purge', true) = 'on' then
    return coalesce(old, new);
  end if;
  raise exception 'Ledger entries are immutable';
end;
$function$;