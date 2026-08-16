-- Stage 3b: settlement. Admin-funded cash in moves existing credits from the
-- shop admin's wallet to the requester. Platform-funded cash in keeps the
-- existing Super Admin issuance path exactly as it was.

create or replace function public.settle_cash_in_approval(_id uuid, _actor uuid, _actor_name text, _approval_method text, _reason text DEFAULT NULL::text, _payment uuid DEFAULT NULL::uuid, _note text DEFAULT NULL::text)
 RETURNS cash_in_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select coalesce(_row.ecosystem_id, p.ecosystem_id,
                  (select ca.ecosystem_id from public.credit_accounts ca where ca.user_id = _recipient))
    into _eco from public.profiles p where p.id = _recipient;

  _acct := public.ensure_credit_account(_recipient, _eco);
  if _acct is null then raise exception 'Could not open a credit balance for this member'; end if;

  select user_id, balance into _acct_owner, _before from public.credit_accounts where id = _acct;
  if _acct_owner is distinct from _recipient then
    raise exception 'Recipient mismatch: refusing to credit an account that is not the requesting member';
  end if;

  _tx := public.new_tx_id();

  -- ------------------------------------------------------------------
  -- Admin-funded: an internal 1:1 transfer. Nothing is minted.
  -- ------------------------------------------------------------------
  if _row.funding_source = 'admin' then
    if _row.funding_ledger_id is not null then raise exception 'This request was already approved'; end if;
    _admin := coalesce(_row.funding_admin_id, public.shop_funding_admin(_eco));
    if _admin is null then raise exception 'This shop has no active admin to fund this cash in'; end if;
    if _admin = _recipient then raise exception 'A shop admin cannot fund their own cash in'; end if;

    _admin_acct := coalesce(_row.funding_account_id, public.ensure_credit_account(_admin, _eco));
    if _admin_acct is null then raise exception 'The shop admin has no wallet in this shop'; end if;

    -- Lock the funding wallet and re-check spendable credits at settlement so
    -- two approvals can never consume the same credits.
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

  -- ------------------------------------------------------------------
  -- Platform (Super Admin GCash) funded: unchanged issuance path.
  -- ------------------------------------------------------------------
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

-- The shop admin confirms (or denies) a cash in paid into their own GCash.
-- Only their own wallet funds it, and only inside their own shop.
create or replace function public.review_admin_cash_in(_id uuid, _action text, _reason text DEFAULT NULL::text)
 RETURNS cash_in_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.cash_in_requests; _actor text; _admin uuid;
begin
  _admin := auth.uid();
  if _admin is null then raise exception 'Not signed in'; end if;
  if _action not in ('approve','reject') then raise exception 'Unknown action'; end if;

  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then raise exception 'Cash in request not found'; end if;
  if _row.funding_source <> 'admin' then
    raise exception 'This cash in is decided by the platform owner';
  end if;
  if not public.is_ecosystem_admin(_admin, _row.ecosystem_id) then
    raise exception 'Only this shop admin can decide this cash in';
  end if;
  if _row.status <> 'pending' then raise exception 'This request was already %', _row.status; end if;

  select full_name into _actor from public.profiles where id = _admin;

  if _action = 'reject' then
    -- The reservation disappears with the pending status; no credits move.
    update public.cash_in_requests
       set status = 'rejected', reviewed_by = _admin, reviewer_name = coalesce(_actor,'Shop admin'),
           decision_reason = nullif(trim(_reason),''), reviewed_at = now(),
           approval_method = 'manual', payer_reference_key = null
     where id = _id returning * into _row;
  else
    _row := public.settle_cash_in_approval(_id, _admin, coalesce(_actor,'Shop admin'),
                                           'manual', _reason, null, null);
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, _admin, coalesce(_actor,'Shop admin'),
          case _action when 'approve' then 'Approved cash in' else 'Rejected cash in' end,
          _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'amount_php', _row.amount_php,
                             'credits', _row.credits, 'status', _row.status,
                             'funding_source', 'admin',
                             'requester_id', _row.user_id, 'approval_method', 'manual',
                             'reason', nullif(trim(_reason),'')));
  return _row;
end $function$;

revoke all on function public.review_admin_cash_in(uuid, text, text) from public, anon;
grant execute on function public.review_admin_cash_in(uuid, text, text) to authenticated;

-- Shop admins can read the admin-funded cash in requests they must decide.
drop policy if exists "Shop admins read admin funded cash ins" on public.cash_in_requests;
create policy "Shop admins read admin funded cash ins"
  on public.cash_in_requests for select to authenticated
  using (funding_source = 'admin' and public.is_ecosystem_admin(auth.uid(), ecosystem_id));