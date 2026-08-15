create or replace function public.settle_cash_in_approval(
  _id uuid, _actor uuid, _actor_name text, _approval_method text,
  _reason text default null, _payment uuid default null, _note text default null)
returns public.cash_in_requests
language plpgsql security definer set search_path = public as $$
declare _row public.cash_in_requests; _acct uuid; _ledger uuid; _tx text;
        _before numeric(14,2); _after numeric(14,2); _target text; _eco_name text; _role app_role;
        _eco uuid; _existing text; _recipient uuid; _acct_owner uuid; _operator uuid;
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

  select tx_id into _existing from public.platform_credit_issuances
   where request_key = 'cash_in:' || _row.id::text;
  if _existing is not null then raise exception 'This request was already approved'; end if;

  select coalesce(_row.ecosystem_id, p.ecosystem_id,
                  (select ca.ecosystem_id from public.credit_accounts ca where ca.user_id = _recipient))
    into _eco from public.profiles p where p.id = _recipient;

  _acct := public.ensure_credit_account(_recipient, _eco);
  if _acct is null then raise exception 'Could not open a credit balance for this member'; end if;

  select user_id, balance into _acct_owner, _before from public.credit_accounts where id = _acct;
  if _acct_owner is distinct from _recipient then
    raise exception 'Recipient mismatch: refusing to credit an account that is not the requesting member';
  end if;
  if _actor is not null and _acct_owner = _actor then
    raise exception 'Refusing to credit the approving platform owner';
  end if;

  -- Automatic approvals have no human actor; the issuance ledger still needs an
  -- accountable operator, so it is booked against the platform owner account.
  _operator := coalesce(_actor, (select ur.user_id from public.user_roles ur
                                  where ur.role = 'super_admin' limit 1));
  if _operator is null then
    raise exception 'No platform owner account exists to record this approval against';
  end if;

  _tx := public.new_tx_id();

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
end $$;
revoke all on function public.settle_cash_in_approval(uuid, uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_cash_in_approval(uuid, uuid, text, text, text, uuid, text) to service_role;