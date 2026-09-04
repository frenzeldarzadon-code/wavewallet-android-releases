
-- ============================================================================
-- GLOBAL BUSINESS RULE — Universe self-purchase cashback
--
-- Applies to EVERY Universe shop type (Voucher, Retail, future types) that
-- uses the shared purchase layer below. A shop type decides WHO the entitled
-- cashback recipient is and HOW MUCH cashback its own rules produce; the
-- shared layer decides whether that is a self purchase and writes the ONE
-- net wallet debit. Member-to-member transfers never call this layer.
-- ============================================================================

alter table public.voucher_sales
  add column if not exists self_cashback numeric(14,2) not null default 0,
  add column if not exists buyer_charge numeric(14,2);
comment on column public.voucher_sales.self_cashback is 'Cashback netted out of the buyer''s single debit (self purchase). Never paid as a separate credit.';
comment on column public.voucher_sales.buyer_charge is 'What the buyer''s Universe Wallet was actually charged (sale_price − self_cashback).';

create or replace function public.universe_peso(_n numeric)
returns text language sql immutable set search_path = public as $$
  select '₱' || to_char(coalesce(_n, 0), 'FM999,999,990.00');
$$;
revoke all on function public.universe_peso(numeric) from public, anon;
grant execute on function public.universe_peso(numeric) to authenticated, service_role;

-- Decides self purchase + nets the entitled cashback. Shop-type agnostic.
create or replace function public.universe_self_purchase_net(
  _buyer uuid, _entitled_recipient uuid, _ecosystem_id uuid, _payment_method text,
  _gross numeric, _entitled_cashback numeric)
returns table(self_purchase boolean, self_cashback numeric, buyer_charge numeric)
language plpgsql stable security definer set search_path = public as $$
declare _g numeric(14,2) := round(coalesce(_gross,0),2); _cb numeric(14,2) := 0; _self boolean := false;
begin
  _self := _buyer is not null
       and _entitled_recipient is not null
       and _entitled_recipient = _buyer
       and coalesce(_payment_method,'') in ('credit','credits')
       and public.is_universe_shop(_ecosystem_id)
       and not public.is_super_admin(_buyer);
  if _self then _cb := least(greatest(round(coalesce(_entitled_cashback,0),2), 0), _g); end if;
  if _cb <= 0 then _self := false; _cb := 0; end if;
  return query select _self, _cb, round(_g - _cb, 2);
end $$;
revoke all on function public.universe_self_purchase_net(uuid,uuid,uuid,text,numeric,numeric) from public, anon;
grant execute on function public.universe_self_purchase_net(uuid,uuid,uuid,text,numeric,numeric) to authenticated, service_role;

