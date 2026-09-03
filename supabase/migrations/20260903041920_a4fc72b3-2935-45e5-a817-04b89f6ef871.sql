-- Universe voucher pricing correction (live system, additive only):
--  * Reseller/subreseller purchase discounts removed in Universe shops; they
--    pay the customer price and earn ONLY through the existing cashback chain.
--  * 1% Universe voucher platform fee, PRICE-INCLUSIVE for the one-time
--    transition: live customer prices are unchanged; the fee is backed out.
--  * Fee rate snapshotted per product and per sale. New Generation untouched.

alter table public.platform_settings
  add column if not exists voucher_platform_fee_percent numeric not null default 1;
alter table public.platform_settings drop constraint if exists platform_settings_voucher_fee_range;
alter table public.platform_settings add constraint platform_settings_voucher_fee_range
  check (voucher_platform_fee_percent >= 0 and voucher_platform_fee_percent <= 100);
update public.platform_settings set voucher_platform_fee_percent = 1 where id = 1 and voucher_platform_fee_percent is null;

create or replace function public.voucher_platform_fee_percent()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select voucher_platform_fee_percent from public.platform_settings where id = 1), 1)::numeric;
$$;
grant execute on function public.voucher_platform_fee_percent() to anon, authenticated, service_role;

-- ONE authoritative fee-inclusive formula: seller cut = price / (1 + f), rounded
-- once to 2 dp; the fee is the exact remainder so cut + fee == price always.
create or replace function public.voucher_seller_cut(_customer_price numeric, _fee_percent numeric)
returns numeric language sql immutable as $$
  select round(coalesce(_customer_price,0) / (1 + greatest(coalesce(_fee_percent,0),0) / 100.0), 2);
$$;
create or replace function public.voucher_platform_fee_amount(_customer_price numeric, _fee_percent numeric)
returns numeric language sql immutable as $$
  select round(coalesce(_customer_price,0) - public.voucher_seller_cut(_customer_price, _fee_percent), 2);
$$;
-- Additive direction for "Set seller's cut": price = cut × (1 + f), rounded once.
create or replace function public.voucher_price_from_seller_cut(_seller_cut numeric, _fee_percent numeric)
returns numeric language sql immutable as $$
  select round(coalesce(_seller_cut,0) * (1 + greatest(coalesce(_fee_percent,0),0) / 100.0), 2);
$$;
grant execute on function public.voucher_seller_cut(numeric, numeric), public.voucher_platform_fee_amount(numeric, numeric),
  public.voucher_price_from_seller_cut(numeric, numeric) to anon, authenticated, service_role;

-- Per-product snapshot of the fee rate in force when the price was set.
alter table public.voucher_products add column if not exists platform_fee_percent numeric;
-- One-time transition: every existing live price is treated as fee-inclusive at 1%.
update public.voucher_products set platform_fee_percent = 1 where platform_fee_percent is null;
alter table public.voucher_products alter column platform_fee_percent set not null,
  alter column platform_fee_percent set default 1;

create or replace function public.voucher_products_snapshot_fee()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.credit_price is distinct from old.credit_price
     or new.promo_price is distinct from old.promo_price then
    new.platform_fee_percent := round(public.voucher_platform_fee_percent(), 2);
  else
    new.platform_fee_percent := old.platform_fee_percent;
  end if;
  return new;
end $$;
drop trigger if exists voucher_products_snapshot_fee on public.voucher_products;
create trigger voucher_products_snapshot_fee before insert or update on public.voucher_products
  for each row execute function public.voucher_products_snapshot_fee();

-- Per-sale snapshot (historical rows keep 0 / null — they are never rewritten).
alter table public.voucher_sales
  add column if not exists platform_fee_percent numeric not null default 0,
  add column if not exists platform_fee_amount numeric not null default 0,
  add column if not exists seller_amount numeric;

