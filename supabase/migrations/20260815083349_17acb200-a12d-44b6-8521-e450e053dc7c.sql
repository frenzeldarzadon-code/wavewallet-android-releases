-- 1. Credit lot provenance: classify by shop membership, not only user_roles.
create or replace function public.track_credit_lots()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _kind text; _src uuid; _left numeric(14,2); _take numeric(14,2); _lot record;
  _srole public.app_role;
  _nil uuid := '00000000-0000-0000-0000-000000000000';
begin
  if new.direction = 'credit' then
    _src := new.actor_id;
    if new.entry_kind = 'customer_upline_transfer' then
      _kind := 'system'; _src := null;
    elsif new.entry_kind = 'shop_transfer_in' then
      _kind := 'transfer'; _src := null;
    elsif new.entry_kind = 'transfer_reversal' then
      _kind := 'system'; _src := null;
    elsif new.entry_kind = 'sale_commission' or new.entry_kind = 'upline_commission' or _src is null then
      _kind := 'system'; _src := null;
    elsif _src = new.user_id then
      _kind := 'self';
    elsif public.is_super_admin(_src) or public.is_ecosystem_admin(_src, new.ecosystem_id) then
      _kind := 'admin';
    else
      _srole := public.membership_role(_src, new.ecosystem_id);
      if _srole is null then
        select ur.role into _srole from public.user_roles ur
         where ur.user_id = _src and ur.ecosystem_id = new.ecosystem_id
         order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end
         limit 1;
      end if;
      if _srole = 'reseller' then _kind := 'reseller';
      elsif _srole = 'subreseller' then _kind := 'subreseller';
      else _kind := 'system'; _src := null;
      end if;
    end if;

    insert into public.credit_lots (ecosystem_id, user_id, ledger_id, source_user_id, source_kind, amount, remaining)
    values (new.ecosystem_id, new.user_id, new.id, _src, _kind, new.amount, new.amount)
    on conflict (ledger_id) do nothing;
    return null;
  end if;

  if new.entry_kind = 'transfer_reversal' and new.reverses_ledger_id is not null then
    select id, remaining into _lot from public.credit_lots
     where ledger_id = new.reverses_ledger_id for update;
    if _lot.id is null then
      raise exception 'Original transfer credits can no longer be traced';
    end if;
    if _lot.remaining < new.amount then
      raise exception 'Cannot reverse automatically because some credits have already been spent or transferred.';
    end if;
    update public.credit_lots set remaining = remaining - new.amount where id = _lot.id;
    insert into public.credit_lot_consumptions (ecosystem_id, ledger_id, lot_id, user_id, amount)
    values (new.ecosystem_id, new.id, _lot.id, new.user_id, new.amount)
    on conflict (ledger_id, lot_id) do nothing;
    return null;
  end if;

  _left := new.amount;
  for _lot in
    select id, remaining from public.credit_lots
     where user_id = new.user_id
       and coalesce(ecosystem_id, _nil) = coalesce(new.ecosystem_id, _nil)
       and remaining > 0
     order by seq
     for update
  loop
    exit when _left <= 0;
    _take := least(_left, _lot.remaining);
    update public.credit_lots set remaining = remaining - _take where id = _lot.id;
    insert into public.credit_lot_consumptions (ecosystem_id, ledger_id, lot_id, user_id, amount)
    values (new.ecosystem_id, new.id, _lot.id, new.user_id, _take)
    on conflict (ledger_id, lot_id) do nothing;
    _left := _left - _take;
  end loop;
  return null;
end; $function$;

