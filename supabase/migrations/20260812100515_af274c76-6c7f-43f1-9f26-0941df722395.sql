create or replace function public.purchase_voucher(_product_id uuid, _quantity integer default 1)
returns table(tx_id text, codes text[], sale_price numeric, unit_price numeric,
              quantity integer, product_name text, sale_id uuid, points_earned integer,
              commission_amount numeric, commission_percent integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _unit numeric; _total numeric;
        _tx text; _sale uuid; _status public.account_status;
        _ratio numeric; _ver integer; _earn integer := 0;
        _qty integer; _ids uuid[]; _codes text[]; _debit uuid;
        _c record; _rate integer; _amt numeric(14,2);
        _bonus_total numeric(14,2) := 0; _top_recipient uuid; _top_rate integer := 0;
        _racct uuid; _ledger uuid; _rec record;
begin
  _qty := coalesce(_quantity, 1);
  if _qty < 1 or _qty > 50 then raise exception 'Choose between 1 and 50 vouchers'; end if;

  select ecosystem_id, status into _my_eco, _status from public.profiles where id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;

  select role into _role from public.user_roles where user_id = auth.uid()
   order by case role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
  if _role in ('reseller','subreseller') then
    select reseller_discount_percent into _discount from public.profiles where id = auth.uid();
  end if;
  _discount := coalesce(_discount, 0);

  _list := coalesce(_p.promo_price, _p.credit_price);
  _unit := round(_list * (100 - _discount) / 100.0, 2);
  _total := round(_unit * _qty, 2);

  select array_agg(id order by created_at), array_agg(code order by created_at)
    into _ids, _codes
  from (
    select vc.id, vc.code, vc.created_at
    from public.voucher_codes vc
    where vc.product_id = _product_id and vc.status = 'unused'
    order by vc.created_at
    for update skip locked
    limit _qty
  ) s;

  if _ids is null or array_length(_ids, 1) < _qty then
    raise exception 'Only % voucher code(s) are available for this product', coalesce(array_length(_ids,1), 0);
  end if;

  select id into _acct from public.credit_accounts where user_id = auth.uid();
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := floor(_total / _ratio)::int; end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version,
                                    quantity, unit_price, commission_percent, commission_amount)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          case when _role in ('reseller','subreseller') then auth.uid()
               else (select pr.reseller_id from public.profiles pr where pr.id = auth.uid()) end,
          _list, _discount, round((_list - _unit) * _qty, 2), _total,
          'credits', _tx, _p.points_price, 0, _earn, _ratio, _ver,
          _qty, _unit, 0, 0)
  returning id into _sale;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, sale_id, entry_kind)
  values (_acct, auth.uid(), _my_eco, 'debit', _total, 0,
          'Voucher purchase — ' || _p.name || case when _qty > 1 then ' ×' || _qty else '' end,
          _tx, auth.uid(), _tx, _sale, 'purchase')
  returning id into _debit;

  update public.voucher_codes vc
     set status = 'sold', sold_to = auth.uid(), sale_id = _sale, sold_at = now()
   where vc.id = any(_ids) and vc.status = 'unused';
  if not found then raise exception 'Those voucher codes were just sold. Please try again.'; end if;

  if coalesce(_role, 'customer') = 'customer' then
    for _c in
      select cc.amount, l.id as lot_id, l.ledger_id, l.source_user_id
        from public.credit_lot_consumptions cc
        join public.credit_lots l on l.id = cc.lot_id
       where cc.ledger_id = _debit
         and l.source_user_id is not null
         and l.source_kind in ('reseller','subreseller')
    loop
      if _c.source_user_id = auth.uid() then continue; end if;
      _rate := public.sale_commission_rate_for(_c.source_user_id);
      if _rate <= 0 then continue; end if;
      _amt := round(_c.amount * _rate / 100.0, 2);
      if _amt <= 0 then continue; end if;

      insert into public.sale_commissions as sc (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                           source_ledger_id, credits_consumed, commission_percent, commission_amount)
      values (_my_eco, _sale, _c.source_user_id, _c.lot_id, _c.ledger_id, _c.amount, _rate, _amt)
      on conflict on constraint sale_commissions_sale_id_source_lot_id_key do nothing;
    end loop;

    for _rec in
      select sc.recipient_id,
             sum(sc.commission_amount) as amount,
             sum(sc.credits_consumed) as basis,
             max(sc.commission_percent) as pct
        from public.sale_commissions sc
       where sc.sale_id = _sale and sc.ledger_id is null
       group by sc.recipient_id
    loop
      select id into _racct from public.credit_accounts where user_id = _rec.recipient_id;
      continue when _racct is null;

      insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                        reason, reference, actor_id, tx_id, sale_id, entry_kind,
                                        base_amount, commission_percent, commission_amount)
      values (_racct, _rec.recipient_id, _my_eco, 'credit', _rec.amount, 0,
              'Sales credit-back — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of credits you funded)',
              _tx, auth.uid(), _tx || '-C' || left(replace(_rec.recipient_id::text,'-',''), 6),
              _sale, 'sale_commission', _rec.basis, _rec.pct, _rec.amount)
      returning id into _ledger;

      update public.sale_commissions sc set ledger_id = _ledger
       where sc.sale_id = _sale and sc.recipient_id = _rec.recipient_id and sc.ledger_id is null;

      _bonus_total := _bonus_total + _rec.amount;
      if _rec.pct > _top_rate then _top_rate := _rec.pct; _top_recipient := _rec.recipient_id; end if;
    end loop;

    if _bonus_total > 0 then
      update public.voucher_sales vs
         set commission_amount = _bonus_total,
             commission_percent = _top_rate,
             commission_recipient_id = _top_recipient
       where vs.id = _sale;
    end if;
  end if;

  if _earn > 0 then
    select id into _pacct from public.points_accounts where user_id = auth.uid();
    if _pacct is not null then
      insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                        balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id,
                                        credits_basis, credits_per_point_used, points_rule_version)
      values (_pacct, auth.uid(), _my_eco, 'credit', _earn, 0,
              'Points earned — ' || _p.name || ' (' || _ratio::text || ' credits = 1 pt)',
              _tx, auth.uid(), _tx || '-P', 'earn', _sale, _total, _ratio, _ver);
    else
      _earn := 0;
    end if;
  end if;

  return query select _tx, _codes, _total, _unit, _qty, _p.name, _sale, _earn, _bonus_total, _top_rate;
end;
$$;
