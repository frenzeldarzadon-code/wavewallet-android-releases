-- A member may buy vouchers in any shop they are an approved member of, not
-- only in the shop that happens to be their last-opened one. Role, discount and
-- cashback still resolve strictly inside the shop that sells the voucher.
do $mig$
declare _def text; _old text; _new text;
begin
  _def := pg_get_functiondef('public.purchase_voucher(uuid,integer)'::regprocedure);

  _old := '  select * into _p from public.voucher_products where id = _product_id;'
       || E'\n' ||
          '  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception ''Product not available''; end if;';

  if position(_old in _def) = 0 then
    raise exception 'purchase_voucher shop resolution has changed — review before patching';
  end if;

  _new := '  select * into _p from public.voucher_products where id = _product_id;'
       || E'\n' ||
          '  if _p.id is null then raise exception ''Product not available''; end if;'
       || E'\n' ||
          '  if _p.ecosystem_id <> _my_eco then'
       || E'\n' ||
          '    if exists (select 1 from public.ecosystem_memberships m'
       || E'\n' ||
          '                where m.user_id = _subject and m.ecosystem_id = _p.ecosystem_id'
       || E'\n' ||
          '                  and m.membership_state = ''active'') then'
       || E'\n' ||
          '      _my_eco := _p.ecosystem_id;'
       || E'\n' ||
          '      if not public.subscription_ok(_my_eco) then raise exception ''This shop is temporarily unavailable''; end if;'
       || E'\n' ||
          '      if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then'
       || E'\n' ||
          '        raise exception ''This shop is temporarily frozen by the platform owner'';'
       || E'\n' ||
          '      end if;'
       || E'\n' ||
          '    else'
       || E'\n' ||
          '      raise exception ''Product not available'';'
       || E'\n' ||
          '    end if;'
       || E'\n' ||
          '  end if;';

  execute replace(_def, _old, _new);
end $mig$;
