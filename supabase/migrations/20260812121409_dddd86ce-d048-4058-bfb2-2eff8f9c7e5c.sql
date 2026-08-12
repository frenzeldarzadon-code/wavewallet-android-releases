
-- 1. New per-ecosystem settings -------------------------------------------------
alter table public.ecosystems
  add column if not exists default_upline_commission_percent integer not null default 0,
  add column if not exists default_reseller_discount_percent integer not null default 0,
  add column if not exists default_subreseller_discount_percent integer not null default 0;

alter table public.ecosystems
  drop constraint if exists ecosystems_upline_pct_chk,
  drop constraint if exists ecosystems_res_disc_chk,
  drop constraint if exists ecosystems_sub_disc_chk;
alter table public.ecosystems
  add constraint ecosystems_upline_pct_chk check (default_upline_commission_percent between 0 and 100),
  add constraint ecosystems_res_disc_chk check (default_reseller_discount_percent between 0 and 100),
  add constraint ecosystems_sub_disc_chk check (default_subreseller_discount_percent between 0 and 100);

-- 2. Commission rows gain a kind; upline rows are not lot-scoped -----------------
alter table public.sale_commissions
  add column if not exists kind text not null default 'sale_cashback';
alter table public.sale_commissions
  drop constraint if exists sale_commissions_kind_chk;
alter table public.sale_commissions
  add constraint sale_commissions_kind_chk check (kind in ('sale_cashback','upline'));
alter table public.sale_commissions alter column source_lot_id drop not null;
alter table public.sale_commissions drop constraint if exists sale_commissions_sale_id_source_lot_id_key;
create unique index if not exists sale_commissions_lot_kind_uidx
  on public.sale_commissions (sale_id, source_lot_id, kind) where source_lot_id is not null;
create unique index if not exists sale_commissions_upline_uidx
  on public.sale_commissions (sale_id, recipient_id) where kind = 'upline';

alter table public.voucher_sales
  add column if not exists upline_recipient_id uuid,
  add column if not exists upline_commission_percent integer not null default 0,
  add column if not exists upline_commission_amount numeric(14,2) not null default 0;

-- 3. Loading commission retired for all future transactions ----------------------
create or replace function public.commission_rate_for(_sender uuid, _recipient uuid)
returns integer language sql stable security definer set search_path = public as $$
  -- Retired: credit transfers carry no loading commission. Historical ledger rows
  -- keep the percentages they were recorded with.
  select 0;
$$;

