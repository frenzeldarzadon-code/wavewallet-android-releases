-- Stage 1: Cash Out must always act on the requester's wallet for the shop the
-- request belongs to. Previously the wallet was looked up by user_id alone,
-- which is wrong for members who belong to more than one shop.

alter table public.withdrawal_requests
  add column if not exists account_id uuid references public.credit_accounts(id);

-- Backfill: purely a pointer to the wallet that matches the request's shop.
-- No balance, amount or ledger row is touched.
update public.withdrawal_requests w
   set account_id = ca.id
  from public.credit_accounts ca
 where w.account_id is null
   and ca.user_id = w.user_id
   and ca.ecosystem_id is not distinct from w.ecosystem_id;

create or replace function public.request_withdrawal(_credits numeric, _payment_mode text, _account_name text DEFAULT NULL::text, _account_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _request_key text DEFAULT NULL::text)
 RETURNS withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- The wallet is always the one for the shop the member is acting in.
  _acct := public.ensure_credit_account(_subject, _eco);
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
    payment_mode, account_name, account_number, notes, reserve_ledger_id, account_id)
  values (_ref, _key, _subject, _eco, _name, _role::text, _credits,
          _s.credits_per_unit, _s.php_per_unit, _gross, _s.fee_percent, _fee, _net,
          _payment_mode, nullif(trim(_account_name),''), nullif(trim(_account_number),''),
          nullif(trim(_notes),''), _ledger, _acct)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          'Requested cash out', _name,
          jsonb_build_object('reference', _ref, 'credits', _credits, 'gross_php', _gross,
                             'fee_percent', _s.fee_percent, 'fee_php', _fee, 'net_php', _net,
                             'payment_mode', _payment_mode, 'requester_id', _subject, 'status', 'pending'));
  return _row;
end $function$;

create or replace function public.cancel_withdrawal(_id uuid)
 RETURNS withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.withdrawal_requests; _subject uuid; _acct uuid; _ledger uuid;
begin
  _subject := public.effective_uid();
  select * into _row from public.withdrawal_requests where id = _id for update;
  if _row.id is null then raise exception 'Withdrawal request not found'; end if;
  if _row.user_id <> _subject then raise exception 'You can only cancel your own request'; end if;
  if _row.status <> 'pending' then raise exception 'Only a pending request can be cancelled'; end if;

  _acct := coalesce(_row.account_id, public.ensure_credit_account(_row.user_id, _row.ecosystem_id));
  perform 1 from public.credit_accounts where id = _acct for update;

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
end $function$;

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