-- Universe shops: no reseller/subreseller purchase discount. Admin and
-- New Generation behaviour unchanged.
create or replace function public.voucher_discount_percent_for(_user_id uuid, _ecosystem_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $function$
declare _eco uuid; _role public.app_role;
begin
  _eco := _ecosystem_id;
  if _eco is null then
    select p.ecosystem_id into _eco from public.profiles p where p.id = _user_id;
  end if;
  if _eco is null then return 0; end if;

  -- Shop admins buy their own inventory at the platform admin voucher discount.
  if exists (select 1 from public.user_roles ur
              where ur.user_id = _user_id and ur.role = 'admin' and ur.ecosystem_id = _eco)
     or exists (select 1 from public.ecosystem_memberships m
                 where m.user_id = _user_id and m.ecosystem_id = _eco and m.role = 'admin') then
    return public.admin_voucher_discount_percent();
  end if;

  -- Universe: everyone pays the same customer price; resellers earn via cashback only.
  if public.is_universe_shop(_eco) then return 0; end if;

  select m.role into _role from public.ecosystem_memberships m
   where m.user_id = _user_id and m.ecosystem_id = _eco;
  if _role is null then
    select ur.role into _role from public.user_roles ur
     where ur.user_id = _user_id and ur.ecosystem_id = _eco
     order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
  end if;
  if _role is null or _role not in ('reseller','subreseller') then return 0; end if;

  -- Exactly the member's configured Discount — never a second setting.
  return least(greatest(coalesce(public.member_cashback_rate(_user_id, _eco), 0), 0), 100);
end $function$;

drop function if exists public.set_platform_money_settings(integer, integer, numeric, numeric, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.set_platform_money_settings(_cashback_reseller integer, _cashback_subreseller integer, _credits_per_unit numeric, _php_per_unit numeric, _withdrawal_fee numeric, _shop_transfer_fee numeric DEFAULT NULL::numeric, _cash_in_fee numeric DEFAULT NULL::numeric, _retail_fee numeric DEFAULT NULL::numeric, _voucher_fee numeric DEFAULT NULL::numeric)
 RETURNS platform_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.platform_settings; _prev public.platform_settings; _actor text;
        _fee numeric; _cin numeric; _rfee numeric; _vfee numeric;
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

  _vfee := coalesce(_voucher_fee, _prev.voucher_platform_fee_percent, 1);
  if _vfee < 0 or _vfee > 100 then
    raise exception 'The voucher platform fee must be between 0%% and 100%%';
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
         voucher_platform_fee_percent = _vfee,
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
              'retail_platform_fee_percent', _prev.retail_platform_fee_percent,
              'voucher_platform_fee_percent', _prev.voucher_platform_fee_percent),
            'new', jsonb_build_object(
              'cashback_reseller_percent', _cashback_reseller,
              'cashback_subreseller_percent', _cashback_subreseller,
              'cash_out_credits_per_unit', _credits_per_unit,
              'cash_out_php_per_unit', _php_per_unit,
              'withdrawal_fee_percent', _withdrawal_fee,
              'cash_in_fee_percent', _cin,
              'shop_transfer_fee_credits', _fee,
              'retail_platform_fee_percent', _rfee,
              'voucher_platform_fee_percent', _vfee),
            'applies_to', 'future transactions only'));
  return _row;
end $function$;