create or replace function public.upline_commission_rate_for(_ecosystem_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select least(greatest(coalesce(
    (select e.default_upline_commission_percent from public.ecosystems e where e.id = _ecosystem_id), 0), 0), 100);
$$;

create or replace function public.voucher_discount_percent_for(_user_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare _eco uuid; _own integer; _pct integer := 0; _is_sub boolean;
begin
  select p.ecosystem_id, p.reseller_discount_percent into _eco, _own
    from public.profiles p where p.id = _user_id;
  if _eco is null then return 0; end if;

  if exists (select 1 from public.user_roles ur
              where ur.user_id = _user_id and ur.role = 'subreseller' and ur.ecosystem_id = _eco) then
    _is_sub := true;
  elsif exists (select 1 from public.user_roles ur
                 where ur.user_id = _user_id and ur.role = 'reseller' and ur.ecosystem_id = _eco) then
    _is_sub := false;
  else
    return 0;
  end if;

  if coalesce(_own, 0) > 0 then
    _pct := _own;
  elsif _is_sub then
    select default_subreseller_discount_percent into _pct from public.ecosystems where id = _eco;
  else
    select default_reseller_discount_percent into _pct from public.ecosystems where id = _eco;
  end if;
  return least(greatest(coalesce(_pct, 0), 0), 100);
end; $$;

grant execute on function public.upline_commission_rate_for(uuid) to authenticated;
grant execute on function public.voucher_discount_percent_for(uuid) to authenticated;

-- 4. Transfers: exact amounts, zero commission -----------------------------------
create or replace function public.transfer_credits(_recipient_id uuid, _amount numeric, _note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  _my_eco uuid; _eco uuid; _from uuid; _to uuid; _tx text;
  _status public.account_status; _actor_name text; _target text; _priv boolean;
begin
  perform public.require_operational();
  perform public.assert_actor_active();
  select ecosystem_id into _my_eco from public.profiles where id = auth.uid();
  select ecosystem_id, status, full_name || ' — ' || email
    into _eco, _status, _target
  from public.profiles where id = _recipient_id;

  if _eco is null then raise exception 'Recipient not found'; end if;
  _priv := public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _eco);
  if public.is_super_admin(auth.uid()) then _my_eco := coalesce(_my_eco, _eco); end if;
  if _my_eco is null or _eco is distinct from _my_eco then
    raise exception 'Transfers are only allowed inside your own shop';
  end if;
  if _recipient_id = auth.uid() then raise exception 'You cannot send credits to yourself'; end if;
  if _status <> 'active' then raise exception 'That account is suspended'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  if not _priv then
    if public.has_role(auth.uid(), 'reseller') or public.has_role(auth.uid(), 'subreseller') then
      if not public.can_load_credits(auth.uid(), _recipient_id) then
        raise exception 'You can only send credits to customers in your shop and to your own subresellers';
      end if;
    else
      if public.is_super_admin(_recipient_id)
         or public.is_ecosystem_admin(_recipient_id, _eco)
         or public.has_role(_recipient_id, 'reseller')
         or public.has_role(_recipient_id, 'subreseller') then
        raise exception 'Credits can only be sent to fellow customers';
      end if;
    end if;
  end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _recipient_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _my_eco, 'debit', _amount, 0, 'Credit transfer sent',
          nullif(trim(_note),''), auth.uid(), _tx, _amount, 0, 0);

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_to, _recipient_id, _my_eco, 'credit', _amount, 0, 'Credit transfer received',
          nullif(trim(_note),''), auth.uid(), _tx || '-R', _amount, 0, 0);

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_my_eco, auth.uid(), coalesce(_actor_name,'Member'), 'Transferred credits', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'commission_percent', 0,
                             'commission_amount', 0, 'total_received', _amount, 'tx_id', _tx));
  return _tx;
end; $$;

create or replace function public.admin_adjust_credits(_user_id uuid, _amount numeric, _reason text, _reference text default null)
returns text language plpgsql security definer set search_path = public as $$
declare _eco uuid; _acct uuid; _tx text; _actor text; _target text; _dir text;
begin
  perform public.require_operational();
  select p.ecosystem_id, p.full_name || ' — ' || p.email into _eco, _target
  from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _amount is null or _amount = 0 then raise exception 'Enter an amount'; end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;

  select id into _acct from public.credit_accounts where user_id = _user_id;
  if _acct is null then raise exception 'This member has no credit wallet yet'; end if;

  _tx := public.new_tx_id();
  _dir := case when _amount > 0 then 'credit' else 'debit' end;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, _dir, abs(_amount), 0, trim(_reason),
          nullif(trim(_reference),''), auth.uid(), _tx, abs(_amount), 0, 0);

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'),
          case when _amount > 0 then 'Added credits' else 'Deducted credits' end,
          coalesce(_target,''),
          jsonb_build_object('amount', abs(_amount), 'reason', trim(_reason), 'reference', _reference,
                             'commission_percent', 0, 'commission_amount', 0,
                             'total_received', abs(_amount), 'tx_id', _tx));
  return _tx;
end; $$;

-- 5. Settings action for the new rate model --------------------------------------
create or replace function public.set_ecosystem_rates(
  _ecosystem_id uuid,
  _reseller_sale_percent integer,
  _subreseller_sale_percent integer,
  _upline_percent integer,
  _reseller_discount_percent integer,
  _subreseller_discount_percent integer)
