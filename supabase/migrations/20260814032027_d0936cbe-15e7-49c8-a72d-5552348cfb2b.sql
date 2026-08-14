-- ---------- helper: current money settings ----------
create or replace function public.money_settings()
returns table (credits_per_unit numeric, php_per_unit numeric, fee_percent numeric,
               cashback_reseller integer, cashback_subreseller integer)
language sql stable security definer set search_path to 'public'
as $$
  select cash_out_credits_per_unit, cash_out_php_per_unit, withdrawal_fee_percent,
         cashback_reseller_percent, cashback_subreseller_percent
    from public.platform_settings where id = 1;
$$;

-- ---------- Part A: admin remainder cashback ----------
create or replace function public.purchase_voucher(_product_id uuid, _quantity integer default 1)
returns TABLE(tx_id text, codes text[], sale_price numeric, unit_price numeric, quantity integer,
              product_name text, sale_id uuid, points_earned integer, commission_amount numeric,
              commission_percent integer)
language plpgsql security definer set search_path to 'public'
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

  select id into _acct from public.credit_accounts where user_id = _subject;
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := floor(_total / _ratio)::int; end if;

  if _earn > 0 then
    select id into _pacct from public.points_accounts where user_id = _subject;
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

  _uprate := public.upline_commission_rate_for(_my_eco);

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
      _rate := public.sale_commission_rate_for(_c.source_user_id);
      _amt := round(_c.amount * _rate / 100.0, 2);
      if _rate > 0 and _amt > 0 then
        insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                             source_ledger_id, credits_consumed, commission_percent,
                                             commission_amount, kind)
        values (_my_eco, _sale, _c.source_user_id, _c.lot_id, _c.ledger_id, _c.amount, _rate, _amt, 'sale_cashback')
        on conflict do nothing;
      end if;

      if _uprate > 0 and _c.source_kind = 'subreseller' then
        select p.reseller_id into _src_parent from public.profiles p where p.id = _c.source_user_id;
        if _src_parent is not null and _src_parent <> _subject then
          _amt := round(_c.amount * _uprate / 100.0, 2);
          if _amt > 0 then
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
  elsif _role = 'subreseller' then
    if _uprate > 0 and _parent is not null and _debit is not null then
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

  -- Shop admin receives the remainder of the purchase after downstream cashback.
  -- Rates are platform-owner controlled; the remainder is derived per sale.
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
    select id into _racct from public.credit_accounts where user_id = _rec.recipient_id;
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

-- ---------- Part B: withdrawals ----------
create or replace function public.request_withdrawal(
  _credits numeric, _payment_mode text, _account_name text default null,
  _account_number text default null, _notes text default null, _request_key text default null)
returns public.withdrawal_requests
language plpgsql security definer set search_path to 'public'
as $$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _acct uuid; _s record; _gross numeric(14,2); _fee numeric(14,2); _net numeric(14,2);
        _row public.withdrawal_requests; _key text; _ledger uuid; _ref text;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  _role := coalesce(public.top_role(_subject), 'customer');
  if _role = 'super_admin' then raise exception 'The platform owner does not withdraw from a member wallet'; end if;
  if _eco is not null and (select coalesce(operations_frozen,false) from public.ecosystems where id = _eco) then
    raise exception 'This shop is temporarily frozen by the platform owner';
  end if;

  if _credits is null or _credits <= 0 then raise exception 'Enter how many credits to cash out'; end if;
  if _credits <> trunc(_credits) then raise exception 'Credits must be a whole number'; end if;
  if _credits > 10000000 then raise exception 'A single withdrawal is limited to 10,000,000 credits'; end if;
  if _payment_mode not in ('physical_cash','ewallet','bank') then raise exception 'Choose a valid payment mode'; end if;
  if _payment_mode in ('ewallet','bank') then
    if coalesce(trim(_account_name),'') = '' or coalesce(trim(_account_number),'') = '' then
      raise exception 'Account name and account number are required for e-wallet and bank payouts';
    end if;
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);
  select * into _row from public.withdrawal_requests where request_key = _key;
  if _row.id is not null then return _row; end if;

  select * into _s from public.money_settings();
  _gross := round(_credits * _s.php_per_unit / _s.credits_per_unit, 2);
  _fee := round(_gross * _s.fee_percent / 100.0, 2);
  _net := round(_gross - _fee, 2);
  if _net <= 0 then raise exception 'That amount is too small to cash out'; end if;

  select id into _acct from public.credit_accounts where user_id = _subject for update;
  if _acct is null then raise exception 'Wallet not found'; end if;

  _ref := 'WD-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_acct, _subject, _eco, 'debit', _credits, 0,
          'Cash out hold — ' || _ref, _ref, _op, _ref, 'withdrawal_hold')
  returning id into _ledger;

  insert into public.withdrawal_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role, credits,
    rate_credits, rate_php, gross_php, fee_percent, fee_php, net_php,
    payment_mode, account_name, account_number, notes, reserve_ledger_id)
  values (_ref, _key, _subject, _eco, _name, _role::text, _credits,
          _s.credits_per_unit, _s.php_per_unit, _gross, _s.fee_percent, _fee, _net,
          _payment_mode, nullif(trim(_account_name),''), nullif(trim(_account_number),''),
          nullif(trim(_notes),''), _ledger)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          'Requested cash out', _name,
          jsonb_build_object('reference', _ref, 'credits', _credits, 'gross_php', _gross,
                             'fee_percent', _s.fee_percent, 'fee_php', _fee, 'net_php', _net,
                             'payment_mode', _payment_mode, 'requester_id', _subject, 'status', 'pending'));
  return _row;
