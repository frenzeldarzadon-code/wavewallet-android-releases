ALTER TABLE public.credit_lots ALTER COLUMN ecosystem_id DROP NOT NULL;
ALTER TABLE public.credit_lot_consumptions ALTER COLUMN ecosystem_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.review_cash_in(_id uuid, _action text, _reason text DEFAULT NULL::text)
 RETURNS cash_in_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.cash_in_requests; _actor text; _acct uuid; _ledger uuid; _tx text;
        _before numeric(14,2); _after numeric(14,2); _target text; _eco_name text; _role app_role;
        _eco uuid; _existing text;
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
    if not exists (select 1 from public.profiles where id = _row.user_id) then
      raise exception 'This member account no longer exists, so credits cannot be released';
    end if;

    -- guard against a duplicate release for the same request
    select tx_id into _existing from public.platform_credit_issuances
     where request_key = 'cash_in:' || _row.id::text;
    if _existing is not null then
      raise exception 'This request was already approved';
    end if;

    -- resolve the member's real shop: request snapshot, then profile, then existing credit balance
    select coalesce(_row.ecosystem_id, p.ecosystem_id,
                    (select ca.ecosystem_id from public.credit_accounts ca where ca.user_id = _row.user_id))
      into _eco
      from public.profiles p where p.id = _row.user_id;

    _acct := public.ensure_credit_account(_row.user_id, _eco);
    if _acct is null then
      raise exception 'Could not open a credit balance for this member';
    end if;
    select balance into _before from public.credit_accounts where id = _acct;
    _tx := public.new_tx_id();

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind,
                                      base_amount, commission_percent, commission_amount)
    values (_acct, _row.user_id, _eco, 'credit', _row.credits, 0,
            'Cash in approved — ' || _row.reference, _row.reference, auth.uid(), _tx,
            'cash_in', _row.credits, 0, 0)
    returning id, balance_after into _ledger, _after;

    select p.full_name || ' — ' || p.email into _target from public.profiles p where p.id = _row.user_id;
    select name into _eco_name from public.ecosystems where id = _eco;
    select role into _role from public.user_roles where user_id = _row.user_id limit 1;

    insert into public.platform_credit_issuances (
      tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name,
      recipient_role, ecosystem_id, ecosystem_name, amount, balance_before, balance_after,
      reason, category, reference, ledger_id)
    values (_tx, 'cash_in:' || _row.id::text, auth.uid(), coalesce(_actor,'Super Admin'),
            _row.user_id, coalesce(_target, _row.requester_name), _role, _eco, _eco_name,
            _row.credits, _before, _after,
            'Cash in payment verified — ' || _row.reference, 'cash_in', _row.reference, _ledger);

    update public.cash_in_requests
       set status = 'approved', ledger_id = _ledger, ecosystem_id = coalesce(ecosystem_id, _eco),
           reviewed_by = auth.uid(),
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