returns public.ecosystems language plpgsql security definer set search_path = public as $$
declare _row public.ecosystems; _prev public.ecosystems; _actor text;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this shop';
  end if;
  select * into _prev from public.ecosystems where id = _ecosystem_id;
  if _prev.id is null then raise exception 'Shop not found'; end if;
  if _reseller_sale_percent not between 0 and 100
     or _subreseller_sale_percent not between 0 and 100
     or _upline_percent not between 0 and 100
     or _reseller_discount_percent not between 0 and 100
     or _subreseller_discount_percent not between 0 and 100 then
    raise exception 'Every percentage must be between 0 and 100';
  end if;

  update public.ecosystems e
     set default_sale_commission_percent = _reseller_sale_percent,
         default_subreseller_sale_commission_percent = _subreseller_sale_percent,
         default_upline_commission_percent = _upline_percent,
         default_reseller_discount_percent = _reseller_discount_percent,
         default_subreseller_discount_percent = _subreseller_discount_percent,
         updated_at = now()
   where e.id = _ecosystem_id
   returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Updated earning rates', _row.name,
          jsonb_build_object(
            'previous', jsonb_build_object(
              'reseller_sale_percent', _prev.default_sale_commission_percent,
              'subreseller_sale_percent', _prev.default_subreseller_sale_commission_percent,
              'upline_percent', _prev.default_upline_commission_percent,
              'reseller_discount_percent', _prev.default_reseller_discount_percent,
              'subreseller_discount_percent', _prev.default_subreseller_discount_percent),
            'new', jsonb_build_object(
              'reseller_sale_percent', _reseller_sale_percent,
              'subreseller_sale_percent', _subreseller_sale_percent,
              'upline_percent', _upline_percent,
              'reseller_discount_percent', _reseller_discount_percent,
              'subreseller_discount_percent', _subreseller_discount_percent),
            'applies_to', 'future transactions only'));
  return _row;
end; $$;

grant execute on function public.set_ecosystem_rates(uuid,integer,integer,integer,integer,integer) to authenticated;

-- 6. Purchase engine: seller cashback + parent upline, snapshotted ----------------
create or replace function public.purchase_voucher(_product_id uuid, _quantity integer default 1)
returns table(tx_id text, codes text[], sale_price numeric, unit_price numeric, quantity integer,
              product_name text, sale_id uuid, points_earned integer, commission_amount numeric,
              commission_percent integer)
language plpgsql security definer set search_path = public as $$
declare _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _unit numeric; _total numeric;
        _tx text; _sale uuid; _status public.account_status; _parent uuid;
        _ratio numeric; _ver integer; _earn integer := 0;
        _qty integer; _ids uuid[]; _codes text[]; _debit uuid;
        _c record; _rate integer; _amt numeric(14,2); _uprate integer := 0;
        _bonus_total numeric(14,2) := 0; _top_recipient uuid; _top_rate integer := 0;
        _upline_total numeric(14,2) := 0; _upline_recipient uuid;
        _racct uuid; _ledger uuid; _rec record; _seq integer := 0; _src_parent uuid;
