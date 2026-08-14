CREATE OR REPLACE FUNCTION public.request_cash_in(_method_id uuid, _amount_php numeric, _payer_reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _request_key text DEFAULT NULL::text)
 RETURNS cash_in_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if public.is_super_admin(_subject) then
    raise exception 'The platform owner does not hold a member credit balance and cannot cash in';
  end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.review_cash_in(_id uuid, _action text, _reason text DEFAULT NULL::text)
 RETURNS cash_in_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _row public.cash_in_requests; _actor text; _acct uuid; _ledger uuid; _tx text;
        _before numeric(14,2); _after numeric(14,2); _target text; _eco_name text; _role app_role;
        _eco uuid; _existing text; _recipient uuid; _acct_owner uuid;
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
    -- the recipient is ALWAYS the member who submitted the request, never the approver
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

    -- guard against a duplicate release for the same request
    select tx_id into _existing from public.platform_credit_issuances
     where request_key = 'cash_in:' || _row.id::text;
    if _existing is not null then
      raise exception 'This request was already approved';
    end if;

    -- resolve the MEMBER'S shop: request snapshot, then their profile, then their credit balance
    select coalesce(_row.ecosystem_id, p.ecosystem_id,
                    (select ca.ecosystem_id from public.credit_accounts ca where ca.user_id = _recipient))
      into _eco
      from public.profiles p where p.id = _recipient;

    _acct := public.ensure_credit_account(_recipient, _eco);
    if _acct is null then
      raise exception 'Could not open a credit balance for this member';
    end if;

    -- hard assertion: the balance we are about to credit belongs to the requesting member
    select user_id, balance into _acct_owner, _before from public.credit_accounts where id = _acct;
    if _acct_owner is distinct from _recipient then
      raise exception 'Recipient mismatch: refusing to credit an account that is not the requesting member';
    end if;
    if _acct_owner = auth.uid() then
      raise exception 'Refusing to credit the approving platform owner';
    end if;

    _tx := public.new_tx_id();

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind,
                                      base_amount, commission_percent, commission_amount)
    values (_acct, _recipient, _eco, 'credit', _row.credits, 0,
            'Cash in approved — ' || _row.reference, _row.reference, auth.uid(), _tx,
            'cash_in', _row.credits, 0, 0)
    returning id, balance_after into _ledger, _after;

    select p.full_name || ' — ' || p.email into _target from public.profiles p where p.id = _recipient;
    select name into _eco_name from public.ecosystems where id = _eco;
    select role into _role from public.user_roles where user_id = _recipient limit 1;

    insert into public.platform_credit_issuances (
      tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name,
      recipient_role, ecosystem_id, ecosystem_name, amount, balance_before, balance_after,
      reason, category, reference, ledger_id)
    values (_tx, 'cash_in:' || _row.id::text, auth.uid(), coalesce(_actor,'Super Admin'),
            _recipient, coalesce(_target, _row.requester_name), _role, _eco, _eco_name,
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