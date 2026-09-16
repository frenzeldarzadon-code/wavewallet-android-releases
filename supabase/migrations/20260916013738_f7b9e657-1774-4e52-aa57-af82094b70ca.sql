do $mig$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'voucher_checkout_quote'
   limit 1;
  if d is null then raise exception 'voucher_checkout_quote not found'; end if;
  if position('public.shop_points_enabled(_eco)' in d) > 0 then return; end if;
  d := replace(
    d,
    'return query select _total, _cb, _charge, _self, case when _self then _pct else 0 end, _fee, _pts;',
    'if not public.shop_points_enabled(_eco) then _pts := 0; end if;
  return query select _total, _cb, _charge, _self, case when _self then _pct else 0 end, _fee, _pts;'
  );
  if position('public.shop_points_enabled(_eco)' in d) = 0 then
    raise exception 'could not patch voucher_checkout_quote';
  end if;
  execute d;
end $mig$;