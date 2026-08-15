CREATE OR REPLACE FUNCTION public.transfer_credits_in_shop(_ecosystem_id uuid, _recipient_id uuid, _amount numeric, _note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _op uuid; _subject uuid; _tx text;
  _frozen boolean; _reason text; _eco_name text;
  _my_role public.app_role; _their_role public.app_role;
  _from uuid; _to uuid; _bal numeric(14,2);
  _target text; _actor_name text; _allowed boolean := false;
  _r_status public.account_status; _r_parent uuid; _r_deleted timestamptz;
  _my_parent uuid; _their_admin boolean;
  _lineage_reset boolean := false;
  _kind text; _sent_reason text; _recv_reason text;
begin
  _op := auth.uid();
  _subject := public.effective_uid();
  if _subject is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();

  if _ecosystem_id is null or _recipient_id is null then
    raise exception 'Choose a shop and a recipient';
  end if;
  if _recipient_id = _subject then raise exception 'You cannot send credits to yourself'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select e.name, coalesce(e.operations_frozen,false), e.frozen_reason
    into _eco_name, _frozen, _reason
    from public.ecosystems e
   where e.id = _ecosystem_id and e.archived_at is null;
  if _eco_name is null then raise exception 'That shop is not available right now'; end if;
  if _frozen then
    raise exception 'This shop is temporarily frozen by the platform owner%',
      coalesce(' — ' || nullif(trim(_reason), ''), '');
  end if;
  if not public.subscription_ok(_ecosystem_id) then
    raise exception 'This shop is not active — the operator must renew the subscription before making changes';
  end if;

  _my_role := public.membership_role(_subject, _ecosystem_id);
  _their_role := public.membership_role(_recipient_id, _ecosystem_id);
  if not exists (select 1 from public.ecosystem_memberships m
                  where m.user_id = _subject and m.ecosystem_id = _ecosystem_id
                    and m.membership_state = 'active' and m.status = 'active') then
    raise exception 'You are not an approved member of that shop';
  end if;
  if not exists (select 1 from public.ecosystem_memberships m
                  where m.user_id = _recipient_id and m.ecosystem_id = _ecosystem_id
                    and m.membership_state = 'active' and m.status = 'active') then
    raise exception 'That member does not belong to this shop';
  end if;

  select p.status, p.reseller_id, p.deleted_at, p.full_name || ' — ' || p.email
    into _r_status, _r_parent, _r_deleted, _target
    from public.profiles p where p.id = _recipient_id;
  if _r_status is null or _r_deleted is not null then raise exception 'Recipient not found'; end if;
  if _r_status <> 'active' then raise exception 'That account is suspended'; end if;
  if public.is_super_admin(_recipient_id) then
    raise exception 'The platform owner does not hold a shop wallet';
  end if;

  select p.reseller_id into _my_parent from public.profiles p where p.id = _subject;
  _their_admin := public.is_ecosystem_admin(_recipient_id, _ecosystem_id);

  if public.is_super_admin(_subject) or public.is_ecosystem_admin(_subject, _ecosystem_id) then
    _allowed := true;
  elsif _my_role = 'reseller' then
    _allowed := (_their_role = 'customer')
             or (_their_role = 'subreseller' and _r_parent = _subject);
  elsif _my_role = 'subreseller' then
    _allowed := (_their_role = 'customer')
             or (_their_role = 'reseller' and _my_parent = _recipient_id)
             or _their_admin;
  else
    -- Customer: peer customers of this shop, plus any active upline of this shop.
    _allowed := (_their_role in ('customer','subreseller','reseller')) or _their_admin;
    -- Customer -> upline breaks the cashback lineage of the moved credits.
    _lineage_reset := _their_admin or (_their_role in ('subreseller','reseller'));
  end if;

  if not _allowed then
    raise exception 'You are not allowed to send credits to that member';
  end if;

  perform public.ensure_membership_wallets(_subject, _ecosystem_id);
  perform public.ensure_membership_wallets(_recipient_id, _ecosystem_id);

  select ca.id, ca.balance into _from, _bal from public.credit_accounts ca
   where ca.user_id = _subject and ca.ecosystem_id = _ecosystem_id for update;
  select ca.id into _to from public.credit_accounts ca
   where ca.user_id = _recipient_id and ca.ecosystem_id = _ecosystem_id for update;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;
  if coalesce(_bal, 0) < _amount then
    raise exception 'Not enough credits in %', _eco_name;
  end if;

  _tx := public.new_tx_id();
  -- entry_kind is NOT NULL. Ordinary member-to-member transfers use the
  -- ledger's established 'general' kind; customer -> upline transfers stay
  -- tagged so track_credit_lots resets the cashback lineage.
  _kind := case when _lineage_reset then 'customer_upline_transfer' else 'general' end;
  _sent_reason := case when _lineage_reset
                       then 'Customer → upline transfer (cashback lineage reset)'
                       else 'Credit transfer sent' end;
  _recv_reason := case when _lineage_reset
                       then 'Customer → upline transfer (cashback lineage reset)'
                       else 'Credit transfer received' end;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_from, _subject, _ecosystem_id, 'debit', _amount, 0, _sent_reason,
          nullif(trim(_note),''), _op, _tx, _kind, _amount, 0, 0);

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_to, _recipient_id, _ecosystem_id, 'credit', _amount, 0, _recv_reason,
          nullif(trim(_note),''), _op, _tx || '-R', _kind, _amount, 0, 0);

  select full_name into _actor_name from public.profiles where id = _op;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, _op, coalesce(_actor_name,'Member'), 'Transferred credits', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'commission_percent', 0,
                             'commission_amount', 0, 'total_received', _amount,
                             'tx_id', _tx, 'shop_scoped', true,
                             'cashback_lineage_reset', _lineage_reset));
  perform public.log_operator_action(_subject, _ecosystem_id, 'Credit transfer', 'credit_transfer',
          _recipient_id, jsonb_build_object('amount', _amount, 'recipient', coalesce(_target,''),
                                            'tx_id', _tx, 'cashback_lineage_reset', _lineage_reset));
  return _tx;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_credit_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _bal numeric(14,2);
begin
  -- entry_kind is NOT NULL: an explicit NULL from a caller must never break a
  -- financial write. Fall back to the ledger's default kind instead.
  if new.entry_kind is null then new.entry_kind := 'general'; end if;
  select balance into _bal from public.credit_accounts where id = new.account_id for update;
  if _bal is null then raise exception 'Credit account not found'; end if;
  _bal := _bal + case when new.direction = 'credit' then new.amount else -new.amount end;
  if _bal < 0 then raise exception 'Insufficient credits'; end if;
  update public.credit_accounts set balance = _bal, updated_at = now() where id = new.account_id;
  new.balance_after := _bal;
  return new;
end; $function$;