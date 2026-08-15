-- ===================================================================
-- Authoritative per-member cashback rules for every shop.
-- ===================================================================

-- 1) Backfill per-member rates from the old global values so nobody loses
--    their current effective rate. History is untouched.
update public.ecosystem_memberships m
   set sale_commission_percent = case m.role
         when 'subreseller' then (select cashback_subreseller_percent from public.platform_settings where id = 1)
         when 'reseller' then (select cashback_reseller_percent from public.platform_settings where id = 1)
       end
 where m.role in ('reseller','subreseller') and m.sale_commission_percent is null;

update public.profiles p
   set sale_commission_percent = case
         when exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'subreseller')
           then (select cashback_subreseller_percent from public.platform_settings where id = 1)
         else (select cashback_reseller_percent from public.platform_settings where id = 1)
       end
 where p.sale_commission_percent is null
   and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role in ('reseller','subreseller'));

-- 2) Individual rate resolution — per member, per shop. The platform value is
--    only a starting default for members who never had a rate set.
create or replace function public.member_cashback_rate(_user_id uuid, _ecosystem_id uuid)
returns integer
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare _pct integer; _role public.app_role; _status public.account_status;
begin
  if _user_id is null or _ecosystem_id is null then return 0; end if;
  if public.is_super_admin(_user_id) then return 0; end if;

  select m.role, m.sale_commission_percent, m.status
    into _role, _pct, _status
    from public.ecosystem_memberships m
   where m.user_id = _user_id and m.ecosystem_id = _ecosystem_id;

  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _user_id and ur.ecosystem_id = _ecosystem_id
     order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end
     limit 1;
    select p.sale_commission_percent, p.status into _pct, _status
      from public.profiles p where p.id = _user_id;
  end if;

  if _role not in ('reseller','subreseller') then return 0; end if;
  if coalesce(_status, 'active') <> 'active' then return 0; end if;

  if _pct is null then
    select case _role when 'subreseller' then cashback_subreseller_percent
                      else cashback_reseller_percent end
      into _pct from public.platform_settings where id = 1;
  end if;
  return least(greatest(coalesce(_pct, 0), 0), 100);
end $function$;

revoke all on function public.member_cashback_rate(uuid, uuid) from public;
grant execute on function public.member_cashback_rate(uuid, uuid) to authenticated, service_role;

-- Legacy single-argument helper now resolves the individual rate too.
create or replace function public.sale_commission_rate_for(_recipient uuid)
returns integer
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare _eco uuid;
begin
  if _recipient is null then return 0; end if;
  select p.ecosystem_id into _eco from public.profiles p where p.id = _recipient;
  return public.member_cashback_rate(_recipient, _eco);
end $function$;

-- 3) Editing an individual rate — shop admin (own shop) or Super Admin (any shop).
create or replace function public.set_member_cashback_rate(
  _user_id uuid, _ecosystem_id uuid, _percent integer, _reason text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _role public.app_role; _prev integer; _actor text; _eco uuid; _other integer;
begin
  _eco := _ecosystem_id;
  if _eco is null then
    select ecosystem_id into _eco from public.profiles where id = _user_id;
  end if;
  if _eco is null then raise exception 'Shop not found for this member'; end if;

  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _eco)) then
    raise exception 'Not authorized to set cashback rates in this shop';
  end if;
  if _user_id = auth.uid() then
    raise exception 'You cannot change your own cashback rate';
  end if;
  if _percent is null or _percent < 0 or _percent > 100 then
    raise exception 'Cashback must be between 0%% and 100%%';
  end if;

  select m.role, m.sale_commission_percent into _role, _prev
    from public.ecosystem_memberships m
   where m.user_id = _user_id and m.ecosystem_id = _eco;
  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _user_id and ur.ecosystem_id = _eco
     order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
    select p.sale_commission_percent into _prev from public.profiles p where p.id = _user_id;
  end if;
  if _role not in ('reseller','subreseller') then
    raise exception 'Only resellers and subresellers earn cashback';
  end if;

  -- The chain can never distribute more than the purchase: a subreseller plus
  -- its parent reseller must stay at or below 100%.
  if _role = 'subreseller' then
    select public.member_cashback_rate(m.reseller_id, _eco) into _other
      from public.ecosystem_memberships m
     where m.user_id = _user_id and m.ecosystem_id = _eco;
    if _other is null then
      select public.member_cashback_rate(p.reseller_id, _eco) into _other
        from public.profiles p where p.id = _user_id;
    end if;
    if coalesce(_other,0) + _percent > 100 then
      raise exception 'That would give the chain more than 100%% (upstream reseller is at %%%)', coalesce(_other,0);
    end if;
  else
    select max(public.member_cashback_rate(m.user_id, _eco)) into _other
      from public.ecosystem_memberships m
     where m.ecosystem_id = _eco and m.role = 'subreseller' and m.reseller_id = _user_id;
    if coalesce(_other,0) + _percent > 100 then
      raise exception 'That would give the chain more than 100%% (a subreseller is at %%%)', _other;
    end if;
  end if;

  update public.ecosystem_memberships m set sale_commission_percent = _percent, updated_at = now()
   where m.user_id = _user_id and m.ecosystem_id = _eco;
  update public.profiles p set sale_commission_percent = _percent
   where p.id = _user_id and p.ecosystem_id = _eco;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Operator'), 'Updated member cashback rate',
          (select full_name from public.profiles where id = _user_id),
          jsonb_build_object('member_id', _user_id, 'role', _role,
                             'previous_percent', _prev, 'new_percent', _percent,
                             'reason', _reason, 'applies_to', 'future purchases only'));
  return _percent;