-- Writes the ONE buyer-side debit for a Universe purchase. base_amount /
-- commission_amount carry the gross / cashback breakdown for audit; the
-- reason is the human-readable "price − cashback = charge" line.
create or replace function public.universe_purchase_debit(
  _account uuid, _buyer uuid, _ecosystem_id uuid, _actor uuid, _tx text, _reference text,
  _sale_id uuid, _entry_kind text, _label text, _self_label text, _gross numeric, _self_cashback numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare _g numeric(14,2) := round(coalesce(_gross,0),2);
        _cb numeric(14,2) := least(greatest(round(coalesce(_self_cashback,0),2),0), round(coalesce(_gross,0),2));
        _charge numeric(14,2); _id uuid;
begin
  _charge := round(_g - _cb, 2);
  insert into public.credit_ledger
    (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference,
     actor_id, tx_id, sale_id, entry_kind, base_amount, commission_amount)
  values (_account, _buyer, _ecosystem_id, 'debit', _charge, 0,
          case when _cb > 0
               then 'Self purchase — ' || _self_label || ' — ' || public.universe_peso(_g) || ' − '
                    || public.universe_peso(_cb) || ' cashback = ' || public.universe_peso(_charge)
               else _label end,
          _reference, _actor, _tx, _sale_id, _entry_kind,
          case when _cb > 0 then _g end, case when _cb > 0 then _cb end)
  returning id into _id;
  return _id;
end $$;
revoke all on function public.universe_purchase_debit(uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,numeric,numeric) from public, anon;
grant execute on function public.universe_purchase_debit(uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,numeric,numeric) to service_role;

-- Retail now delegates to the shared rule (kept as a thin adapter).
create or replace function public.retail_is_self_purchase(_buyer uuid, _seller uuid, _ecosystem_id uuid, _payment_method text)
returns boolean language sql stable security definer set search_path = public as $$
  select n.self_purchase
    from public.universe_self_purchase_net(_buyer, public.retail_cashback_recipient(_buyer, _seller, _ecosystem_id),
                                           _ecosystem_id, _payment_method, 1, 1) n;
$$;

-- Voucher checkout quote (same figures purchase_voucher will charge).
create or replace function public.voucher_checkout_quote(_product_id uuid, _quantity integer default 1, _seller_id uuid default null)
returns table(total numeric, self_cashback numeric, buyer_charge numeric, self_purchase boolean, cashback_percent integer)
language plpgsql stable security definer set search_path = public as $$
declare _uid uuid := public.effective_uid(); _p record; _eco uuid; _role public.app_role; _discount int := 0;
        _list numeric; _unit numeric; _total numeric(14,2); _pct int := 0; _qty int := greatest(coalesce(_quantity,1),1);
        _self boolean := false; _cb numeric(14,2) := 0; _charge numeric(14,2);
begin
  if _uid is null then return query select 0::numeric,0::numeric,0::numeric,false,0; return; end if;
  select * into _p from public.voucher_products where id = _product_id;
  if _p is null then return query select 0::numeric,0::numeric,0::numeric,false,0; return; end if;
  _eco := _p.ecosystem_id;
  select m.role into _role from public.ecosystem_memberships m
   where m.user_id = _uid and m.ecosystem_id = _eco and m.membership_state = 'active';
  if _role is null then
    select role into _role from public.user_roles where user_id = _uid and ecosystem_id = _eco
     order by case role when 'reseller' then 0 when 'subreseller' then 1 when 'admin' then 2 else 3 end limit 1;
  end if;
  _role := coalesce(_role, 'customer');
  if _role in ('reseller','subreseller','admin') then
    _discount := coalesce(public.voucher_discount_percent_for(_uid, _eco), 0);
  end if;
  _list := coalesce(_p.promo_price, _p.credit_price);
  _unit := round(_list * (100 - _discount) / 100.0, 2);
  _total := round(_unit * _qty, 2);
  _charge := _total;
  if public.is_universe_shop(_eco) and _role in ('reseller','subreseller') then
    select s.pct into _pct from public.cashback_chain(_uid, _eco) s
     where s.recipient_id = _uid and s.kind = 'sale_cashback' limit 1;
    _pct := coalesce(_pct, 0);
    select n.self_purchase, n.self_cashback, n.buyer_charge into _self, _cb, _charge
      from public.universe_self_purchase_net(_uid, _uid, _eco, 'credit', _total, round(_total * _pct / 100.0, 2)) n;
  end if;
  return query select _total, _cb, _charge, _self, case when _self then _pct else 0 end;
end $$;
revoke all on function public.voucher_checkout_quote(uuid,integer,uuid) from public, anon;
grant execute on function public.voucher_checkout_quote(uuid,integer,uuid) to authenticated, service_role;


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
        _self boolean := false; _self_cb numeric(14,2) := 0; _own_pct integer := 0; _charge numeric(14,2);
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
    -- GLOBAL self-purchase rule (shared Universe purchase layer): when the
    -- buyer is themselves the entitled cashback recipient of this sale, their
    -- own share is netted out of the ONE wallet debit instead of being paid
    -- back later. Upline and admin shares are settled exactly as before.
    _charge := _total;
    if _universe and _role in ('reseller','subreseller') then
      select s.pct into _own_pct from public.cashback_chain(_subject, _my_eco) s
       where s.recipient_id = _subject and s.kind = 'sale_cashback' limit 1;
      _own_pct := coalesce(_own_pct, 0);
      select n.self_purchase, n.self_cashback, n.buyer_charge into _self, _self_cb, _charge
        from public.universe_self_purchase_net(_subject, _subject, _my_eco, 'credit', _total,
               round(_total * _own_pct / 100.0, 2)) n;
    end if;
    _debit := public.universe_purchase_debit(_acct, _subject, _my_eco, _op, _tx, _tx, _sale, 'purchase',
                'Voucher purchase — ' || _p.name || case when _qty > 1 then ' ×' || _qty else '' end,
                'Voucher — ' || _p.name || case when _qty > 1 then ' ×' || _qty else '' end,
                _total, _self_cb);
    update public.voucher_sales vs set self_cashback = _self_cb, buyer_charge = _charge where vs.id = _sale;
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

  if _self_cb > 0 then
    -- The buyer's own cashback was already applied inside the purchase debit:
    -- the commission record stays for reports/earnings but is settled by the
    -- debit itself, so NO separate cashback credit is ever written.
    update public.sale_commissions sc set ledger_id = _debit
     where sc.sale_id = _sale and sc.recipient_id = _subject
       and sc.kind = 'sale_cashback' and sc.ledger_id is null;
    _bonus_total := _self_cb; _top_rate := _own_pct; _top_recipient := _subject;
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
    if _admin_id is not null and (_universe or _admin_id <> _subject) then
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
                       'platform_fee_percent', _fee_pct, 'platform_fee_amount', _fee, 'seller_amount', _seller_amt,
                       'self_purchase', _self, 'self_cashback', _self_cb, 'buyer_charge', _charge));
  return query select _tx, _codes, _total, _unit, _qty, _p.name, _sale, _earn,
                      _bonus_total + _upline_total, greatest(_top_rate, case when _upline_total > 0 then _uprate else 0 end);
