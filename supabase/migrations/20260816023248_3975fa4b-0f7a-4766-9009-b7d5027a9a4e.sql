-- Stage 2: two distinct Cash Out paths.
--   admin      : internal 1:1 transfer requester -> shop admin, no fee, credits stay in the shop.
--   superadmin : existing external path, configurable fee, credits leave circulation.

alter table public.withdrawal_requests
  add column if not exists cashout_path text not null default 'superadmin',
  add column if not exists admin_id uuid references public.profiles(id),
  add column if not exists settlement_ledger_id uuid references public.credit_ledger(id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'withdrawal_requests_cashout_path_check') then
    alter table public.withdrawal_requests
      add constraint withdrawal_requests_cashout_path_check
      check (cashout_path in ('admin','superadmin'));
  end if;
end $$;

create index if not exists withdrawal_requests_path_eco_idx
  on public.withdrawal_requests (ecosystem_id, cashout_path, status);

-- Shop admins may read the admin-path cash outs they must settle.
drop policy if exists "Shop admins read admin cash outs" on public.withdrawal_requests;
create policy "Shop admins read admin cash outs"
  on public.withdrawal_requests for select to authenticated
  using (cashout_path = 'admin' and public.is_ecosystem_admin(auth.uid(), ecosystem_id));

drop function if exists public.request_withdrawal(numeric, text, text, text, text, text);

create or replace function public.request_withdrawal(_credits numeric, _payment_mode text, _account_name text DEFAULT NULL::text, _account_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _request_key text DEFAULT NULL::text, _cashout_path text DEFAULT 'superadmin'::text)
 RETURNS withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _acct uuid; _s record; _gross numeric(14,2); _fee numeric(14,2); _net numeric(14,2);
        _row public.withdrawal_requests; _key text; _ledger uuid; _ref text;
        _path text; _fee_pct numeric(6,3); _admin uuid; _admins int;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  _path := lower(coalesce(nullif(trim(_cashout_path),''), 'superadmin'));
  if _path not in ('admin','superadmin') then raise exception 'Choose a valid cash out destination'; end if;

  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  _role := coalesce(public.top_role(_subject), 'customer');
  if _role = 'super_admin' then raise exception 'The platform owner does not withdraw from a member wallet'; end if;
  if _eco is not null and (select coalesce(operations_frozen,false) from public.ecosystems where id = _eco) then
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

  _acct := public.ensure_credit_account(_subject, _eco);
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
    cashout_path, admin_id)
  values (_ref, _key, _subject, _eco, _name, _role::text, _credits,
          _s.credits_per_unit, _s.php_per_unit, _gross, _fee_pct, _fee, _net,
          _payment_mode, nullif(trim(_account_name),''), nullif(trim(_account_number),''),
          nullif(trim(_notes),''), _ledger, _acct, _path, _admin)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          'Requested cash out', _name,
          jsonb_build_object('reference', _ref, 'credits', _credits, 'gross_php', _gross,
                             'fee_percent', _fee_pct, 'fee_php', _fee, 'net_php', _net,
                             'payment_mode', _payment_mode, 'requester_id', _subject,
                             'cashout_path', _path, 'status', 'pending'));
  return _row;
end $function$;

-- The platform owner never decides a shop-admin cash out.
create or replace function public.review_withdrawal(_id uuid, _action text, _reason text DEFAULT NULL::text)
 RETURNS withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.withdrawal_requests; _actor text; _acct uuid; _ledger uuid;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can decide withdrawals';
  end if;
  if _action not in ('approve','reject','release') then raise exception 'Unknown action'; end if;

  select * into _row from public.withdrawal_requests where id = _id for update;
  if _row.id is null then raise exception 'Withdrawal request not found'; end if;
  if _row.cashout_path = 'admin' then
    raise exception 'This cash out is settled by the shop admin, not the platform owner';
  end if;
  if _row.status in ('released','rejected','cancelled') then
    raise exception 'This withdrawal was already %', _row.status;
  end if;
  if _action = 'approve' and _row.status <> 'pending' then
    raise exception 'Only a pending withdrawal can be approved';
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();

  if _action = 'reject' then
    _acct := coalesce(_row.account_id, public.ensure_credit_account(_row.user_id, _row.ecosystem_id));
    perform 1 from public.credit_accounts where id = _acct for update;
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
end $function$;

