create or replace function public.purchase_voucher(_product_id uuid, _quantity integer default 1)
returns table(tx_id text, codes text[], sale_price numeric, unit_price numeric, quantity integer, product_name text, sale_id uuid, points_earned integer, commission_amount numeric, commission_percent integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _unit numeric; _total numeric;
        _tx text; _sale uuid; _status public.account_status; _parent uuid; _mparent uuid;
        _ratio numeric; _ver integer; _earn integer := 0;
        _qty integer; _ids uuid[]; _codes text[]; _debit uuid;
        _c record; _s record; _amt numeric(14,2); _uprate integer := 0;
        _bonus_total numeric(14,2) := 0; _top_recipient uuid; _top_rate integer := 0;
        _upline_total numeric(14,2) := 0; _upline_recipient uuid;
        _racct uuid; _ledger uuid; _rec record; _seq integer := 0;
        _admrate integer := 0; _admin_id uuid; _applied numeric(14,2) := 0;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  perform public.require_operational();
  _qty := coalesce(_quantity, 1);
  if _qty < 1 or _qty > 50 then raise exception 'Choose between 1 and 50 vouchers'; end if;

  select ecosystem_id, status, reseller_id into _my_eco, _status, _parent
    from public.profiles where id = _subject;
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;
  if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then
    raise exception 'This shop is temporarily frozen by the platform owner';
  end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;

  -- Role and upline come from the shop membership first; user_roles is only a
  -- fallback for legacy rows.
  select m.role, m.reseller_id into _role, _mparent
    from public.ecosystem_memberships m
   where m.user_id = _subject and m.ecosystem_id = _my_eco and m.membership_state = 'active';
  if _role is null then
    select role into _role from public.user_roles where user_id = _subject and ecosystem_id = _my_eco
     order by case role when 'reseller' then 0 when 'subreseller' then 1 when 'admin' then 2 else 3 end limit 1;
  end if;
  _role := coalesce(_role, 'customer');
  _parent := coalesce(_mparent, _parent);

  if _role in ('reseller','subreseller','admin') then
    _discount := public.voucher_discount_percent_for(_subject);
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

  _acct := public.wallet_id_for(_subject, _my_eco);
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := floor(_total / _ratio)::int; end if;

  if _earn > 0 then
    select id into _pacct from public.points_accounts where user_id = _subject and (ecosystem_id = _my_eco or ecosystem_id is null) order by (ecosystem_id is null) limit 1;
    if _pacct is null then _earn := 0; end if;
  end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, parent_reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version,
                                    quantity, unit_price, commission_percent, commission_amount)
  values (_my_eco, _p.id, _p.name, _subject, _role,
          case when _role in ('reseller','subreseller') then _subject else _parent end,
          _parent,
          _list, _discount, round((_list - _unit) * _qty, 2), _total,
          'credits', _tx, _p.points_price, 0, _earn, _ratio, _ver,
          _qty, _unit, 0, 0)
  returning id into _sale;

  if _total > 0 then
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind)
    values (_acct, _subject, _my_eco, 'debit', _total, 0,
            'Voucher purchase — ' || _p.name || case when _qty > 1 then ' ×' || _qty else '' end,
            _tx, _op, _tx, _sale, 'purchase')
    returning id into _debit;
  end if;

  update public.voucher_codes vc
     set status = 'sold', sold_to = _subject, sale_id = _sale, sold_at = now()
   where vc.id = any(_ids) and vc.status = 'unused';
  if not found then raise exception 'Those voucher codes were just sold. Please try again.'; end if;

  if _debit is not null and _total > 0 then
    if _role = 'customer' then
      for _c in
        select cc.amount, l.id as lot_id, l.ledger_id, l.source_user_id, l.source_kind
          from public.credit_lot_consumptions cc
          join public.credit_lots l on l.id = cc.lot_id
         where cc.ledger_id = _debit
           and l.source_user_id is not null
           and l.source_kind in ('reseller','subreseller')
      loop
        if _c.source_user_id = _subject then continue; end if;
        for _s in select * from public.cashback_chain(_c.source_user_id, _my_eco) loop
          _amt := round(_c.amount * _s.pct / 100.0, 2);
          continue when _amt <= 0;
          update public.sale_commissions sc
             set credits_consumed = sc.credits_consumed + _c.amount,
                 commission_amount = sc.commission_amount + _amt,
                 commission_percent = _s.pct
           where sc.sale_id = _sale and sc.recipient_id = _s.recipient_id
             and sc.kind = _s.kind and sc.ledger_id is null;
          if not found then
            insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                                 source_ledger_id, credits_consumed, commission_percent,
                                                 commission_amount, kind)
            values (_my_eco, _sale, _s.recipient_id,
                    case when _s.kind = 'sale_cashback' then _c.lot_id else null end,
                    _debit, _c.amount, _s.pct, _amt, _s.kind);
          end if;
        end loop;
      end loop;
    elsif _role = 'subreseller' then
      for _s in select * from public.cashback_chain(_subject, _my_eco) loop
        _amt := round(_total * _s.pct / 100.0, 2);
        continue when _amt <= 0;
        insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                             source_ledger_id, credits_consumed, commission_percent,
                                             commission_amount, kind)
        values (_my_eco, _sale, _s.recipient_id, null, _debit, _total, _s.pct, _amt, _s.kind);
      end loop;
    end if;
  end if;

  if _debit is not null and _total > 0 then
    select ur.user_id into _admin_id
      from public.user_roles ur
      join public.profiles pr on pr.id = ur.user_id
     where ur.ecosystem_id = _my_eco and ur.role = 'admin'
       and pr.deleted_at is null and pr.status = 'active'
     order by pr.joined_at
     limit 1;
    if _admin_id is null then
      select m.user_id into _admin_id
        from public.ecosystem_memberships m
        join public.profiles pr on pr.id = m.user_id
       where m.ecosystem_id = _my_eco and m.role = 'admin' and m.membership_state = 'active'
         and pr.deleted_at is null and pr.status = 'active'
       order by pr.joined_at
       limit 1;
    end if;
    if _admin_id is not null and _admin_id <> _subject then
      select coalesce(sum(sc.commission_amount), 0) into _applied
        from public.sale_commissions sc where sc.sale_id = _sale;
      _amt := round(_total - _applied, 2);
      if _amt > 0 then
        _admrate := round(_amt * 100.0 / _total)::int;
        insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                             source_ledger_id, credits_consumed, commission_percent,
                                             commission_amount, kind)
        values (_my_eco, _sale, _admin_id, null, _debit, _total, _admrate, _amt, 'admin')
        on conflict do nothing;
      end if;
    end if;
  end if;

  for _rec in
    select sc.recipient_id, sc.kind,
           sum(sc.commission_amount) as amount,
           sum(sc.credits_consumed) as basis,
           max(sc.commission_percent) as pct
      from public.sale_commissions sc
     where sc.sale_id = _sale and sc.ledger_id is null
     group by sc.recipient_id, sc.kind
  loop
    _racct := public.wallet_id_for(_rec.recipient_id, _my_eco);
    continue when _racct is null;
    _seq := _seq + 1;

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind,
                                      base_amount, commission_percent, commission_amount)
    values (_racct, _rec.recipient_id, _my_eco, 'credit', _rec.amount, 0,
            case _rec.kind
                 when 'upline'
                   then 'Upline cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% remaining share of your reseller total)'
                 when 'admin'
                   then 'Shop cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% remainder of a member purchase)'
                 else 'Sales cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of credits you supplied)'
            end,
            _tx, _op, _tx || '-C' || _seq,
            _sale, case when _rec.kind = 'upline' then 'upline_commission' else 'sale_commission' end,
            _rec.basis, _rec.pct, _rec.amount)
    returning id into _ledger;

    update public.sale_commissions sc set ledger_id = _ledger
     where sc.sale_id = _sale and sc.recipient_id = _rec.recipient_id
       and sc.kind = _rec.kind and sc.ledger_id is null;

    if _rec.kind = 'upline' then
      _upline_total := _upline_total + _rec.amount;
      _upline_recipient := _rec.recipient_id;
      _uprate := _rec.pct;
    elsif _rec.kind = 'sale_cashback' then
      _bonus_total := _bonus_total + _rec.amount;
      if _rec.pct > _top_rate then _top_rate := _rec.pct; _top_recipient := _rec.recipient_id; end if;
    end if;
  end loop;

  if _bonus_total > 0 or _upline_total > 0 then
    update public.voucher_sales vs
       set commission_amount = _bonus_total,
           commission_percent = _top_rate,
           commission_recipient_id = _top_recipient,
           upline_commission_amount = _upline_total,
           upline_commission_percent = case when _upline_total > 0 then _uprate else 0 end,
           upline_recipient_id = _upline_recipient
     where vs.id = _sale;
  end if;

  if _earn > 0 and _pacct is not null then
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                      balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id,
                                      credits_basis, credits_per_point_used, points_rule_version)
    values (_pacct, _subject, _my_eco, 'credit', _earn, 0,
            'Points earned — ' || _p.name || ' (' || _ratio::text || ' credits = 1 pt)',
            _tx, _op, _tx || '-P', 'earn', _sale, _total, _ratio, _ver);
  end if;

  perform public.log_operator_action(_subject, _my_eco, 'Voucher purchase', 'voucher_sale', _sale, jsonb_build_object('product', _p.name, 'quantity', _qty, 'unit_price', _unit, 'total', _total, 'tx_id', _tx));
  return query select _tx, _codes, _total, _unit, _qty, _p.name, _sale, _earn,
                      _bonus_total + _upline_total, greatest(_top_rate, case when _upline_total > 0 then _uprate else 0 end);