end; $function$;

CREATE OR REPLACE FUNCTION public.retail_place_order(_ecosystem_id uuid, _items jsonb, _fulfillment text, _payment_method text, _address text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _seller_id uuid DEFAULT NULL::uuid, _client_ref uuid DEFAULT NULL::uuid)
 RETURNS TABLE(order_id uuid, order_no text, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := public.effective_uid();
  _eco record; _item jsonb; _p record; _qty int;
  _total numeric(14,2) := 0; _seller_total numeric(14,2) := 0; _fee_total numeric(14,2) := 0;
  _cb_total numeric(14,2) := 0; _cb_line numeric(14,2);
  _pct numeric(6,2); _unit numeric(12,2); _wholesale boolean;
  _seller_line numeric(14,2); _fee_line numeric(14,2); _line numeric(14,2);
  _oid uuid; _ono text; _acct uuid; _name text; _tx text; _hold uuid;
  _universe boolean; _seller uuid; _cb_recipient uuid; _dfee numeric(12,2) := 0; _dpct int; _cpct int;
  _dup record;
  _self boolean := false; _self_cb numeric(14,2) := 0; _charge numeric(14,2);
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  -- Idempotent replay: the same checkout attempt (client_ref) never creates a second order.
  if _client_ref is not null then
    select o.id, o.order_no, o.total into _dup
      from public.retail_orders o where o.customer_id = _uid and o.client_ref = _client_ref;
    if _dup.id is not null then return query select _dup.id, _dup.order_no, _dup.total; return; end if;
  end if;
  perform public.assert_actor_active();
  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco is null or _eco.archived_at is not null then raise exception 'Shop not found'; end if;
  if not _eco.store_retail_enabled then raise exception 'This shop has no retail store'; end if;
  if coalesce(_eco.operations_frozen, false) or _eco.frozen_at is not null then
    raise exception 'This shop is temporarily frozen by the platform owner';
  end if;
  if not public.subscription_ok(_ecosystem_id) then raise exception 'This shop is temporarily unavailable'; end if;
  _universe := public.is_universe_shop(_ecosystem_id);
  -- Universe is the customer portal: any signed-in, active member may buy from a
  -- Universe shop. New Generation shops still pay from the shop wallet, which
  -- only exists for members (retail_wallet_for enforces that).
  if not _universe and not public.has_membership(_uid, _ecosystem_id) then
    raise exception 'This shop only sells to its own members';
  end if;

  if _seller_id is not null and _seller_id <> _uid then
    if not _universe then
      raise exception 'Seller storefronts are only available in Universe shops';
    end if;
    if not exists (select 1 from public.shop_seller_authorizations a
                    where a.ecosystem_id = _ecosystem_id and a.user_id = _seller_id and a.active) then
      raise exception 'That seller is not authorized to sell for this shop';
    end if;
    if not public.retail_seller_allowed(_seller_id, _ecosystem_id) then
      raise exception 'Retail storefronts are run by the shop admin or a reseller'; end if;
    _seller := _seller_id;
  end if;

  if _fulfillment not in ('pickup','delivery') then raise exception 'Choose pickup or delivery'; end if;
  if _fulfillment = 'pickup' and not _eco.retail_pickup_enabled then
    raise exception 'This shop does not offer pickup'; end if;
  if _fulfillment = 'delivery' then
    if not _eco.retail_delivery_enabled then raise exception 'This shop does not offer delivery'; end if;
    if btrim(coalesce(_address, '')) = '' then raise exception 'A delivery address is required'; end if;
  end if;
  if _payment_method not in ('cash','credit','cod') then raise exception 'Choose a payment method'; end if;
  if _payment_method = 'cash' and not _eco.retail_cash_enabled then
    raise exception 'This shop does not accept cash'; end if;
  if _payment_method = 'credit' and not _eco.retail_credit_enabled then
    raise exception 'This shop does not accept coin payment'; end if;
  if _payment_method = 'cod' then
    if not _universe then raise exception 'Cash on delivery is only available in Universe shops'; end if;
    if not _eco.retail_cod_enabled then raise exception 'This shop does not offer cash on delivery'; end if;
    if _fulfillment <> 'delivery' then raise exception 'Cash on delivery requires delivery'; end if;
    _dpct := _eco.retail_delivery_split_delivery_pct; _cpct := _eco.retail_delivery_split_collector_pct;
    if coalesce(_dpct, 0) + coalesce(_cpct, 0) <> 100 then
      raise exception 'Cash on delivery is not fully configured for this shop';
    end if;
    _dfee := round(coalesce(_eco.retail_delivery_fee, 0), 2);
  end if;
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'Your cart is empty';
  end if;

  _pct := round(public.retail_platform_fee_percent(), 2);
  _cb_recipient := case when _payment_method in ('credit','cod')
                        then public.retail_cashback_recipient(_uid, _seller, _ecosystem_id) end;
  -- Self purchase: the buyer is the entitled cashback recipient and pays with coins.
  _self := public.retail_is_self_purchase(_uid, _seller, _ecosystem_id, _payment_method);

  select coalesce(full_name, 'Member') into _name from public.profiles where id = _uid;
  _ono := 'RO-' || to_char(now(), 'YYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));

  insert into public.retail_orders
    (order_no, ecosystem_id, customer_id, customer_name, fulfillment, delivery_address,
     delivery_notes, payment_method, total, seller_total, platform_fee_percent, platform_fee_amount,
     seller_id, cashback_recipient_id, cashback_total,
     delivery_fee, delivery_split_delivery_pct, delivery_split_collector_pct, client_ref)
  values (_ono, _ecosystem_id, _uid, _name, _fulfillment,
          nullif(btrim(coalesce(_address,'')), ''), nullif(btrim(coalesce(_notes,'')), ''),
          _payment_method, 0, 0, _pct, 0, _seller, _cb_recipient, 0,
          _dfee, _dpct, _cpct, _client_ref)
  returning id into _oid;

  for _item in select * from jsonb_array_elements(_items) loop
    _qty := greatest(coalesce((_item->>'quantity')::int, 0), 0);
    if _qty = 0 then continue; end if;
    select * into _p from public.retail_products
     where id = (_item->>'product_id')::uuid and ecosystem_id = _ecosystem_id
       and active and published and not archived
     for update;
    if _p is null then raise exception 'A product in your cart is no longer available'; end if;
    if _p.stock < _qty then
      raise exception '% has only % left', _p.name, _p.stock;
    end if;

    _wholesale := coalesce(_p.wholesale_price, 0) > 0
              and coalesce(_p.wholesale_min_qty, 0) > 0
              and _qty >= _p.wholesale_min_qty;
    _unit := case when _wholesale then _p.wholesale_price else _p.price end;
    _seller_line := round(_unit * _qty, 2);
    _fee_line := round(_seller_line * _pct / 100, 2);
    _line := _seller_line + _fee_line;
    _cb_line := case when _cb_recipient is null then 0
                     else public.retail_line_cashback(_p.cashback_mode, _p.cashback_value, _seller_line, _qty) end;

    update public.retail_products set stock = stock - _qty where id = _p.id;
    insert into public.retail_order_items
      (order_id, product_id, product_name, unit_price, quantity, line_total,
       regular_unit_price, wholesale_applied, seller_line_total, fee_amount,
       cashback_mode, cashback_value, cashback_amount)
    values (_oid, _p.id, _p.name, _unit, _qty, _line,
            _p.price, _wholesale, _seller_line, _fee_line,
            _p.cashback_mode, _p.cashback_value, _cb_line);
    _seller_total := _seller_total + _seller_line;
    _fee_total := _fee_total + _fee_line;
    _cb_total := _cb_total + _cb_line;
    _total := _total + _line;
  end loop;

  if _seller_total <= 0 then raise exception 'Your cart is empty'; end if;
  if _cb_total > _seller_total then raise exception 'Cashback cannot exceed the seller amount'; end if;

  if _payment_method = 'cod' and not public.retail_cod_seller_funded(_ecosystem_id, _fee_total) then
    raise exception 'Cash on delivery is temporarily unavailable for this shop';
  end if;

  -- Net charge: a self purchase deducts the entitled cashback at checkout, once,
  -- inside the single hold entry. Cashback can never exceed the retail total.
  select n.self_cashback into _self_cb
    from public.universe_self_purchase_net(_uid, _cb_recipient, _ecosystem_id, _payment_method, _total, _cb_total) n;
  _self_cb := case when _self then _self_cb else 0 end;
  _charge := case when _payment_method = 'credit' then round(_total - _self_cb, 2) end;

  if _payment_method = 'credit' then
    _acct := public.retail_wallet_for(_uid, _ecosystem_id);
    _tx := public.new_tx_id();
    -- Shared Universe purchase layer: ONE net debit with the breakdown inside.
    _hold := public.universe_purchase_debit(_acct, _uid, _ecosystem_id, _uid, _tx, _ono, null, 'retail_hold',
               'Retail order hold — ' || _ono, 'Retail order ' || _ono, _total, _self_cb);
    update public.retail_orders
       set credit_hold_tx = _tx, hold_ledger_id = _hold, wallet_account_id = _acct
     where id = _oid;
  end if;

  update public.retail_orders
     set total = _total, seller_total = _seller_total, platform_fee_amount = _fee_total,
         cashback_total = _cb_total, buyer_charge = _charge, self_cashback = _self_cb
   where id = _oid;

  perform public.notify_member(u.user_id, _ecosystem_id, 'retail_order',
    'New retail order ' || _ono,
    _name || ' placed a ' || case _payment_method when 'cod' then 'cash-on-delivery' else _payment_method end
      || ' order worth ' || (_total + _dfee)::text || ' coins.',
    '/admin/orders')
    from public.user_roles u
   where u.ecosystem_id = _ecosystem_id and u.role = 'admin';

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, _uid, _name, 'Placed retail order', _ono,
          jsonb_build_object('order_id', _oid, 'total', _total, 'seller_total', _seller_total,
                             'platform_fee_percent', _pct, 'platform_fee_amount', _fee_total,
                             'cashback_total', _cb_total, 'cashback_recipient_id', _cb_recipient,
                             'self_purchase', _self, 'self_cashback', _self_cb, 'buyer_charge', _charge,
                             'seller_id', _seller, 'delivery_fee', _dfee,
                             'delivery_split', case when _payment_method = 'cod' then jsonb_build_object('delivery', _dpct, 'collector', _cpct) end,
                             'payment_method', _payment_method, 'fulfillment', _fulfillment));

  return query select _oid, _ono, _total;
end $function$;
