-- 1. Per-reseller commission percentage
alter table public.profiles
  add column if not exists reseller_commission_percent integer not null default 0;

do $$ begin
  alter table public.profiles
    add constraint profiles_commission_range check (reseller_commission_percent between 0 and 100);
exception when duplicate_object then null; end $$;

-- 2. Snapshot columns on the credit ledger (historical, never rewritten)
alter table public.credit_ledger
  add column if not exists base_amount numeric(14,2),
  add column if not exists commission_percent numeric(5,2),
  add column if not exists commission_amount numeric(14,2);

-- 3. Members may not edit their own commission rate
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.id <> old.id then
    raise exception 'A profile id cannot be reassigned';
  end if;

  if new.ecosystem_id is distinct from old.ecosystem_id
     and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can move an account to another ecosystem';
  end if;

  if auth.uid() = new.id and not public.is_super_admin(auth.uid()) then
    new.reseller_discount_percent := old.reseller_discount_percent;
    new.reseller_commission_percent := old.reseller_commission_percent;
    new.reseller_id := old.reseller_id;
    new.status := old.status;
  end if;

  return new;
end;
$function$;

-- 4. Server-side resolution of the applicable commission rate.
--    Returns 0 unless: sender is admin of that ecosystem (or super admin)
--    AND recipient is a reseller of the same ecosystem.
create or replace function public.commission_rate_for(_sender uuid, _recipient uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare _eco uuid; _pct integer;
begin
  select ecosystem_id, coalesce(reseller_commission_percent, 0)
    into _eco, _pct
  from public.profiles where id = _recipient;
  if _eco is null then return 0; end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = _recipient and role = 'reseller' and ecosystem_id = _eco
  ) then
    return 0;
  end if;

  if public.is_super_admin(_sender) then return _pct; end if;

  if public.is_ecosystem_admin(_sender, _eco)
     and not public.has_role(_sender, 'reseller') then
    return _pct;
  end if;

  return 0;
end;
$function$;

grant execute on function public.commission_rate_for(uuid, uuid) to authenticated;

-- 5. Admin/super-admin sets a reseller's commission (future transfers only)
create or replace function public.set_reseller_commission(_user_id uuid, _percent integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _eco uuid; _prev integer; _actor_name text;
begin
  select ecosystem_id, reseller_commission_percent into _eco, _prev
  from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Reseller not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _percent is null or _percent < 0 or _percent > 100 then
    raise exception 'Commission must be between 0 and 100';
  end if;
  if not exists (select 1 from public.user_roles where user_id = _user_id and role = 'reseller') then
    raise exception 'Only resellers can have a commission rate';
  end if;

  update public.profiles set reseller_commission_percent = _percent where id = _user_id;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'), 'Updated reseller commission',
          (select full_name from public.profiles where id = _user_id),
          jsonb_build_object('previous_percent', _prev, 'new_percent', _percent,
                             'applies_to','future transfers only'));
end;
$function$;

grant execute on function public.set_reseller_commission(uuid, integer) to authenticated;

-- 6. Transfers: commission bonus on admin/super-admin -> reseller only
create or replace function public.transfer_credits(_recipient_id uuid, _amount numeric, _note text default null::text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _my_eco uuid; _eco uuid; _from uuid; _to uuid; _tx text;
  _status public.account_status;
  _pct integer := 0; _bonus numeric(14,2) := 0; _total numeric(14,2);
  _actor_name text; _target text;
begin
  select ecosystem_id into _my_eco from public.profiles where id = auth.uid();
  select ecosystem_id, status, full_name || ' — ' || email
    into _eco, _status, _target
  from public.profiles where id = _recipient_id;

  if _eco is null then raise exception 'Recipient not found'; end if;
  if public.is_super_admin(auth.uid()) then
    _my_eco := coalesce(_my_eco, _eco);
  end if;
  if _my_eco is null or _eco is distinct from _my_eco then
    raise exception 'Transfers are only allowed inside your own shop';
  end if;
  if _recipient_id = auth.uid() then raise exception 'You cannot send credits to yourself'; end if;
  if _status <> 'active' then raise exception 'That account is suspended'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _recipient_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  -- Rate is resolved in the database; the client can never supply it.
  _pct := public.commission_rate_for(auth.uid(), _recipient_id);
  _bonus := round(_amount * _pct / 100.0, 2);
  _total := _amount + _bonus;

  _tx := public.new_tx_id();
  -- The ledger trigger recomputes the balance and refuses to go negative.
  -- Sender is debited the BASE amount only.
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _my_eco, 'debit', _amount, 0,
          case when _bonus > 0 then 'Credit released to reseller' else 'Credit transfer sent' end,
          nullif(trim(_note),''), auth.uid(), _tx, _amount, _pct, _bonus);

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_to, _recipient_id, _my_eco, 'credit', _total, 0,
          case when _bonus > 0 then 'Credit received with commission' else 'Credit transfer received' end,
          nullif(trim(_note),''), auth.uid(), _tx || '-R', _amount, _pct, _bonus);

  if _bonus > 0 then
    select full_name into _actor_name from public.profiles where id = auth.uid();
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_my_eco, auth.uid(), coalesce(_actor_name,'Admin'), 'Released credits to reseller',
            coalesce(_target,''),
            jsonb_build_object('base_amount', _amount, 'commission_percent', _pct,
                               'commission_amount', _bonus, 'total_received', _total, 'tx_id', _tx));
  end if;

  return _tx;
end;
$function$;

-- 7. Admin credit adjustment: same commission rule on positive releases to a reseller
create or replace function public.admin_adjust_credits(_user_id uuid, _amount numeric, _reason text, _reference text default null::text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _eco uuid; _acct uuid; _tx text; _actor text; _target text; _dir text;
  _pct integer := 0; _bonus numeric(14,2) := 0; _total numeric(14,2);
begin
  select p.ecosystem_id, p.full_name || ' — ' || p.email into _eco, _target
  from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _amount is null or _amount = 0 then raise exception 'Enter an amount'; end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;

  select id into _acct from public.credit_accounts where user_id = _user_id;
  if _acct is null then raise exception 'This member has no credit wallet yet'; end if;

  _tx := public.new_tx_id();
  _dir := case when _amount > 0 then 'credit' else 'debit' end;

  if _amount > 0 then
    _pct := public.commission_rate_for(auth.uid(), _user_id);
    _bonus := round(_amount * _pct / 100.0, 2);
  end if;
  _total := abs(_amount) + _bonus;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, _dir, _total, 0,
          case when _bonus > 0 then 'Credit released with commission' else trim(_reason) end,
          nullif(trim(_reference),''), auth.uid(), _tx, abs(_amount), _pct, _bonus);

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'),
          case when _amount > 0 then 'Added credits' else 'Deducted credits' end,
          coalesce(_target,''),
          jsonb_build_object('amount', abs(_amount), 'reason', trim(_reason), 'reference', _reference,
                             'commission_percent', _pct, 'commission_amount', _bonus,
                             'total_received', _total, 'tx_id', _tx));
  return _tx;
end;
$function$;