-- Shop admin settles (or denies) an admin-path cash out. Strictly 1:1, no fee.
create or replace function public.review_admin_cashout(_id uuid, _action text, _reason text DEFAULT NULL::text)
 RETURNS withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.withdrawal_requests; _actor text; _admin uuid; _acct uuid; _ledger uuid;
begin
  _admin := auth.uid();
  if _admin is null then raise exception 'Not signed in'; end if;
  if _action not in ('approve','reject') then raise exception 'Unknown action'; end if;

  select * into _row from public.withdrawal_requests where id = _id for update;
  if _row.id is null then raise exception 'Cash out request not found'; end if;
  if _row.cashout_path <> 'admin' then
    raise exception 'This cash out is settled by the platform owner';
  end if;
  if not public.is_ecosystem_admin(_admin, _row.ecosystem_id) then
    raise exception 'Only this shop admin can settle this cash out';
  end if;
  if _row.status <> 'pending' then raise exception 'This cash out was already %', _row.status; end if;
  if _row.user_id = _admin then raise exception 'You cannot settle your own cash out'; end if;
  if _row.settlement_ledger_id is not null then raise exception 'This cash out was already settled'; end if;

  select full_name into _actor from public.profiles where id = _admin;

  if _action = 'reject' then
    _acct := coalesce(_row.account_id, public.ensure_credit_account(_row.user_id, _row.ecosystem_id));
    perform 1 from public.credit_accounts where id = _acct for update;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_acct, _row.user_id, _row.ecosystem_id, 'credit', _row.credits, 0,
            'Cash out returned — ' || _row.reference, _row.reference, _admin,
            _row.reference || '-R', 'withdrawal_return')
    returning id into _ledger;

    update public.withdrawal_requests
       set status = 'rejected', refund_ledger_id = _ledger, reviewed_by = _admin,
           reviewer_name = coalesce(_actor,'Shop admin'), decision_reason = nullif(trim(_reason),''),
           reviewed_at = now(), admin_id = _admin
     where id = _id returning * into _row;
  else
    -- The requester's credits are already held; hand exactly the same amount
    -- to the settling admin. Credits never leave the shop.
    _acct := public.ensure_credit_account(_admin, _row.ecosystem_id);
    if _acct is null then raise exception 'Could not open a wallet for this shop admin'; end if;
    perform 1 from public.credit_accounts where id = _acct for update;

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_acct, _admin, _row.ecosystem_id, 'credit', _row.credits, 0,
            'Cash out settled for ' || _row.requester_name || ' — ' || _row.reference,
            _row.reference, _admin, _row.reference || '-S', 'admin_cashout_settlement')
    returning id into _ledger;

    update public.withdrawal_requests
       set status = 'released', settlement_ledger_id = _ledger, reviewed_by = _admin,
           reviewer_name = coalesce(_actor,'Shop admin'),
           decision_reason = nullif(trim(_reason),''),
           reviewed_at = now(), released_at = now(), admin_id = _admin
     where id = _id returning * into _row;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, _admin, coalesce(_actor,'Shop admin'),
          case when _action = 'approve' then 'Settled shop cash out' else 'Denied shop cash out' end,
          _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'credits', _row.credits,
                             'cashout_path', 'admin', 'status', _row.status,
                             'requester_id', _row.user_id, 'reason', nullif(trim(_reason),'')));
  return _row;
end $function$;

revoke all on function public.review_admin_cashout(uuid, text, text) from public, anon;
grant execute on function public.review_admin_cashout(uuid, text, text) to authenticated;
revoke all on function public.request_withdrawal(numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.request_withdrawal(numeric, text, text, text, text, text, text) to authenticated;