end $$;

create or replace function public.review_withdrawal(_id uuid, _action text, _reason text default null)
returns public.withdrawal_requests
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.withdrawal_requests; _actor text; _acct uuid; _ledger uuid;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can decide withdrawals';
  end if;
  if _action not in ('approve','reject','release') then raise exception 'Unknown action'; end if;

  select * into _row from public.withdrawal_requests where id = _id for update;
  if _row.id is null then raise exception 'Withdrawal request not found'; end if;
  if _row.status in ('released','rejected','cancelled') then
    raise exception 'This withdrawal was already %', _row.status;
  end if;
  if _action = 'approve' and _row.status <> 'pending' then
    raise exception 'Only a pending withdrawal can be approved';
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();

  if _action = 'reject' then
    select id into _acct from public.credit_accounts where user_id = _row.user_id for update;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_acct, _row.user_id, _row.ecosystem_id, 'credit', _row.credits, 0,
            'Cash out returned — ' || _row.reference, _row.reference, auth.uid(),
            _row.reference || '-R', 'withdrawal_return')
    returning id into _ledger;

    update public.withdrawal_requests
       set status = 'rejected', refund_ledger_id = _ledger, reviewed_by = auth.uid(),
           reviewer_name = coalesce(_actor,'Super Admin'), decision_reason = nullif(trim(_reason),''),
           reviewed_at = now()
     where id = _id returning * into _row;
  elsif _action = 'approve' then
    update public.withdrawal_requests
       set status = 'approved', reviewed_by = auth.uid(), reviewer_name = coalesce(_actor,'Super Admin'),
           decision_reason = nullif(trim(_reason),''), reviewed_at = now()
     where id = _id returning * into _row;
  else
    update public.withdrawal_requests
       set status = 'released', reviewed_by = auth.uid(), reviewer_name = coalesce(_actor,'Super Admin'),
           decision_reason = coalesce(nullif(trim(_reason),''), decision_reason),
           reviewed_at = coalesce(reviewed_at, now()), released_at = now()
     where id = _id returning * into _row;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, auth.uid(), coalesce(_actor,'Super Admin'),
          case _action when 'approve' then 'Approved cash out'
                       when 'reject' then 'Rejected cash out'
                       else 'Released cash out payment' end,
          _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'credits', _row.credits,
                             'net_php', _row.net_php, 'fee_php', _row.fee_php,
                             'status', _row.status, 'requester_id', _row.user_id,
                             'reason', nullif(trim(_reason),'')));
  return _row;
end $$;

create or replace function public.cancel_withdrawal(_id uuid)
returns public.withdrawal_requests
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.withdrawal_requests; _subject uuid; _acct uuid; _ledger uuid;
begin
  _subject := public.effective_uid();
  select * into _row from public.withdrawal_requests where id = _id for update;
  if _row.id is null then raise exception 'Withdrawal request not found'; end if;
  if _row.user_id <> _subject then raise exception 'You can only cancel your own request'; end if;
  if _row.status <> 'pending' then raise exception 'Only a pending request can be cancelled'; end if;

  select id into _acct from public.credit_accounts where user_id = _row.user_id for update;
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_acct, _row.user_id, _row.ecosystem_id, 'credit', _row.credits, 0,
          'Cash out cancelled — ' || _row.reference, _row.reference, auth.uid(),
          _row.reference || '-X', 'withdrawal_return')
  returning id into _ledger;

  update public.withdrawal_requests
     set status = 'cancelled', refund_ledger_id = _ledger, reviewed_at = now()
   where id = _id returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), _row.requester_name),
          'Cancelled cash out', _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'credits', _row.credits, 'status', 'cancelled'));
  return _row;
end $$;

-- ---------- Part C: cash in ----------
create or replace function public.request_cash_in(
  _method_id uuid, _amount_php numeric, _payer_reference text default null,
  _notes text default null, _request_key text default null)
