CREATE OR REPLACE FUNCTION public.update_credit_purchase_settings(
  _admin_credit_discount_percent integer,
  _credit_gcash_number text,
  _credit_gcash_account_name text,
  _credit_payment_instructions text,
  _credit_release_mode text,
  _default_admin_sale_commission_percent integer,
  _admin_voucher_discount_percent integer DEFAULT NULL
)
 RETURNS platform_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.platform_settings;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can change platform settings';
  end if;
  if _credit_release_mode not in ('manual','auto') then
    raise exception 'Unsupported release mode';
  end if;
  update public.platform_settings
     set admin_credit_discount_percent = greatest(0, least(100, coalesce(_admin_credit_discount_percent,100))),
         credit_gcash_number = coalesce(btrim(_credit_gcash_number),''),
         credit_gcash_account_name = coalesce(btrim(_credit_gcash_account_name),''),
         credit_payment_instructions = coalesce(btrim(_credit_payment_instructions),''),
         credit_release_mode = _credit_release_mode,
         default_admin_sale_commission_percent =
           greatest(0, least(100, coalesce(_default_admin_sale_commission_percent,0))),
         admin_voucher_discount_percent =
           greatest(0, least(100, coalesce(_admin_voucher_discount_percent, admin_voucher_discount_percent))),
         updated_by = auth.uid()
   where id = 1 returning * into _row;
  return _row;
end; $function$;