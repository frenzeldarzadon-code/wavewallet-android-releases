alter table public.cash_in_requests
  add column if not exists wallet_scope text not null default 'shop'
  check (wallet_scope in ('shop','universe'));
alter table public.withdrawal_requests
  add column if not exists wallet_scope text not null default 'shop'
  check (wallet_scope in ('shop','universe'));

-- ---------------------------------------------------------------------------
-- request_withdrawal: add _wallet_scope ('shop' default | 'universe')
-- ---------------------------------------------------------------------------
drop function if exists public.request_withdrawal(numeric, text, text, text, text, text, text);

create or replace function public.request_withdrawal(
  _credits numeric, _payment_mode text, _account_name text default null,
  _account_number text default null, _notes text default null, _request_key text default null,
  _cashout_path text default 'superadmin', _wallet_scope text default 'shop')
returns public.withdrawal_requests
language plpgsql security definer set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _acct uuid; _s record; _gross numeric(14,2); _fee numeric(14,2); _net numeric(14,2);
        _row public.withdrawal_requests; _key text; _ledger uuid; _ref text;
        _path text; _fee_pct numeric(6,3); _admin uuid; _admins int; _scope text;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  _scope := lower(coalesce(nullif(trim(_wallet_scope),''), 'shop'));
  if _scope not in ('shop','universe') then raise exception 'Choose a valid wallet'; end if;
  _path := lower(coalesce(nullif(trim(_cashout_path),''), 'superadmin'));
  if _path not in ('admin','superadmin') then raise exception 'Choose a valid cash out destination'; end if;
  -- The Universe wallet has no shop and no upline: only the platform settles it.
  if _scope = 'universe' and _path <> 'superadmin' then
    raise exception 'Universe wallet cash outs are settled by the platform owner';
  end if;

  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  _role := coalesce(public.top_role(_subject), 'customer');
  if _role = 'super_admin' then raise exception 'The platform owner does not withdraw from a member wallet'; end if;

  if _scope = 'universe' then
    -- ONE global Universe wallet, regardless of the member's active shop.
    _eco := null;
  elsif _eco is not null and (select coalesce(operations_frozen,false) from public.ecosystems where id = _eco) then
    raise exception 'This shop is temporarily frozen by the platform owner';
  end if;

  if _path = 'admin' then
    if _eco is null then raise exception 'Choose a shop before cashing out with your shop admin'; end if;
    select count(*) into _admins from public.ecosystem_memberships m
     where m.ecosystem_id = _eco and m.role = 'admin'
       and m.membership_state = 'active' and m.status = 'active';
    if _admins = 0 then raise exception 'This shop has no active admin to settle a cash out'; end if;
    select m.user_id into _admin from public.ecosystem_memberships m
     where m.ecosystem_id = _eco and m.role = 'admin'
       and m.membership_state = 'active' and m.status = 'active'
     order by m.created_at limit 1;
    if public.is_ecosystem_admin(_subject, _eco) then
      raise exception 'A shop admin cannot cash out with themselves — use the platform cash out';
    end if;
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
  -- The platform cash out fee never applies to a shop-admin cash out.
  _fee_pct := case when _path = 'admin' then 0 else _s.fee_percent end;
  _fee := round(_gross * _fee_pct / 100.0, 2);
  _net := round(_gross - _fee, 2);
  if _net <= 0 then raise exception 'That amount is too small to cash out'; end if;

  if _scope = 'universe' then
    _acct := public.ensure_global_wallet(_subject);
    perform 1 from public.credit_accounts where id = _acct for update;
  else
    _acct := public.ensure_credit_account(_subject, _eco);
  end if;
  if _acct is null then raise exception 'Wallet not found'; end if;

  _ref := case when _path = 'admin' then 'AW-' else 'WD-' end
          || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_acct, _subject, _eco, 'debit', _credits, 0,
          'Cash out hold — ' || _ref, _ref, _op, _ref, 'withdrawal_hold')
  returning id into _ledger;

  insert into public.withdrawal_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role, credits,
    rate_credits, rate_php, gross_php, fee_percent, fee_php, net_php,
    payment_mode, account_name, account_number, notes, reserve_ledger_id, account_id,
    cashout_path, admin_id, wallet_scope)
  values (_ref, _key, _subject, _eco, _name, _role::text, _credits,
          _s.credits_per_unit, _s.php_per_unit, _gross, _fee_pct, _fee, _net,
          _payment_mode, nullif(trim(_account_name),''), nullif(trim(_account_number),''),
          nullif(trim(_notes),''), _ledger, _acct, _path, _admin, _scope)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          'Requested cash out', _name,
          jsonb_build_object('reference', _ref, 'credits', _credits, 'gross_php', _gross,
                             'fee_percent', _fee_pct, 'fee_php', _fee, 'net_php', _net,
                             'payment_mode', _payment_mode, 'requester_id', _subject,
                             'cashout_path', _path, 'wallet_scope', _scope, 'status', 'pending'));
  return _row;
