
create or replace function public.ensure_credit_account(_user_id uuid, _ecosystem_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare _acct uuid; _eco uuid;
begin
  select id into _acct from public.credit_accounts where user_id = _user_id for update;
  if _acct is not null then return _acct; end if;

  select coalesce(_ecosystem_id, p.ecosystem_id) into _eco
    from public.profiles p where p.id = _user_id;
  if _eco is null then
    raise exception 'This member is not attached to a shop yet, so credits cannot be added';
  end if;

  insert into public.credit_accounts (user_id, ecosystem_id, balance)
  values (_user_id, _eco, 0)
  on conflict (user_id) do nothing;

  select id into _acct from public.credit_accounts where user_id = _user_id for update;
  return _acct;
end $$;

revoke all on function public.ensure_credit_account(uuid, uuid) from public;

create or replace function public.review_cash_in(_id uuid, _action text, _reason text default null)
returns cash_in_requests
language plpgsql
security definer
set search_path = public
as $function$
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
    _acct := public.ensure_credit_account(_row.user_id, _row.ecosystem_id);
    select balance into _before from public.credit_accounts where id = _acct;
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
end $function$;

create or replace function public.superadmin_issue_credits(_user_id uuid, _amount numeric, _reason text, _category text default null, _reference text default null, _request_key text default null)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  _eco uuid; _eco_name text; _acct uuid; _tx text; _key text;
  _actor text; _target text; _role app_role;
  _before numeric(14,2); _after numeric(14,2); _ledger uuid; _existing text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can issue credits';
  end if;
  if _amount is null or _amount <= 0 then
    raise exception 'Enter how many credits to issue';
  end if;
  if _amount <> trunc(_amount) then
    raise exception 'Credits must be a whole number';
  end if;
  if _amount > 10000000 then
    raise exception 'A single issuance is limited to 10,000,000 credits';
  end if;
  if coalesce(trim(_reason),'') = '' then
    raise exception 'A reason is required';
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);

  select tx_id into _existing from public.platform_credit_issuances where request_key = _key;
  if _existing is not null then
    return _existing;
  end if;

  select p.ecosystem_id, p.full_name || ' — ' || p.email
    into _eco, _target
    from public.profiles p where p.id = _user_id;
  if _target is null then raise exception 'Member not found'; end if;

  select name into _eco_name from public.ecosystems where id = _eco;
  select role into _role from public.user_roles
   where user_id = _user_id and (ecosystem_id is not distinct from _eco or ecosystem_id is null)
   limit 1;

  _acct := public.ensure_credit_account(_user_id, _eco);
  select balance into _before from public.credit_accounts where id = _acct;

  _tx := public.new_tx_id();

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, 'credit', _amount, 0, trim(_reason),
          nullif(trim(_reference),''), auth.uid(), _tx, 'superadmin_credit_issuance',
          _amount, 0, 0)
  returning id, balance_after into _ledger, _after;

  select full_name into _actor from public.profiles where id = auth.uid();

  insert into public.platform_credit_issuances (
    tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name,
    recipient_role, ecosystem_id, ecosystem_name, amount, balance_before, balance_after,
    reason, category, reference, ledger_id)
  values (_tx, _key, auth.uid(), coalesce(_actor,'Super Admin'), _user_id, _target,
          _role, _eco, _eco_name, _amount, _before, _after,
          trim(_reason), nullif(trim(_category),''), nullif(trim(_reference),''), _ledger);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Super Admin'),
          'Issued platform credits', _target,
          jsonb_build_object('amount', _amount, 'reason', trim(_reason),
                             'category', nullif(trim(_category),''), 'reference', nullif(trim(_reference),''),
                             'balance_before', _before, 'balance_after', _after,
                             'entry_kind', 'superadmin_credit_issuance', 'tx_id', _tx));
  return _tx;
end; $function$;