end $function$;

revoke all on function public.set_member_cashback_rate(uuid, uuid, integer, text) from public;
grant execute on function public.set_member_cashback_rate(uuid, uuid, integer, text) to authenticated;

-- Legacy entry point now writes the individual rate instead of refusing.
create or replace function public.set_sale_commission(_user_id uuid, _percent integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _eco uuid;
begin
  select ecosystem_id into _eco from public.profiles where id = _user_id;
  perform public.set_member_cashback_rate(_user_id, _eco, _percent, 'legacy rate editor');
end $function$;

-- 4) Purchase distribution: individual rates, provenance-driven, admin remainder.
create or replace function public.purchase_voucher(_product_id uuid, _quantity integer default 1)
returns table(tx_id text, codes text[], sale_price numeric, unit_price numeric, quantity integer, product_name text, sale_id uuid, points_earned integer, commission_amount numeric, commission_percent integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _unit numeric; _total numeric;
        _tx text; _sale uuid; _status public.account_status; _parent uuid;
        _ratio numeric; _ver integer; _earn integer := 0;
        _qty integer; _ids uuid[]; _codes text[]; _debit uuid;
        _c record; _rate integer; _amt numeric(14,2); _uprate integer := 0;
        _bonus_total numeric(14,2) := 0; _top_recipient uuid; _top_rate integer := 0;
        _upline_total numeric(14,2) := 0; _upline_recipient uuid;
        _racct uuid; _ledger uuid; _rec record; _seq integer := 0; _src_parent uuid;
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

  select role into _role from public.user_roles where user_id = _subject
   order by case role when 'reseller' then 0 when 'subreseller' then 1 when 'admin' then 2 else 3 end limit 1;
  _role := coalesce(_role, 'customer');
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

  -- Only a customer purchase distributes cashback, and only along the actual
  -- credit provenance. A reseller's or subreseller's own purchase gives the
  -- shop admin 100% of the credits used.
  if _role = 'customer' and _debit is not null then
    for _c in
      select cc.amount, l.id as lot_id, l.ledger_id, l.source_user_id, l.source_kind
        from public.credit_lot_consumptions cc
        join public.credit_lots l on l.id = cc.lot_id
       where cc.ledger_id = _debit
         and l.source_user_id is not null
         and l.source_kind in ('reseller','subreseller')
    loop
      if _c.source_user_id = _subject then continue; end if;
      _rate := public.member_cashback_rate(_c.source_user_id, _my_eco);
      _amt := round(_c.amount * _rate / 100.0, 2);
      if _rate > 0 and _amt > 0 then
        insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                             source_ledger_id, credits_consumed, commission_percent,
                                             commission_amount, kind)
        values (_my_eco, _sale, _c.source_user_id, _c.lot_id, _c.ledger_id, _c.amount, _rate, _amt, 'sale_cashback')
        on conflict do nothing;
      end if;

      -- Upstream reseller only participates when the credits actually came
      -- from one of its subresellers, and at that reseller's own rate.
      if _c.source_kind = 'subreseller' then
        select coalesce(m.reseller_id, p.reseller_id) into _src_parent
          from public.profiles p
          left join public.ecosystem_memberships m
                 on m.user_id = p.id and m.ecosystem_id = _my_eco
         where p.id = _c.source_user_id;
        if _src_parent is not null and _src_parent <> _subject then
          _uprate := public.member_cashback_rate(_src_parent, _my_eco);
          _uprate := least(_uprate, greatest(100 - coalesce(_rate,0), 0));
          _amt := round(_c.amount * _uprate / 100.0, 2);
          if _uprate > 0 and _amt > 0 then
            update public.sale_commissions sc
               set credits_consumed = sc.credits_consumed + _c.amount,
                   commission_amount = sc.commission_amount + _amt
             where sc.sale_id = _sale
               and sc.recipient_id = _src_parent
               and sc.kind = 'upline';
            if not found then
              insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                                   source_ledger_id, credits_consumed, commission_percent,
                                                   commission_amount, kind)
              values (_my_eco, _sale, _src_parent, null, _debit, _c.amount, _uprate, _amt, 'upline');
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- Shop admin always receives the remainder so the split equals the purchase.
  if _debit is not null and _total > 0 then
    select ur.user_id into _admin_id
      from public.user_roles ur
      join public.profiles pr on pr.id = ur.user_id
     where ur.ecosystem_id = _my_eco and ur.role = 'admin'
       and pr.deleted_at is null and pr.status = 'active'
     order by pr.joined_at
     limit 1;
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
                   then 'Upline commission — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of your downline sale)'
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