-- 2. Transfers: the ledger's actor is the member whose wallet moved the credits,
--    so provenance survives operator "act as" sessions. Operator identity stays
--    in audit_logs / operator log.
create or replace function public.transfer_credits_in_shop(_ecosystem_id uuid, _recipient_id uuid, _amount numeric, _note text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    _allowed := (_their_role in ('customer','subreseller','reseller')) or _their_admin;
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
          nullif(trim(_note),''), _subject, _tx, _kind, _amount, 0, 0);

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_to, _recipient_id, _ecosystem_id, 'credit', _amount, 0, _recv_reason,
          nullif(trim(_note),''), _subject, _tx || '-R', _kind, _amount, 0, 0);

  select full_name into _actor_name from public.profiles where id = _op;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, _op, coalesce(_actor_name,'Member'), 'Transferred credits', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'commission_percent', 0,
                             'commission_amount', 0, 'total_received', _amount,
                             'tx_id', _tx, 'shop_scoped', true,
                             'sender_id', _subject,
                             'cashback_lineage_reset', _lineage_reset));
  perform public.log_operator_action(_subject, _ecosystem_id, 'Credit transfer', 'credit_transfer',
          _recipient_id, jsonb_build_object('amount', _amount, 'recipient', coalesce(_target,''),
                                            'tx_id', _tx, 'cashback_lineage_reset', _lineage_reset));
  return _tx;
end;
$function$;

create or replace function public.transfer_credits(_recipient_id uuid, _amount numeric, _note text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _subject uuid; _op uuid;
  _my_eco uuid; _eco uuid; _from uuid; _to uuid; _tx text;
  _status public.account_status; _actor_name text; _target text; _priv boolean;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  perform public.require_operational();
  perform public.assert_actor_active();
  select ecosystem_id into _my_eco from public.profiles where id = _subject;
  select ecosystem_id, status, full_name || ' — ' || email
    into _eco, _status, _target
  from public.profiles where id = _recipient_id;

  if _eco is null then raise exception 'Recipient not found'; end if;
  _priv := public.is_super_admin(_subject) or public.is_ecosystem_admin(_subject, _eco);
  if public.is_super_admin(_subject) then _my_eco := coalesce(_my_eco, _eco); end if;
  if _my_eco is null or _eco is distinct from _my_eco then
    raise exception 'Transfers are only allowed inside your own shop';
  end if;
  if _recipient_id = _subject then raise exception 'You cannot send credits to yourself'; end if;
  if _status <> 'active' then raise exception 'That account is suspended'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  if not _priv then
    if public.has_role(_subject, 'reseller') or public.has_role(_subject, 'subreseller') then
      if not public.can_load_credits(_subject, _recipient_id) then
        raise exception 'You can only send credits to customers in your shop and to your own subresellers';
      end if;
    else
      if public.is_super_admin(_recipient_id)
         or public.is_ecosystem_admin(_recipient_id, _eco)
         or public.has_role(_recipient_id, 'reseller')
         or public.has_role(_recipient_id, 'subreseller') then
        raise exception 'Credits can only be sent to fellow customers';
      end if;
    end if;
  end if;

  _from := public.wallet_id_for(_subject, _my_eco);
  _to := public.wallet_id_for(_recipient_id, _my_eco);
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_from, _subject, _my_eco, 'debit', _amount, 0, 'Credit transfer sent',
          nullif(trim(_note),''), _subject, _tx, 'general', _amount, 0, 0);

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_to, _recipient_id, _my_eco, 'credit', _amount, 0, 'Credit transfer received',
          nullif(trim(_note),''), _subject, _tx || '-R', 'general', _amount, 0, 0);

  select full_name into _actor_name from public.profiles where id = _op;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_my_eco, _op, coalesce(_actor_name,'Member'), 'Transferred credits', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'commission_percent', 0, 'sender_id', _subject,
                             'commission_amount', 0, 'total_received', _amount, 'tx_id', _tx));
  perform public.log_operator_action(_subject, _my_eco, 'Credit transfer', 'credit_transfer', _recipient_id, jsonb_build_object('amount', _amount, 'recipient', coalesce(_target,''), 'tx_id', _tx));
  return _tx;
end; $function$;