end $function$;

revoke all on function public.request_withdrawal(numeric, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.request_withdrawal(numeric, text, text, text, text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- request_cash_in: add _wallet_scope ('shop' default | 'universe')
-- ---------------------------------------------------------------------------
drop function if exists public.request_cash_in(uuid, numeric, text, text, text, text, text, text, timestamptz, jsonb);

create or replace function public.request_cash_in(
  _method_id uuid, _amount_php numeric, _payer_reference text default null, _notes text default null,
  _request_key text default null, _proof_path text default null, _payer_number text default null,
  _funding_source text default 'platform', _paid_at timestamptz default null, _ocr jsonb default null,
  _wallet_scope text default 'shop')
returns public.cash_in_requests
language plpgsql security definer set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _fee numeric(14,2); _net numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text; _proof text; _folder text;
        _ref_key text; _num text; _num_key text; _dup boolean := false; _prev uuid;
        _fund text; _admin uuid; _admin_acct uuid; _avail numeric(14,2);
        _ocr_ref text; _ocr_ref_key text; _ocr_amount numeric(14,2); _ocr_sender text;
        _ocr_sender_key text; _ocr_paid timestamptz; _est_key text; _paid timestamptz;
        _prev_row public.cash_in_requests; _src text; _ref_edited boolean := false;
        _paid_edited boolean := false; _scope text;
        _dupe_reason constant text :=
          'This GCash reference was already submitted. Held for manual investigation — '
          || 'the earlier transaction was left untouched.';
begin
  _op := auth.uid(); _subject := public.effective_uid();
  _scope := lower(coalesce(nullif(trim(_wallet_scope),''), 'shop'));
  if _scope not in ('shop','universe') then raise exception 'Choose a valid wallet'; end if;
  _fund := lower(coalesce(nullif(trim(_funding_source),''), 'platform'));
  if _fund not in ('platform','admin') then raise exception 'Choose a valid cash in destination'; end if;
  if _scope = 'universe' and _fund <> 'platform' then
    raise exception 'Universe wallet cash ins are paid to the platform, not a shop admin';
  end if;

  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if public.is_super_admin(_subject) then
    raise exception 'The platform owner does not hold a member credit balance and cannot cash in';
  end if;
  _role := coalesce(public.top_role(_subject), 'customer');
  -- ONE global Universe wallet: the request carries no shop at all.
  if _scope = 'universe' then _eco := null; end if;

  if _amount_php is null or _amount_php <= 0 then raise exception 'Enter how much you are paying'; end if;
  if _amount_php > 10000000 then raise exception 'A single cash in is limited to 10,000,000'; end if;

  select * into _m from public.payment_methods where id = _method_id;
  if _m.id is null or not _m.active then raise exception 'Choose an available payment method'; end if;
  if _scope = 'universe' and _m.ecosystem_id is not null then
    raise exception 'Universe wallet cash ins must be paid to a platform receiving account';
  end if;

  -- Original screenshot reading (evidence). Never treated as proof of payment.
  _ocr_ref := nullif(btrim(coalesce(_ocr->>'reference','')), '');
  _ocr_ref_key := public.normalize_payment_reference(_ocr_ref);
  _ocr_amount := nullif(_ocr->>'amount_php','')::numeric;
  _ocr_sender := nullif(btrim(coalesce(_ocr->>'sender_number','')), '');
  _ocr_sender_key := public.normalize_ph_mobile(_ocr_sender);
  begin
    _ocr_paid := nullif(_ocr->>'paid_at','')::timestamptz;
  exception when others then _ocr_paid := null;
  end;

  _ref_key := public.normalize_payment_reference(_payer_reference);
  _est_key := coalesce(_ref_key, _ocr_ref_key);
  _ref_edited := _ref_key is not null and _ocr_ref_key is not null and _ref_key <> _ocr_ref_key;
  _src := case
            when _ref_edited then 'customer_edited'
            when _ref_key is not null then 'customer'
            when _ocr_ref_key is not null then 'ocr'
            else null end;

  _num := coalesce(nullif(trim(_payer_number), ''), _ocr_sender);
  _num_key := public.normalize_ph_mobile(_num);

  _paid := coalesce(_paid_at, _ocr_paid);
  _paid_edited := _paid_at is not null and _ocr_paid is not null
                  and abs(extract(epoch from (_paid_at - _ocr_paid))) > 60;

  _proof := nullif(trim(_proof_path), '');
  if _proof is null then raise exception 'Attach your payment screenshot'; end if;
  _folder := split_part(_proof, '/', 1);
  if _folder is null or _folder = '' or (_folder <> _subject::text and _folder <> _op::text) then
    raise exception 'That payment screenshot does not belong to this member';
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);
  select * into _row from public.cash_in_requests where request_key = _key;
  if _row.id is not null then return _row; end if;

  select * into _s from public.money_settings();
  _fee := round(_amount_php * coalesce(_s.cash_in_fee_percent,0) / 100.0, 2);
  _net := round(_amount_php - _fee, 2);
  if _net <= 0 then raise exception 'That amount is too small to cash in'; end if;
  _credits := round(_net * _s.credits_per_unit / _s.php_per_unit, 2);
  if _credits <= 0 then raise exception 'That amount is too small to cash in'; end if;

  if _fund = 'admin' then
    if _eco is null then raise exception 'Choose a shop before cashing in with your shop admin'; end if;
    _admin := public.shop_funding_admin(_eco);
    if _admin is null then raise exception 'This shop has no active admin to fund a cash in'; end if;
    if _admin = _subject then
      raise exception 'A shop admin cannot cash in against their own wallet';
    end if;
    _admin_acct := public.ensure_credit_account(_admin, _eco);
    if _admin_acct is null then raise exception 'The shop admin has no wallet in this shop'; end if;
    perform 1 from public.credit_accounts where id = _admin_acct for update;
    select c.available into _avail from public.admin_cash_in_capacity(_eco) c;
    if coalesce(_avail,0) < _credits then
      raise exception 'Your shop admin can only fund % credits right now', trunc(coalesce(_avail,0));
    end if;
  end if;

  _ref := 'CI-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  if _est_key is not null then
    select * into _prev_row from public.cash_in_requests c
     where _est_key in (coalesce(c.payer_reference_key,''),
                        coalesce(c.receipt_reference_key,''),
                        coalesce(c.ocr_reference_key,''))
     order by (c.status = 'approved') desc, c.created_at asc
     limit 1;
  end if;

  if _prev_row.id is not null then
    if _prev_row.user_id = _subject and _prev_row.status = 'approved' then
      raise exception 'Payment Already Submitted. This GCash payment was already processed and credited to your WaveWallet account. Nothing was added to your account from this submission.';
    elsif _prev_row.user_id = _subject and _prev_row.status = 'pending' then
      raise exception 'Payment Already Submitted. This GCash payment is already waiting for review as %. Nothing new was created — check that request instead.', _prev_row.reference;
    elsif _prev_row.status in ('rejected','cancelled') then
      _dup := coalesce(_prev_row.decision_reason,'') ilike '%duplicate%'
              or coalesce(_prev_row.decision_reason,'') ilike '%fraud%';
      _prev := case when _dup then _prev_row.id else null end;
    else
      _dup := true; _prev := _prev_row.id;
    end if;
  end if;

  insert into public.cash_in_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
    amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
    method_id, method_name, method_type,
    method_details, payer_reference, payer_reference_key, payer_number, payer_number_key,
    sender_number, sender_number_key, duplicate_reference, duplicate_of,
    notes, proof_path, status, decision_reason,
    funding_source, funding_admin_id, funding_account_id,
    ocr_reference, ocr_reference_key, ocr_amount_php, ocr_sender_number,
    ocr_sender_number_key, ocr_paid_at, ocr_details,
    paid_at, reference_source, reference_edited, paid_at_edited, wallet_scope)
  values (_ref, _key, _subject, _eco, _name, _role::text,
          _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
          coalesce(_s.cash_in_fee_percent,0), _fee, _net,
          _m.id, _m.name, _m.method_type,
          jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                             'account_number', _m.account_number, 'notes', _m.notes),
          nullif(trim(_payer_reference),''), _ref_key, _num, _num_key, _num, _num_key,
          _dup, _prev,
          nullif(trim(_notes),''), _proof,
          'pending', case when _dup then _dupe_reason else null end,
          _fund, _admin, _admin_acct,
          _ocr_ref, _ocr_ref_key, _ocr_amount, _ocr_sender,
          _ocr_sender_key, _ocr_paid, _ocr,
          _paid, _src, _ref_edited, _paid_edited, _scope)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          case when _dup then 'Flagged duplicate cash in' else 'Requested cash in' end, _name,
          jsonb_build_object('reference', _ref, 'amount_php', _amount_php, 'credits', _credits,
                             'fee_percent', coalesce(_s.cash_in_fee_percent,0), 'fee_php', _fee,
                             'net_php', _net,
                             'method', _m.name, 'requester_id', _subject, 'status', _row.status,
                             'payer_reference', nullif(trim(_payer_reference),''),
                             'ocr_reference', _ocr_ref,
                             'reference_source', _src,
                             'reference_edited', _ref_edited,
                             'paid_at', _paid,
                             'paid_at_edited', _paid_edited,
                             'funding_source', _fund, 'funding_admin_id', _admin,
                             'wallet_scope', _scope,
                             'duplicate', _dup,
                             'has_proof', true));

  if _dup then
    perform public.record_cash_in_reference_conflict(_row.id);
  else
    perform public.link_cash_in_listener_event(_row.id);
    perform public.try_auto_approve_cash_in(_row.id);
  end if;

  select * into _row from public.cash_in_requests where id = _row.id;
  return _row;
