
alter table public.credit_ledger
  add column if not exists reverses_ledger_id uuid references public.credit_ledger(id);

create table if not exists public.credit_transfer_reversals (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id),
  original_tx_id text not null unique,
  original_sender_ledger_id uuid not null references public.credit_ledger(id),
  original_recipient_ledger_id uuid not null references public.credit_ledger(id),
  sender_id uuid not null,
  recipient_id uuid not null,
  original_amount numeric(14,2) not null check (original_amount > 0),
  reversed_amount numeric(14,2) not null check (reversed_amount > 0),
  kind text not null check (kind in ('full','partial')),
  reason text not null,
  note text,
  actor_id uuid,
  actor_name text not null,
  reversal_tx_id text not null,
  reversal_debit_ledger_id uuid references public.credit_ledger(id),
  reversal_credit_ledger_id uuid references public.credit_ledger(id),
  created_at timestamptz not null default now()
);

grant select on public.credit_transfer_reversals to authenticated;
grant all on public.credit_transfer_reversals to service_role;
alter table public.credit_transfer_reversals enable row level security;

create policy "Members read reversals in their shop"
  on public.credit_transfer_reversals for select to authenticated
  using (
    public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), ecosystem_id)
    or sender_id = auth.uid()
    or recipient_id = auth.uid()
  );

create index if not exists credit_transfer_reversals_eco_idx
  on public.credit_transfer_reversals (ecosystem_id, created_at desc);

-- Lot tracking: reversal debits consume only the lot created by the original
-- transfer, and restored credits are 'system' funded so they never earn
-- commission or cashback downstream.
create or replace function public.track_credit_lots()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _kind text; _src uuid; _left numeric(14,2); _take numeric(14,2); _lot record;
begin
  if new.direction = 'credit' then
    _src := new.actor_id;
    if new.entry_kind = 'transfer_reversal' then
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
     where user_id = new.user_id and remaining > 0
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

-- Read-only eligibility probe used by the confirmation dialog.
create or replace function public.transfer_reversal_info(_tx_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _sent public.credit_ledger; _recv public.credit_ledger;
  _base text := regexp_replace(coalesce(_tx_id,''), '-R$', '');
  _sender_name text; _recipient_name text; _bal numeric(14,2);
  _avail numeric(14,2); _rev public.credit_transfer_reversals;
begin
  select * into _sent from public.credit_ledger where tx_id = _base and direction = 'debit' limit 1;
  select * into _recv from public.credit_ledger where tx_id = _base || '-R' and direction = 'credit' limit 1;
  if _sent.id is null or _recv.id is null then
    return jsonb_build_object('eligible', false, 'code', 'not_found',
      'message', 'This is not a credit transfer. Voucher purchases and refunds use the sale refund workflow.');
  end if;
  if _sent.sale_id is not null or _recv.sale_id is not null then
    return jsonb_build_object('eligible', false, 'code', 'not_a_transfer',
      'message', 'This transaction belongs to a voucher sale — use the sale refund workflow instead.');
  end if;
  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _recv.ecosystem_id)) then
    return jsonb_build_object('eligible', false, 'code', 'forbidden',
      'message', 'You are not authorized to manage this shop.');
  end if;

  select full_name into _sender_name from public.profiles where id = _sent.user_id;
  select full_name into _recipient_name from public.profiles where id = _recv.user_id;
  select balance into _bal from public.credit_accounts where user_id = _recv.user_id;
  select coalesce(remaining, 0) into _avail from public.credit_lots where ledger_id = _recv.id;
  _avail := least(coalesce(_avail, 0), coalesce(_bal, 0));
  select * into _rev from public.credit_transfer_reversals where original_tx_id = _base;

  return jsonb_build_object(
    'eligible', _rev.id is null and _avail > 0,
    'code', case when _rev.id is not null then 'already_reversed'
                 when _avail <= 0 then 'no_unspent_credit' else 'ok' end,
    'message', case when _rev.id is not null then 'This transfer has already been reversed.'
                    when _avail <= 0 then 'Cannot reverse automatically because some credits have already been spent or transferred.'
                    else null end,
    'tx_id', _base,
    'ecosystem_id', _recv.ecosystem_id,
    'sender_id', _sent.user_id, 'sender_name', coalesce(_sender_name, 'Member'),
    'recipient_id', _recv.user_id, 'recipient_name', coalesce(_recipient_name, 'Member'),
    'amount', _sent.amount,
    'created_at', _sent.created_at,
    'note', _sent.reference,
    'recipient_balance', coalesce(_bal, 0),
    'available', _avail,
    'reversed_amount', coalesce(_rev.reversed_amount, 0),
    'reversal_kind', _rev.kind,
    'reversal_tx_id', _rev.reversal_tx_id,
    'reversal_reason', _rev.reason,
    'reversed_at', _rev.created_at,
    'reversed_by', _rev.actor_name
  );
end; $function$;

grant execute on function public.transfer_reversal_info(text) to authenticated;

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
  _sacct uuid; _racct uuid; _debit uuid; _credit uuid;
  _kind text; _actor text; _target text; _rid uuid;
begin
  perform public.require_operational();
  if coalesce(trim(_reason), '') = '' then raise exception 'A dispute reason is required'; end if;

  select * into _sent from public.credit_ledger where tx_id = _base and direction = 'debit' limit 1;
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
  if exists (select 1 from public.credit_transfer_reversals where original_tx_id = _base) then
    raise exception 'This transfer has already been reversed';
  end if;

  select balance into _bal from public.credit_accounts where user_id = _recv.user_id;
  select coalesce(remaining, 0) into _avail from public.credit_lots where ledger_id = _recv.id for update;
  _avail := least(coalesce(_avail, 0), coalesce(_bal, 0));
  if _avail <= 0 then
    raise exception 'Cannot reverse automatically because some credits have already been spent or transferred.';
  end if;

  if _amount is null then _amount := _sent.amount; end if;
  _amount := round(_amount, 2);
  if _amount <= 0 then raise exception 'Enter a positive amount'; end if;
  if _amount > _sent.amount then raise exception 'Reversal cannot exceed the original transfer'; end if;
  if _amount > _avail then
    raise exception 'Cannot reverse automatically because some credits have already been spent or transferred.';
  end if;
  _kind := case when _amount = _sent.amount then 'full' else 'partial' end;

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
                             'kind', _kind, 'reason', trim(_reason), 'note', nullif(trim(_note), ''),
                             'sender_id', _sent.user_id, 'recipient_id', _recv.user_id));

  return jsonb_build_object('id', _rid, 'reversal_tx_id', _ref, 'kind', _kind, 'amount', _amount);
end; $function$;

grant execute on function public.reverse_credit_transfer(text, numeric, text, text) to authenticated;
