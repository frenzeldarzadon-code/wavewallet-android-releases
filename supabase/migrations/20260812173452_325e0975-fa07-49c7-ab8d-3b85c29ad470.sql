create or replace function public.reverse_credit_transfer(
  _tx_id text, _amount numeric, _reason text, _note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _sent public.credit_ledger; _recv public.credit_ledger;
  _base text := regexp_replace(coalesce(_tx_id,''), '-R$', '');
  _avail numeric(14,2); _bal numeric(14,2); _ref text;
  _done numeric(14,2); _left numeric(14,2);
  _sacct uuid; _racct uuid; _debit uuid; _credit uuid;
  _kind text; _actor text; _target text; _rid uuid;
begin
  perform public.require_operational();
  if coalesce(trim(_reason), '') = '' then raise exception 'A dispute reason is required'; end if;

  select * into _sent from public.credit_ledger where tx_id = _base and direction = 'debit' limit 1;
  -- Locking the recipient's original credit row serialises concurrent reversals
  -- of the same transfer, so the cumulative total below can be trusted.
  select * into _recv from public.credit_ledger where tx_id = _base || '-R' and direction = 'credit' limit 1
    for update;
  if _sent.id is null or _recv.id is null then
    raise exception 'Credit transfer not found';
  end if;
  if _sent.sale_id is not null or _recv.sale_id is not null then
    raise exception 'This transaction belongs to a voucher sale — use the sale refund workflow instead';
  end if;
  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _recv.ecosystem_id)) then
    raise exception 'Not authorized to manage this shop';
  end if;

  select coalesce(sum(reversed_amount), 0) into _done
    from public.credit_transfer_reversals where original_tx_id = _base;
  if _done >= _sent.amount then
    raise exception 'This transfer has already been fully reversed';
  end if;

  select balance into _bal from public.credit_accounts where user_id = _recv.user_id;
  select coalesce(remaining, 0) into _avail from public.credit_lots where ledger_id = _recv.id for update;
  _avail := least(coalesce(_avail, 0), coalesce(_bal, 0));
  _left := least(_sent.amount - _done, _avail);
  if _left <= 0 then
    raise exception 'Cannot reverse automatically because some credits have already been spent or transferred.';
  end if;

  if _amount is null then _amount := _left; end if;
  _amount := round(_amount, 2);
  if _amount <= 0 then raise exception 'Enter a positive amount'; end if;
  if _amount > _sent.amount - _done then
    raise exception 'Reversal cannot exceed the original transfer';
  end if;
  if _amount > _avail then
    raise exception 'Cannot reverse automatically because some credits have already been spent or transferred.';
  end if;
  _kind := case when _done + _amount >= _sent.amount then 'full' else 'partial' end;

  select id into _racct from public.credit_accounts where user_id = _recv.user_id;
  select id into _sacct from public.credit_accounts where user_id = _sent.user_id;
  if _racct is null or _sacct is null then raise exception 'Wallet not found'; end if;

  _ref := public.new_tx_id();

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind, reverses_ledger_id,
                                    base_amount, commission_percent, commission_amount)
  values (_racct, _recv.user_id, _recv.ecosystem_id, 'debit', _amount, 0,
          'Credit transfer reversed — ' || trim(_reason), _ref, auth.uid(), _ref,
          'transfer_reversal', _recv.id, _amount, 0, 0)
  returning id into _debit;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind, reverses_ledger_id,
                                    base_amount, commission_percent, commission_amount)
  values (_sacct, _sent.user_id, _sent.ecosystem_id, 'credit', _amount, 0,
          'Credit transfer reversal returned — ' || trim(_reason), _ref, auth.uid(), _ref || '-R',
          'transfer_reversal', _sent.id, _amount, 0, 0)
  returning id into _credit;

  select full_name into _actor from public.profiles where id = auth.uid();
  select full_name || ' → ' into _target from public.profiles where id = _sent.user_id;
  select coalesce(_target,'') || full_name into _target from public.profiles where id = _recv.user_id;

  insert into public.credit_transfer_reversals (
    ecosystem_id, original_tx_id, original_sender_ledger_id, original_recipient_ledger_id,
    sender_id, recipient_id, original_amount, reversed_amount, kind, reason, note,
    actor_id, actor_name, reversal_tx_id, reversal_debit_ledger_id, reversal_credit_ledger_id)
  values (_recv.ecosystem_id, _base, _sent.id, _recv.id, _sent.user_id, _recv.user_id,
          _sent.amount, _amount, _kind, trim(_reason), nullif(trim(_note), ''),
          auth.uid(), coalesce(_actor, 'Admin'), _ref, _debit, _credit)
  returning id into _rid;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_recv.ecosystem_id, auth.uid(), coalesce(_actor, 'Admin'),
          case when _kind = 'full' then 'Reversed credit transfer' else 'Partially reversed credit transfer' end,
          coalesce(_target, ''),
          jsonb_build_object('original_tx_id', _base, 'reversal_tx_id', _ref,
                             'original_amount', _sent.amount, 'reversed_amount', _amount,
                             'total_reversed', _done + _amount,
                             'kind', _kind, 'reason', trim(_reason), 'note', nullif(trim(_note), ''),
                             'sender_id', _sent.user_id, 'recipient_id', _recv.user_id));

  return jsonb_build_object('id', _rid, 'reversal_tx_id', _ref, 'kind', _kind, 'amount', _amount,
                            'total_reversed', _done + _amount, 'original_amount', _sent.amount);
end; $function$;

grant execute on function public.reverse_credit_transfer(text, numeric, text, text) to authenticated;