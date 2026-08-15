-- 1. Recipients: a customer may now see peers AND the shop's uplines.
CREATE OR REPLACE FUNCTION public.wallet_shop_recipients(_ecosystem_id uuid, _search text DEFAULT NULL::text, _limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, full_name text, handle text, avatar_path text, role text, relation text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _subject uuid; _my_role public.app_role; _my_parent uuid; _is_op boolean;
  _term text;
begin
  _subject := public.effective_uid();
  if _subject is null or _ecosystem_id is null then return; end if;

  _is_op := public.is_super_admin(_subject) or public.is_ecosystem_admin(_subject, _ecosystem_id);
  if not _is_op and not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _subject and m.ecosystem_id = _ecosystem_id
       and m.membership_state = 'active' and m.status = 'active') then
    return;
  end if;

  _my_role := public.membership_role(_subject, _ecosystem_id);
  select p.reseller_id into _my_parent from public.profiles p where p.id = _subject;
  _term := nullif(trim(coalesce(_search, '')), '');

  return query
  select p.id,
         p.full_name,
         p.handle,
         p.avatar_path,
         m.role::text,
         case
           when public.is_ecosystem_admin(p.id, _ecosystem_id) then 'admin'
           when m.role = 'reseller' and p.id = _my_parent then 'reseller'
           when m.role = 'subreseller' and p.reseller_id = _subject then 'subreseller'
           else m.role::text
         end as relation
    from public.ecosystem_memberships m
    join public.profiles p on p.id = m.user_id
   where m.ecosystem_id = _ecosystem_id
     and m.membership_state = 'active'
     and m.status = 'active'
     and p.status = 'active'
     and p.deleted_at is null
     and p.id <> _subject
     and not public.is_super_admin(p.id)
     and (_term is null or p.full_name ilike '%' || _term || '%' or coalesce(p.handle,'') ilike '%' || _term || '%')
     and (
       case
         when _is_op then true
         when _my_role = 'reseller' then
           (m.role = 'customer') or (m.role = 'subreseller' and p.reseller_id = _subject)
         when _my_role = 'subreseller' then
           (m.role = 'customer')
           or (m.role = 'reseller' and p.id = _my_parent)
           or public.is_ecosystem_admin(p.id, _ecosystem_id)
         else
           -- Customer: peer customers plus every active upline of THIS shop.
           (m.role in ('customer','subreseller','reseller'))
           or public.is_ecosystem_admin(p.id, _ecosystem_id)
       end
     )
   order by (case when public.is_ecosystem_admin(p.id, _ecosystem_id) then 0
                  when m.role = 'reseller' and p.id = _my_parent then 1
                  when m.role = 'subreseller' and p.reseller_id = _subject then 2
                  else 3 end), p.full_name
   limit greatest(1, least(coalesce(_limit, 50), 200));
end;
$function$;

-- 2. Transfer: allow customer -> same-shop upline, and mark the lineage reset.
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
  _kind := case when _lineage_reset then 'customer_upline_transfer' else null end;
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

-- 3. Credit lots: a customer -> upline arrival explicitly starts a fresh, untraced lot.
CREATE OR REPLACE FUNCTION public.track_credit_lots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _kind text; _src uuid; _left numeric(14,2); _take numeric(14,2); _lot record;
  _nil uuid := '00000000-0000-0000-0000-000000000000';
begin
  if new.direction = 'credit' then
    _src := new.actor_id;
    if new.entry_kind = 'customer_upline_transfer' then
      -- Deliberate business rule: credits a customer sends to an upline arrive
      -- with NO cashback lineage. The upline's later use starts a normal one.
      _kind := 'system'; _src := null;
    elsif new.entry_kind = 'shop_transfer_in' then
      _kind := 'transfer'; _src := null;
    elsif new.entry_kind = 'transfer_reversal' then
      _kind := 'system'; _src := null;
    elsif new.entry_kind = 'sale_commission' or _src is null then
      _kind := 'system'; _src := null;
    elsif _src = new.user_id then
      _kind := 'self';
    elsif public.is_super_admin(_src) or public.is_ecosystem_admin(_src, new.ecosystem_id) then
      _kind := 'admin';
    elsif exists (select 1 from public.user_roles ur
                   where ur.user_id = _src and ur.role = 'reseller' and ur.ecosystem_id = new.ecosystem_id) then
      _kind := 'reseller';
    elsif exists (select 1 from public.user_roles ur
                   where ur.user_id = _src and ur.role = 'subreseller' and ur.ecosystem_id = new.ecosystem_id) then
      _kind := 'subreseller';
    else
      _kind := 'system'; _src := null;
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