begin
  perform public.require_operational();
  _qty := coalesce(_quantity, 1);
  if _qty < 1 or _qty > 50 then raise exception 'Choose between 1 and 50 vouchers'; end if;

  select ecosystem_id, status, reseller_id into _my_eco, _status, _parent
    from public.profiles where id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;
  if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then
    raise exception 'This shop is temporarily frozen by the platform owner';
  end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;

  select role into _role from public.user_roles where user_id = auth.uid()
   order by case role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
  _role := coalesce(_role, 'customer');
  if _role in ('reseller','subreseller') then
    _discount := public.voucher_discount_percent_for(auth.uid());
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
                                    reseller_id, parent_reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version,
                                    quantity, unit_price, commission_percent, commission_amount)
  values (_my_eco, _p.id, _p.name, auth.uid(), _role,
          case when _role in ('reseller','subreseller') then auth.uid() else _parent end,
          _parent,
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

  _uprate := public.upline_commission_rate_for(_my_eco);

  if _role = 'customer' then
    -- Seller cashback follows the credit lots that actually funded this purchase.
    for _c in
      select cc.amount, l.id as lot_id, l.ledger_id, l.source_user_id, l.source_kind
        from public.credit_lot_consumptions cc
        join public.credit_lots l on l.id = cc.lot_id
       where cc.ledger_id = _debit
         and l.source_user_id is not null
         and l.source_kind in ('reseller','subreseller')
    loop
      if _c.source_user_id = auth.uid() then continue; end if;
      _rate := public.sale_commission_rate_for(_c.source_user_id);
      _amt := round(_c.amount * _rate / 100.0, 2);
      if _rate > 0 and _amt > 0 then
        insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                             source_ledger_id, credits_consumed, commission_percent,
                                             commission_amount, kind)
        values (_my_eco, _sale, _c.source_user_id, _c.lot_id, _c.ledger_id, _c.amount, _rate, _amt, 'sale_cashback')
        on conflict do nothing;
      end if;

      -- Parent reseller of a subreseller seller earns the configured upline commission.
      if _uprate > 0 and _c.source_kind = 'subreseller' then
        select p.reseller_id into _src_parent from public.profiles p where p.id = _c.source_user_id;
        if _src_parent is not null and _src_parent <> auth.uid() then
          _amt := round(_c.amount * _uprate / 100.0, 2);
          if _amt > 0 then
            insert into public.sale_commissions as sc (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                                 source_ledger_id, credits_consumed, commission_percent,
                                                 commission_amount, kind)
            values (_my_eco, _sale, _src_parent, null, _debit, _c.amount, _uprate, _amt, 'upline')
            on conflict (sale_id, recipient_id) where kind = 'upline'
            do update set credits_consumed = sc.credits_consumed + excluded.credits_consumed,
                          commission_amount = sc.commission_amount + excluded.commission_amount;
          end if;
        end if;
      end if;
    end loop;
  elsif _role = 'subreseller' then
    -- No self-commission; the parent reseller earns upline commission on the amount paid.
    if _uprate > 0 and _parent is not null then
      _amt := round(_total * _uprate / 100.0, 2);
      if _amt > 0 then
        insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                             source_ledger_id, credits_consumed, commission_percent,
                                             commission_amount, kind)
        values (_my_eco, _sale, _parent, null, _debit, _total, _uprate, _amt, 'upline')
        on conflict do nothing;
      end if;
    end if;
  end if;
  -- A reseller buying for themselves has no upline and earns nothing.

  for _rec in
    select sc.recipient_id, sc.kind,
           sum(sc.commission_amount) as amount,
           sum(sc.credits_consumed) as basis,
           max(sc.commission_percent) as pct
      from public.sale_commissions sc
     where sc.sale_id = _sale and sc.ledger_id is null
     group by sc.recipient_id, sc.kind
  loop
    select id into _racct from public.credit_accounts where user_id = _rec.recipient_id;
    continue when _racct is null;
    _seq := _seq + 1;

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind,
                                      base_amount, commission_percent, commission_amount)
    values (_racct, _rec.recipient_id, _my_eco, 'credit', _rec.amount, 0,
            case when _rec.kind = 'upline'
                 then 'Upline commission — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of your downline sale)'
                 else 'Sales cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of credits you supplied)'
            end,
            _tx, auth.uid(), _tx || '-C' || _seq,
            _sale, case when _rec.kind = 'upline' then 'upline_commission' else 'sale_commission' end,
            _rec.basis, _rec.pct, _rec.amount)
    returning id into _ledger;

    update public.sale_commissions sc set ledger_id = _ledger
     where sc.sale_id = _sale and sc.recipient_id = _rec.recipient_id
       and sc.kind = _rec.kind and sc.ledger_id is null;

    if _rec.kind = 'upline' then
      _upline_total := _upline_total + _rec.amount;
      _upline_recipient := _rec.recipient_id;
    else
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

  return query select _tx, _codes, _total, _unit, _qty, _p.name, _sale, _earn,
                      _bonus_total + _upline_total, greatest(_top_rate, case when _upline_total > 0 then _uprate else 0 end);
end; $$;
