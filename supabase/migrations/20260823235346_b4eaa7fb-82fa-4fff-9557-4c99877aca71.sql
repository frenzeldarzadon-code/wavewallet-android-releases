DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.purchase_voucher(uuid,integer)'::regprocedure);
  n := replace(d, 'if _qty < 1 or _qty > 50 then raise exception ''Choose between 1 and 50 vouchers''; end if;',
                  'if _qty < 1 or _qty > 500 then raise exception ''Choose between 1 and 500 vouchers''; end if;');
  IF n = d THEN RAISE EXCEPTION 'purchase_voucher quantity guard not found'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.demo_sell_voucher(uuid,uuid,integer,numeric,numeric)'::regprocedure);
  n := replace(d, 'if coalesce(_quantity,0) < 1 or _quantity > 50 then raise exception ''Choose between 1 and 50 vouchers''; end if;',
                  'if coalesce(_quantity,0) < 1 or _quantity > 500 then raise exception ''Choose between 1 and 500 vouchers''; end if;');
  IF n = d THEN RAISE EXCEPTION 'demo_sell_voucher quantity guard not found'; END IF;
  EXECUTE n;
END $$;