end $function$;

revoke all on function public.request_cash_in(uuid, numeric, text, text, text, text, text, text, timestamptz, jsonb, text) from public, anon;
grant execute on function public.request_cash_in(uuid, numeric, text, text, text, text, text, text, timestamptz, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- settle_cash_in_approval: a Universe request always credits the global wallet
-- ---------------------------------------------------------------------------
create or replace function public.settle_cash_in_approval(
  _id uuid, _actor uuid, _actor_name text, _approval_method text,
  _reason text default null, _payment uuid default null, _note text default null)
returns public.cash_in_requests
language plpgsql security definer set search_path to 'public'
as $function$
declare _row public.cash_in_requests; _acct uuid; _ledger uuid; _tx text;
        _before numeric(14,2); _after numeric(14,2); _target text; _eco_name text; _role app_role;
        _eco uuid; _existing text; _recipient uuid; _acct_owner uuid; _operator uuid;
        _admin uuid; _admin_acct uuid; _admin_bal numeric(14,2); _fund_ledger uuid;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then raise exception 'Cash in request not found'; end if;
  if _row.status <> 'pending' then raise exception 'This request was already %', _row.status; end if;

  _recipient := _row.user_id;
  if _recipient is null then
    raise exception 'This request has no member attached, so credits cannot be released';
  end if;
  if not exists (select 1 from public.profiles where id = _recipient) then
    raise exception 'This member account no longer exists, so credits cannot be released';
  end if;
  if public.is_super_admin(_recipient) then
    raise exception 'The platform owner does not hold a member credit balance, so this request cannot be approved';
  end if;

  if _row.wallet_scope = 'universe' then
    -- ONE global Universe wallet — never the member's active shop or NG wallet.
    _eco := null;
    _acct := public.ensure_global_wallet(_recipient);
    perform 1 from public.credit_accounts where id = _acct for update;
  else
    select coalesce(_row.ecosystem_id, p.ecosystem_id,
                    (select ca.ecosystem_id from public.credit_accounts ca where ca.user_id = _recipient))
      into _eco from public.profiles p where p.id = _recipient;
    _acct := public.ensure_credit_account(_recipient, _eco);
  end if;
  if _acct is null then raise exception 'Could not open a credit balance for this member'; end if;

  select user_id, balance into _acct_owner, _before from public.credit_accounts where id = _acct;
  if _acct_owner is distinct from _recipient then
    raise exception 'Recipient mismatch: refusing to credit an account that is not the requesting member';
  end if;

  _tx := public.new_tx_id();

  if _row.funding_source = 'admin' then
    if _row.wallet_scope = 'universe' then
      raise exception 'A Universe wallet cash in cannot be funded by a shop admin';
    end if;
    if _row.funding_ledger_id is not null then raise exception 'This request was already approved'; end if;
    _admin := coalesce(_row.funding_admin_id, public.shop_funding_admin(_eco));
    if _admin is null then raise exception 'This shop has no active admin to fund this cash in'; end if;
    if _admin = _recipient then raise exception 'A shop admin cannot fund their own cash in'; end if;

    _admin_acct := coalesce(_row.funding_account_id, public.ensure_credit_account(_admin, _eco));
    if _admin_acct is null then raise exception 'The shop admin has no wallet in this shop'; end if;

    select balance into _admin_bal from public.credit_accounts where id = _admin_acct for update;
    if coalesce(_admin_bal,0) < _row.credits then
      raise exception 'Your shop admin no longer has enough credits to fund this cash in';
    end if;

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_admin_acct, _admin, _eco, 'debit', _row.credits, 0,
            'Cash in funded for ' || _row.requester_name || ' — ' || _row.reference,
            _row.reference, coalesce(_actor, _admin), _tx, 'admin_cash_in_funding')
    returning id into _fund_ledger;

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_acct, _recipient, _eco, 'credit', _row.credits, 0,
            case when _approval_method = 'automatic'
                 then 'Cash in auto-approved (shop admin) — ' || _row.reference
                 else 'Cash in approved (shop admin) — ' || _row.reference end,
            _row.reference, coalesce(_actor, _admin), _tx || '-R', 'admin_cash_in')
    returning id into _ledger;

    update public.cash_in_requests
       set status = 'approved', ledger_id = _ledger, funding_ledger_id = _fund_ledger,
           funding_admin_id = _admin, funding_account_id = _admin_acct,
           ecosystem_id = coalesce(ecosystem_id, _eco),
           reviewed_by = _actor, reviewer_name = coalesce(_actor_name, 'Automatic verification'),
           decision_reason = nullif(trim(_reason), ''), reviewed_at = now(),
           approval_method = _approval_method, verified_payment_id = _payment,
           auto_match_note = coalesce(_note, auto_match_note)
     where id = _id returning * into _row;

    return _row;
  end if;

  select tx_id into _existing from public.platform_credit_issuances
   where request_key = 'cash_in:' || _row.id::text;
  if _existing is not null then raise exception 'This request was already approved'; end if;

  if _actor is not null and _acct_owner = _actor then
    raise exception 'Refusing to credit the approving platform owner';
  end if;

  _operator := coalesce(_actor, (select ur.user_id from public.user_roles ur
                                  where ur.role = 'super_admin' limit 1));
  if _operator is null then
    raise exception 'No platform owner account exists to record this approval against';
  end if;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _recipient, _eco, 'credit', _row.credits, 0,
          case when _approval_method = 'automatic'
               then 'Cash in auto-approved — ' || _row.reference
               else 'Cash in approved — ' || _row.reference end,
          _row.reference, _operator, _tx, 'cash_in', _row.credits, 0, 0)
  returning id, balance_after into _ledger, _after;

  select p.full_name || ' — ' || p.email into _target from public.profiles p where p.id = _recipient;
  select name into _eco_name from public.ecosystems where id = _eco;
  select role into _role from public.user_roles where user_id = _recipient limit 1;

  insert into public.platform_credit_issuances (
    tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name,
    recipient_role, ecosystem_id, ecosystem_name, amount, balance_before, balance_after,
    reason, category, reference, ledger_id)
  values (_tx, 'cash_in:' || _row.id::text, _operator, coalesce(_actor_name, 'Automatic verification'),
          _recipient, coalesce(_target, _row.requester_name), _role, _eco, _eco_name,
          _row.credits, _before, _after,
          'Cash in payment verified — ' || _row.reference, 'cash_in', _row.reference, _ledger);

  update public.cash_in_requests
     set status = 'approved', ledger_id = _ledger, ecosystem_id = coalesce(ecosystem_id, _eco),
         reviewed_by = _actor, reviewer_name = coalesce(_actor_name, 'Automatic verification'),
         decision_reason = nullif(trim(_reason), ''), reviewed_at = now(),
         approval_method = _approval_method, verified_payment_id = _payment,
         auto_match_note = coalesce(_note, auto_match_note)
   where id = _id returning * into _row;

  return _row;
end $function$;