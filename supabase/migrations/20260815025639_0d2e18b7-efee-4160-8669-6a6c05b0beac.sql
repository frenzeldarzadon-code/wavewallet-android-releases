-- Recipients a subreseller may send credits UP to, inside one shop.
create or replace function public.wallet_upward_recipients(_ecosystem_id uuid)
returns table(id uuid, full_name text, handle text, avatar_path text, relation text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare _subject uuid; _parent uuid;
begin
  _subject := public.effective_uid();
  if _subject is null or _ecosystem_id is null then return; end if;

  -- Only a subreseller *of that shop* has an upward path.
  if public.membership_role(_subject, _ecosystem_id) is distinct from 'subreseller'::public.app_role then
    return;
  end if;

  select p.reseller_id into _parent from public.profiles p where p.id = _subject;

  return query
  -- Parent reseller, only when they are an active reseller in this same shop.
  select p.id, p.full_name, p.handle, p.avatar_path, 'reseller'::text
    from public.profiles p
   where _parent is not null
     and p.id = _parent
     and p.status = 'active'
     and p.deleted_at is null
     and public.membership_role(p.id, _ecosystem_id) = 'reseller'::public.app_role
  union all
  -- Every active admin of this shop.
  select p.id, p.full_name, p.handle, p.avatar_path, 'admin'::text
    from public.ecosystem_memberships m
    join public.profiles p on p.id = m.user_id
   where m.ecosystem_id = _ecosystem_id
     and m.role = 'admin'
     and m.membership_state = 'active'
     and m.status = 'active'
     and p.status = 'active'
     and p.deleted_at is null
     and p.id <> _subject;
end;
$function$;

revoke all on function public.wallet_upward_recipients(uuid) from public, anon;
grant execute on function public.wallet_upward_recipients(uuid) to authenticated;

-- Face-value credit transfer from ONE of the caller's own shop wallets.
-- Same rules as transfer_credits, but the shop is explicit instead of being
-- taken from the caller's currently active shop, plus the subreseller upward
-- path (own parent reseller / an admin of that shop).
create or replace function public.transfer_credits_in_shop(
  _ecosystem_id uuid,
  _recipient_id uuid,
  _amount numeric,
  _note text default null
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _subject uuid; _op uuid; _tx text;
  _frozen boolean; _reason text; _eco_name text;
  _my_role public.app_role; _their_role public.app_role;
  _from uuid; _to uuid; _bal numeric(14,2);
  _target text; _actor_name text; _allowed boolean := false;
  _r_status public.account_status; _r_parent uuid; _r_deleted timestamptz;
  _my_parent uuid;
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

  -- Both parties must be approved, active members of THIS shop.
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

  if public.is_super_admin(_subject) or public.is_ecosystem_admin(_subject, _ecosystem_id) then
    _allowed := true;                                  -- shop operators may load anyone
  elsif _my_role = 'reseller' then
    -- Customers in the shop, plus their OWN subresellers.
    _allowed := (_their_role = 'customer')
             or (_their_role = 'subreseller' and _r_parent = _subject);
  elsif _my_role = 'subreseller' then
    -- Customers in the shop, plus the upward path: own parent reseller / shop admin.
    _allowed := (_their_role = 'customer')
             or (_their_role = 'reseller' and _my_parent = _recipient_id)
             or public.is_ecosystem_admin(_recipient_id, _ecosystem_id);
  else
    _allowed := (_their_role = 'customer')
                and not public.is_ecosystem_admin(_recipient_id, _ecosystem_id);
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

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_from, _subject, _ecosystem_id, 'debit', _amount, 0, 'Credit transfer sent',
          nullif(trim(_note),''), _op, _tx, _amount, 0, 0);

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_to, _recipient_id, _ecosystem_id, 'credit', _amount, 0, 'Credit transfer received',
          nullif(trim(_note),''), _op, _tx || '-R', _amount, 0, 0);

  select full_name into _actor_name from public.profiles where id = _op;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, _op, coalesce(_actor_name,'Member'), 'Transferred credits', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'commission_percent', 0,
                             'commission_amount', 0, 'total_received', _amount,
                             'tx_id', _tx, 'shop_scoped', true));
  perform public.log_operator_action(_subject, _ecosystem_id, 'Credit transfer', 'credit_transfer',
          _recipient_id, jsonb_build_object('amount', _amount, 'recipient', coalesce(_target,''), 'tx_id', _tx));
  return _tx;
end;
$function$;

revoke all on function public.transfer_credits_in_shop(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.transfer_credits_in_shop(uuid, uuid, numeric, text) to authenticated;