grant execute on function public.set_platform_money_settings(integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.purchase_voucher(_product_id uuid, _quantity integer DEFAULT 1, _seller_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tx_id text, codes text[], sale_price numeric, unit_price numeric, quantity integer, product_name text, sale_id uuid, points_earned numeric, commission_amount numeric, commission_percent integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _subject uuid; _op uuid; _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _unit numeric; _total numeric;
        _tx text; _sale uuid; _status public.account_status; _parent uuid; _mparent uuid;
        _ratio numeric; _ver integer; _earn numeric(14,2) := 0;
        _qty integer; _ids uuid[]; _codes text[]; _debit uuid;
        _c record; _s record; _amt numeric(14,2); _uprate integer := 0;
        _bonus_total numeric(14,2) := 0; _top_recipient uuid; _top_rate integer := 0;
        _upline_total numeric(14,2) := 0; _upline_recipient uuid;
        _racct uuid; _ledger uuid; _rec record; _seq integer := 0;
        _admrate integer := 0; _admin_id uuid; _applied numeric(14,2) := 0;
        _universe boolean := false; _seller uuid; _seller_role public.app_role; _seller_parent uuid;
        _sale_reseller uuid; _sale_parent uuid;
        _fee_pct numeric := 0; _fee numeric(14,2) := 0; _seller_amt numeric(14,2) := 0;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  if _subject is null then raise exception 'Not signed in'; end if;
  _qty := coalesce(_quantity, 1);
  if _qty < 1 or _qty > 500 then raise exception 'Choose between 1 and 500 vouchers'; end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null then raise exception 'Product not available'; end if;
  _universe := public.is_universe_shop(_p.ecosystem_id);

  select ecosystem_id, status, reseller_id into _my_eco, _status, _parent
    from public.profiles where id = _subject and deleted_at is null;
  if _status is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;

  if _universe then
    -- Universe shop: any active member of the Universe may buy; no shop membership needed.
    _my_eco := _p.ecosystem_id;
    if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;
    if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then
      raise exception 'This shop is temporarily frozen by the platform owner';
    end if;
    if _seller_id is not null and _seller_id <> _subject then
      if not exists (select 1 from public.shop_seller_authorizations a
                      where a.ecosystem_id = _my_eco and a.user_id = _seller_id and a.active) then
        raise exception 'That seller is not authorized to sell for this shop';
      end if;
      _seller := _seller_id;
    end if;
    _acct := public.ensure_global_wallet(_subject);
  else
    if _seller_id is not null then
      raise exception 'Seller storefronts are only available in Universe shops';
    end if;
    perform public.require_operational();
    if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
    if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;
    if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then
      raise exception 'This shop is temporarily frozen by the platform owner';
    end if;
    if _p.ecosystem_id <> _my_eco then
      if exists (select 1 from public.ecosystem_memberships m
                  where m.user_id = _subject and m.ecosystem_id = _p.ecosystem_id
                    and m.membership_state = 'active') then
        _my_eco := _p.ecosystem_id;
        if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;
        if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then
          raise exception 'This shop is temporarily frozen by the platform owner';
        end if;
      else
        raise exception 'Product not available';
      end if;
    end if;
  end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;

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
    _discount := public.voucher_discount_percent_for(_subject, _my_eco);
  end if;
  _discount := coalesce(_discount, 0);

  _list := coalesce(_p.promo_price, _p.credit_price);
  _unit := round(_list * (100 - _discount) / 100.0, 2);
  _total := round(_unit * _qty, 2);

  -- Universe platform fee is PRICE-INCLUSIVE: the customer pays exactly the
  -- displayed price; the fee is backed out of what was actually consumed using
  -- the rate snapshotted on the product (a later rate change never reprices a
  -- published product). New Generation shops carry no platform fee.
  if _universe and _total > 0 then
    _fee_pct := round(coalesce(_p.platform_fee_percent, 0), 2);
    _fee := public.voucher_platform_fee_amount(_total, _fee_pct);
  end if;
  _seller_amt := round(_total - _fee, 2);

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

  if not _universe then
    _acct := public.wallet_id_for(_subject, _my_eco);
  end if;
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := round(_total / _ratio, 2); end if;

  if _earn > 0 then
    if _universe and not public.is_super_admin(_subject) then
      -- Rewards stay shop-scoped: the buyer earns in the SELLING shop's points account.
      insert into public.points_accounts (user_id, ecosystem_id) values (_subject, _my_eco)
      on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
    end if;
    select id into _pacct from public.points_accounts where user_id = _subject and ecosystem_id = _my_eco;
    if _pacct is null then _earn := 0; end if;
  end if;

  -- Seller attribution (Universe only): the storefront seller is the sale's reseller.
  if _universe and _seller is not null then
    select m.role, m.reseller_id into _seller_role, _seller_parent
      from public.ecosystem_memberships m
     where m.user_id = _seller and m.ecosystem_id = _my_eco and m.membership_state = 'active';
    if _seller_role is null then
      select ur.role into _seller_role from public.user_roles ur
       where ur.user_id = _seller and ur.ecosystem_id = _my_eco
       order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 when 'admin' then 2 else 3 end limit 1;
      select p.reseller_id into _seller_parent from public.profiles p where p.id = _seller;
    end if;
  end if;

  if _universe then
    if _role in ('reseller','subreseller') then
      _sale_reseller := _subject; _sale_parent := _parent;
    elsif _seller is not null and _seller_role in ('reseller','subreseller') then
      _sale_reseller := _seller; _sale_parent := _seller_parent;
    else
      _sale_reseller := null; _sale_parent := null;
    end if;
  else
    _sale_reseller := case when _role in ('reseller','subreseller') then _subject else _parent end;
    _sale_parent := _parent;
  end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, parent_reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version,
                                    quantity, unit_price, commission_percent, commission_amount, seller_id,
                                    platform_fee_percent, platform_fee_amount, seller_amount)
  values (_my_eco, _p.id, _p.name, _subject, _role,
          _sale_reseller, _sale_parent,
          _list, _discount, round((_list - _unit) * _qty, 2), _total,
          'credits', _tx, _p.points_price, 0, _earn, _ratio, _ver,
          _qty, _unit, 0, 0, _seller,
          _fee_pct, _fee, _seller_amt)
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
    if _universe then
      -- Universe cashback follows the SELLING shop's rules for the sale's
      -- reseller: the buying reseller/subreseller themselves (they now pay the
      -- same price as everyone and earn ONLY through cashback), otherwise the
      -- storefront seller — never the provenance of the buyer's coins.
      -- The base is the full sale amount; the platform fee never reduces it.
      if _sale_reseller is not null then
        for _s in select * from public.cashback_chain(_sale_reseller, _my_eco) loop
          _amt := round(_total * _s.pct / 100.0, 2);
          continue when _amt <= 0;
          insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                               source_ledger_id, credits_consumed, commission_percent,
                                               commission_amount, kind)
          values (_my_eco, _sale, _s.recipient_id, null, _debit, _total, _s.pct, _amt, _s.kind);
        end loop;
      end if;
    elsif _role = 'customer' then
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
      if _parent is not null then
        _uprate := greatest(
          coalesce(public.member_cashback_rate(_parent, _my_eco), 0)
          - coalesce(public.member_cashback_rate(_subject, _my_eco), 0), 0);
        _amt := least(round(coalesce(_list,0) * _qty * _uprate / 100.0, 2), _total);
        if _amt > 0 then
          insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                               source_ledger_id, credits_consumed, commission_percent,
                                               commission_amount, kind)
          values (_my_eco, _sale, _parent, null, _debit, _total, _uprate, _amt, 'upline');
        end if;
        _uprate := 0;
      end if;
    end if;
  end if;

  if _debit is not null and _total > 0 and _fee > 0 then
    -- Cashback is never reduced by the fee; if cashback already consumes the
    -- whole sale, the fee is capped so the sale is never over-distributed.
    select coalesce(sum(sc.commission_amount), 0) into _applied
      from public.sale_commissions sc where sc.sale_id = _sale;
    if _applied + _fee > _total then
      _fee := greatest(round(_total - _applied, 2), 0);
      _seller_amt := round(_total - _fee, 2);
      update public.voucher_sales vs set platform_fee_amount = _fee, seller_amount = _seller_amt where vs.id = _sale;
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
      _amt := round(_total - _applied - _fee, 2);
      if _amt > 0 then
        _admrate := round(_amt * 100.0 / NULLIF(_list * _qty, 0))::int;
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
    if _universe then
      _racct := case when public.is_super_admin(_rec.recipient_id) then null
                     else public.ensure_global_wallet(_rec.recipient_id) end;
    else
      _racct := public.wallet_id_for(_rec.recipient_id, _my_eco);
    end if;
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
                 else case when _universe
                           then 'Sales cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of a sale through your storefront)'
                           else 'Sales cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of credits you supplied)' end
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

  perform public.log_operator_action(_subject, _my_eco, 'Voucher purchase', 'voucher_sale', _sale,
    jsonb_build_object('product', _p.name, 'quantity', _qty, 'unit_price', _unit, 'total', _total, 'tx_id', _tx,
                       'universe', _universe, 'seller_id', _seller,
                       'platform_fee_percent', _fee_pct, 'platform_fee_amount', _fee, 'seller_amount', _seller_amt));
  return query select _tx, _codes, _total, _unit, _qty, _p.name, _sale, _earn,
                      _bonus_total + _upline_total, greatest(_top_rate, case when _upline_total > 0 then _uprate else 0 end);
end; $function$;