returns public.cash_in_requests
language plpgsql security definer set search_path to 'public'
as $$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  _role := coalesce(public.top_role(_subject), 'customer');

  if _amount_php is null or _amount_php <= 0 then raise exception 'Enter how much you are paying'; end if;
  if _amount_php > 10000000 then raise exception 'A single cash in is limited to 10,000,000'; end if;

  select * into _m from public.payment_methods where id = _method_id;
  if _m.id is null or not _m.active then raise exception 'Choose an available payment method'; end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);
  select * into _row from public.cash_in_requests where request_key = _key;
  if _row.id is not null then return _row; end if;

  select * into _s from public.money_settings();
  _credits := round(_amount_php * _s.credits_per_unit / _s.php_per_unit, 2);
  if _credits <= 0 then raise exception 'That amount is too small to cash in'; end if;

  _ref := 'CI-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  insert into public.cash_in_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
    amount_php, rate_credits, rate_php, credits, method_id, method_name, method_type,
    method_details, payer_reference, notes)
  values (_ref, _key, _subject, _eco, _name, _role::text,
          _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits, _m.id, _m.name, _m.method_type,
          jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                             'account_number', _m.account_number, 'notes', _m.notes),
          nullif(trim(_payer_reference),''), nullif(trim(_notes),''))
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          'Requested cash in', _name,
          jsonb_build_object('reference', _ref, 'amount_php', _amount_php, 'credits', _credits,
                             'method', _m.name, 'requester_id', _subject, 'status', 'pending'));
  return _row;
end $$;

create or replace function public.review_cash_in(_id uuid, _action text, _reason text default null)
returns public.cash_in_requests
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.cash_in_requests; _actor text; _acct uuid; _ledger uuid; _tx text;
        _before numeric(14,2); _after numeric(14,2); _target text; _eco_name text; _role app_role;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can decide cash in requests';
  end if;
  if _action not in ('approve','reject') then raise exception 'Unknown action'; end if;

  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then raise exception 'Cash in request not found'; end if;
  if _row.status <> 'pending' then raise exception 'This request was already %', _row.status; end if;

  select full_name into _actor from public.profiles where id = auth.uid();

  if _action = 'reject' then
    update public.cash_in_requests
       set status = 'rejected', reviewed_by = auth.uid(), reviewer_name = coalesce(_actor,'Super Admin'),
           decision_reason = nullif(trim(_reason),''), reviewed_at = now()
     where id = _id returning * into _row;
  else
    select id, balance into _acct, _before from public.credit_accounts where user_id = _row.user_id for update;
    if _acct is null then raise exception 'This member has no credit wallet yet'; end if;
    _tx := public.new_tx_id();

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind,
                                      base_amount, commission_percent, commission_amount)
    values (_acct, _row.user_id, _row.ecosystem_id, 'credit', _row.credits, 0,
            'Cash in approved — ' || _row.reference, _row.reference, auth.uid(), _tx,
            'cash_in', _row.credits, 0, 0)
    returning id, balance_after into _ledger, _after;

    select p.full_name || ' — ' || p.email into _target from public.profiles p where p.id = _row.user_id;
    select name into _eco_name from public.ecosystems where id = _row.ecosystem_id;
    select role into _role from public.user_roles where user_id = _row.user_id limit 1;

    insert into public.platform_credit_issuances (
      tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name,
      recipient_role, ecosystem_id, ecosystem_name, amount, balance_before, balance_after,
      reason, category, reference, ledger_id)
    values (_tx, 'cash_in:' || _row.id::text, auth.uid(), coalesce(_actor,'Super Admin'),
            _row.user_id, coalesce(_target, _row.requester_name), _role, _row.ecosystem_id, _eco_name,
            _row.credits, _before, _after,
            'Cash in payment verified — ' || _row.reference, 'cash_in', _row.reference, _ledger);

    update public.cash_in_requests
       set status = 'approved', ledger_id = _ledger, reviewed_by = auth.uid(),
           reviewer_name = coalesce(_actor,'Super Admin'), decision_reason = nullif(trim(_reason),''),
           reviewed_at = now()
     where id = _id returning * into _row;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, auth.uid(), coalesce(_actor,'Super Admin'),
          case _action when 'approve' then 'Approved cash in' else 'Rejected cash in' end,
          _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'amount_php', _row.amount_php,
                             'credits', _row.credits, 'status', _row.status,
                             'requester_id', _row.user_id, 'reason', nullif(trim(_reason),'')));
  return _row;
end $$;

create or replace function public.cancel_cash_in(_id uuid)
returns public.cash_in_requests
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.cash_in_requests;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then raise exception 'Cash in request not found'; end if;
  if _row.user_id <> public.effective_uid() then raise exception 'You can only cancel your own request'; end if;
  if _row.status <> 'pending' then raise exception 'Only a pending request can be cancelled'; end if;
  update public.cash_in_requests set status = 'cancelled', reviewed_at = now()
   where id = _id returning * into _row;
  return _row;
end $$;

revoke execute on function public.request_withdrawal(numeric, text, text, text, text, text) from anon;
revoke execute on function public.review_withdrawal(uuid, text, text) from anon;
revoke execute on function public.cancel_withdrawal(uuid) from anon;
revoke execute on function public.request_cash_in(uuid, numeric, text, text, text) from anon;
revoke execute on function public.review_cash_in(uuid, text, text) from anon;
revoke execute on function public.cancel_cash_in(uuid) from anon;
revoke execute on function public.set_platform_money_settings(integer, integer, numeric, numeric, numeric) from anon;
revoke execute on function public.money_settings() from anon;
