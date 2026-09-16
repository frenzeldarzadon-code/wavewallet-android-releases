do $mig$
declare _src text; _new text;
begin
  -- purchase_voucher: no points and no admin point cost while rewards are OFF
  _src := pg_get_functiondef('public.purchase_voucher(uuid,integer,uuid)'::regprocedure);
  _new := _src;
  _new := replace(_new,
    '_pt_cost numeric(14,2) := 0; _benefit numeric(14,2) := 0;',
    '_pt_cost numeric(14,2) := 0; _benefit numeric(14,2) := 0; _pts_on boolean := true;');
  _new := replace(_new,
    'if coalesce(_ratio,0) > 0 then _earn := round(_total / _ratio, 2); end if;',
    '_pts_on := public.shop_points_enabled(_my_eco);
  if _pts_on and coalesce(_ratio,0) > 0 then _earn := round(_total / _ratio, 2); end if;');
  _new := replace(_new,
    'case when _pacct is null then 0 else coalesce(_ratio,0) end',
    'case when _pacct is null or not _pts_on then 0 else coalesce(_ratio,0) end');
  if _new = _src then raise exception 'purchase_voucher patch did not apply'; end if;
  execute _new;

  -- voucher_checkout_quote: mirror the same admin point-cost rule
  _src := pg_get_functiondef('public.voucher_checkout_quote(uuid,integer,uuid)'::regprocedure);
  _new := replace(_src,
    'from public.voucher_admin_self_net(_total, _fee, _other, coalesce(_ratio,0)) n;',
    'from public.voucher_admin_self_net(_total, _fee, _other,
             case when public.shop_points_enabled(_eco) then coalesce(_ratio,0) else 0 end) n;');
  if _new = _src then raise exception 'voucher_checkout_quote patch did not apply'; end if;
  execute _new;
end $mig$;