alter table public.platform_settings alter column retail_platform_fee_percent set default 0;
update public.platform_settings set retail_platform_fee_percent = 0 where id = 1 and retail_platform_fee_percent = 1;

create or replace function public.set_platform_money_settings(
  _cashback_reseller integer, _cashback_subreseller integer, _credits_per_unit numeric,
  _php_per_unit numeric, _withdrawal_fee numeric, _shop_transfer_fee numeric default null,
  _cash_in_fee numeric default null, _retail_fee numeric default null)
returns platform_settings
language plpgsql security definer set search_path = public
as $function$
declare _row public.platform_settings; _prev public.platform_settings; _actor text;
        _fee numeric; _cin numeric; _rfee numeric;
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
  _rfee := coalesce(_retail_fee, _prev.retail_platform_fee_percent, 0);
  if _rfee < 0 or _rfee > 100 then
    raise exception 'The retail platform fee must be between 0%% and 100%%';
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
              'retail_platform_fee_percent', _prev.retail_platform_fee_percent),
            'new', jsonb_build_object(
              'cashback_reseller_percent', _cashback_reseller,
              'cashback_subreseller_percent', _cashback_subreseller,
              'cash_out_credits_per_unit', _credits_per_unit,
              'cash_out_php_per_unit', _php_per_unit,
              'withdrawal_fee_percent', _withdrawal_fee,
              'cash_in_fee_percent', _cin,
              'shop_transfer_fee_credits', _fee,
              'retail_platform_fee_percent', _rfee),
            'applies_to', 'future transactions only'));
  return _row;
end $function$;