end; $function$;

-- One-off, auditable repair of the mis-attributed Lenas Giga Surf test purchase.
-- Netting corrections only: the admin keeps one sale_commission ledger row
-- (the unique index that prevents duplicate cashback), reduced by 3 credits.
do $$
declare
  _sale uuid := 'dbffa30f-3efa-4038-a1fe-ccc6c3237916';
  _eco  uuid := '394abeef-c545-443c-bf1d-1eaca3c4d356';
  _sub  uuid := '23c96e85-7b0c-4328-89d7-9ac4e6e6c6f9';
  _res  uuid := '0299c1cb-233e-4869-b5b2-2dc85f4bbccf';
  _adm  uuid := '7f5723a6-8dfb-46dc-ac94-a8789ddbc28e';
  _lot  uuid := '8ff26b7c-ead4-48a2-992c-74e7ea5e066e';
  _debit uuid := '28595333-cebc-4b7b-b092-df4da729c6a2';
  _old record; _tx text; _sc uuid; _l uuid;
begin
  select * into _old from public.sale_commissions
   where sale_id = _sale and kind = 'admin' and reversed_at is null;
  if _old.id is null or _old.commission_amount <> 10 then return; end if;

  _tx := public.new_tx_id();

  -- Admin: give back the 3 credits that belong to the reseller chain.
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, sale_id, entry_kind, base_amount,
                                    commission_percent, commission_amount)
  values (public.wallet_id_for(_adm, _eco), _adm, _eco, 'debit', 3.00, 0,
          'Cashback correction — shop share reduced to 70% (credit provenance repaired)',
          _tx, _adm, _tx || '-FIXA', _sale, 'sale_commission_reversal', 10, 70, 3.00);
  update public.sale_commissions
     set commission_amount = 7.00, commission_percent = 70
   where id = _old.id;

  -- Restore the real provenance of the credits the customer spent.
  update public.credit_lots
     set source_kind = 'subreseller', source_user_id = _sub
   where id = _lot;

  -- Subreseller 20% of 10 = 2.
  insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id, source_ledger_id,
                                       credits_consumed, commission_percent, commission_amount, kind)
  values (_eco, _sale, _sub, _lot, _debit, 10, 20, 2.00, 'sale_cashback')
  returning id into _sc;
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, sale_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (public.wallet_id_for(_sub, _eco), _sub, _eco, 'credit', 2.00, 0,
          'Sales cashback correction (20% of credits you supplied)',
          _tx, _sub, _tx || '-FIX1', _sale, 'sale_commission', 10, 20, 2.00)
  returning id into _l;
  update public.sale_commissions set ledger_id = _l where id = _sc;

  -- Parent reseller keeps the remainder of its 30% total = 1.
  insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id, source_ledger_id,
                                       credits_consumed, commission_percent, commission_amount, kind)
  values (_eco, _sale, _res, null, _debit, 10, 10, 1.00, 'upline')
  returning id into _sc;
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, sale_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (public.wallet_id_for(_res, _eco), _res, _eco, 'credit', 1.00, 0,
          'Upline cashback correction (10% remaining share of your reseller total)',
          _tx, _res, _tx || '-FIX2', _sale, 'upline_commission', 10, 10, 1.00)
  returning id into _l;
  update public.sale_commissions set ledger_id = _l where id = _sc;

  update public.voucher_sales
     set commission_amount = 2.00, commission_percent = 20, commission_recipient_id = _sub,
         upline_commission_amount = 1.00, upline_commission_percent = 10, upline_recipient_id = _res
   where id = _sale;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _adm, 'System', 'Corrected voucher cashback allocation', 'WW-6EA0866A7D',
          jsonb_build_object('sale_id', _sale, 'reason',
            'The transfer recorded the platform operator as source while acting as the subreseller, so the credit lot was tagged admin and paid 100% to the shop admin',
            'previous_admin_amount', 10, 'correction_tx', _tx,
            'new_split', jsonb_build_object('subreseller', 2.00, 'reseller', 1.00, 'admin', 7.00)));
end $$;
