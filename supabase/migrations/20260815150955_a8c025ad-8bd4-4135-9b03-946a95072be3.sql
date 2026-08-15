-- Optional automatic Cash In approval driven by VERIFIED incoming payments.
create or replace function public.normalize_payment_reference(_ref text)
returns text language sql immutable set search_path = public as $$
  select nullif(regexp_replace(lower(coalesce(_ref, '')), '[^a-z0-9]', '', 'g'), '')
$$;

create table if not exists public.payment_feed_sources (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  label text not null,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  status text not null default 'not_connected' check (status in ('not_connected','connected','error')),
  secret_name text,
  last_event_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.payment_feed_sources to authenticated;
grant all on public.payment_feed_sources to service_role;
alter table public.payment_feed_sources enable row level security;
drop policy if exists payment_feed_sources_read on public.payment_feed_sources;
create policy payment_feed_sources_read on public.payment_feed_sources
  for select to authenticated using (public.is_super_admin(auth.uid()));
insert into public.payment_feed_sources (provider, label, secret_name)
values ('gcash', 'GCash incoming payments', 'PAYMENT_FEED_WEBHOOK_SECRET')
on conflict (provider) do nothing;

create table if not exists public.verified_payments (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.payment_feed_sources(id) on delete set null,
  provider text not null,
  provider_txn_id text not null,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  account_ref text,
  amount_php numeric(14,2) not null check (amount_php > 0),
  payer_reference text,
  payer_reference_key text,
  payer_name text,
  paid_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  status text not null default 'unmatched' check (status in ('unmatched','consumed','ignored')),
  consumed_cash_in_id uuid references public.cash_in_requests(id) on delete set null,
  consumed_at timestamptz
);
create unique index if not exists verified_payments_provider_txn_uniq
  on public.verified_payments (provider, provider_txn_id);
create unique index if not exists verified_payments_consumed_uniq
  on public.verified_payments (consumed_cash_in_id) where consumed_cash_in_id is not null;
create index if not exists verified_payments_open_idx
  on public.verified_payments (status, amount_php) where status = 'unmatched';
grant select on public.verified_payments to authenticated;
grant all on public.verified_payments to service_role;
alter table public.verified_payments enable row level security;
drop policy if exists verified_payments_read on public.verified_payments;
create policy verified_payments_read on public.verified_payments
  for select to authenticated using (public.is_super_admin(auth.uid()));

create table if not exists public.cash_in_auto_rules (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid references public.ecosystems(id) on delete cascade,
  enabled boolean not null default false,
  require_reference_match boolean not null default true,
  amount_tolerance_php numeric(14,2) not null default 0 check (amount_tolerance_php >= 0),
  max_auto_amount_php numeric(14,2) check (max_auto_amount_php is null or max_auto_amount_php > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists cash_in_auto_rules_shop_uniq
  on public.cash_in_auto_rules (ecosystem_id) where ecosystem_id is not null;
create unique index if not exists cash_in_auto_rules_global_uniq
  on public.cash_in_auto_rules ((true)) where ecosystem_id is null;
grant select on public.cash_in_auto_rules to authenticated;
grant all on public.cash_in_auto_rules to service_role;
alter table public.cash_in_auto_rules enable row level security;
drop policy if exists cash_in_auto_rules_read on public.cash_in_auto_rules;
create policy cash_in_auto_rules_read on public.cash_in_auto_rules
  for select to authenticated using (
    public.is_super_admin(auth.uid())
    or (ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), ecosystem_id))
  );
insert into public.cash_in_auto_rules (ecosystem_id, enabled)
select null, false
where not exists (select 1 from public.cash_in_auto_rules where ecosystem_id is null);

alter table public.cash_in_requests
  add column if not exists payer_reference_key text,
  add column if not exists approval_method text not null default 'manual',
  add column if not exists verified_payment_id uuid references public.verified_payments(id) on delete set null,
  add column if not exists auto_match_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_in_requests_approval_method_check') then
    alter table public.cash_in_requests
      add constraint cash_in_requests_approval_method_check
      check (approval_method in ('manual','automatic'));
  end if;
end $$;

update public.cash_in_requests c
   set payer_reference_key = public.normalize_payment_reference(c.payer_reference)
 where c.payer_reference_key is null
   and c.payer_reference is not null
   and c.status in ('pending','approved')
   and not exists (
     select 1 from public.cash_in_requests d
      where d.id <> c.id
        and d.status in ('pending','approved')
        and public.normalize_payment_reference(d.payer_reference)
            = public.normalize_payment_reference(c.payer_reference)
   );

create unique index if not exists cash_in_requests_reference_key_uniq
  on public.cash_in_requests (payer_reference_key) where payer_reference_key is not null;

create or replace function public.cash_in_auto_rule(_ecosystem uuid)
returns table (enabled boolean, require_reference_match boolean, amount_tolerance_php numeric,
               max_auto_amount_php numeric, scope text)
language sql stable security definer set search_path = public as $$
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         case when r.ecosystem_id is null then 'platform' else 'shop' end
    from public.cash_in_auto_rules r
   where r.ecosystem_id is not distinct from _ecosystem
   union all
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php, 'platform'
    from public.cash_in_auto_rules r
   where r.ecosystem_id is null
     and not exists (select 1 from public.cash_in_auto_rules s where s.ecosystem_id = _ecosystem)
   union all
  select false, true, 0::numeric, null::numeric, 'default'
   where not exists (select 1 from public.cash_in_auto_rules)
   limit 1
$$;
revoke all on function public.cash_in_auto_rule(uuid) from public, anon;
grant execute on function public.cash_in_auto_rule(uuid) to authenticated, service_role;

create or replace function public.set_cash_in_auto_approval(
  _ecosystem uuid, _enabled boolean, _require_reference boolean default true,
  _tolerance numeric default 0, _max_amount numeric default null)
returns public.cash_in_auto_rules
language plpgsql security definer set search_path = public as $$
declare _row public.cash_in_auto_rules; _actor uuid := auth.uid();
begin
  if not (public.is_super_admin(_actor)
          or (_ecosystem is not null and public.is_ecosystem_admin(_actor, _ecosystem))) then
    raise exception 'You cannot change automatic cash in approval for this shop';
  end if;
  if _tolerance is null or _tolerance < 0 then raise exception 'Amount tolerance cannot be negative'; end if;

  if _ecosystem is null then
    update public.cash_in_auto_rules
       set enabled = _enabled, require_reference_match = coalesce(_require_reference, true),
           amount_tolerance_php = _tolerance, max_auto_amount_php = _max_amount,
           updated_by = _actor, updated_at = now()
     where ecosystem_id is null returning * into _row;
    if _row.id is null then
      insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                             amount_tolerance_php, max_auto_amount_php, updated_by)
      values (null, _enabled, coalesce(_require_reference, true), _tolerance, _max_amount, _actor)
      returning * into _row;
    end if;
  else
    insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                           amount_tolerance_php, max_auto_amount_php, updated_by)
    values (_ecosystem, _enabled, coalesce(_require_reference, true), _tolerance, _max_amount, _actor)
    on conflict (ecosystem_id) where ecosystem_id is not null
    do update set enabled = excluded.enabled,
                  require_reference_match = excluded.require_reference_match,
                  amount_tolerance_php = excluded.amount_tolerance_php,
                  max_auto_amount_php = excluded.max_auto_amount_php,
                  updated_by = excluded.updated_by, updated_at = now()
    returning * into _row;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor, coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          case when _enabled then 'Enabled automatic cash in approval' else 'Disabled automatic cash in approval' end,
          coalesce((select name from public.ecosystems where id = _ecosystem), 'Platform default'),
          jsonb_build_object('require_reference_match', coalesce(_require_reference, true),
                             'amount_tolerance_php', _tolerance, 'max_auto_amount_php', _max_amount));
  return _row;
end $$;
revoke all on function public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric) from public, anon;
grant execute on function public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric) to authenticated, service_role;

create or replace function public.settle_cash_in_approval(
  _id uuid, _actor uuid, _actor_name text, _approval_method text,
  _reason text default null, _payment uuid default null, _note text default null)
returns public.cash_in_requests
language plpgsql security definer set search_path = public as $$
declare _row public.cash_in_requests; _acct uuid; _ledger uuid; _tx text;
        _before numeric(14,2); _after numeric(14,2); _target text; _eco_name text; _role app_role;
        _eco uuid; _existing text; _recipient uuid; _acct_owner uuid;
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

  select tx_id into _existing from public.platform_credit_issuances
   where request_key = 'cash_in:' || _row.id::text;
  if _existing is not null then raise exception 'This request was already approved'; end if;

  select coalesce(_row.ecosystem_id, p.ecosystem_id,
                  (select ca.ecosystem_id from public.credit_accounts ca where ca.user_id = _recipient))
    into _eco from public.profiles p where p.id = _recipient;

  _acct := public.ensure_credit_account(_recipient, _eco);
  if _acct is null then raise exception 'Could not open a credit balance for this member'; end if;

  select user_id, balance into _acct_owner, _before from public.credit_accounts where id = _acct;
  if _acct_owner is distinct from _recipient then
    raise exception 'Recipient mismatch: refusing to credit an account that is not the requesting member';
  end if;
  if _actor is not null and _acct_owner = _actor then
    raise exception 'Refusing to credit the approving platform owner';
  end if;

  _tx := public.new_tx_id();

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _recipient, _eco, 'credit', _row.credits, 0,
          case when _approval_method = 'automatic'
               then 'Cash in auto-approved — ' || _row.reference
               else 'Cash in approved — ' || _row.reference end,
          _row.reference, _actor, _tx, 'cash_in', _row.credits, 0, 0)
  returning id, balance_after into _ledger, _after;

  select p.full_name || ' — ' || p.email into _target from public.profiles p where p.id = _recipient;
  select name into _eco_name from public.ecosystems where id = _eco;
  select role into _role from public.user_roles where user_id = _recipient limit 1;

  insert into public.platform_credit_issuances (
    tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name,
    recipient_role, ecosystem_id, ecosystem_name, amount, balance_before, balance_after,
    reason, category, reference, ledger_id)
  values (_tx, 'cash_in:' || _row.id::text, _actor, coalesce(_actor_name, 'Automatic verification'),
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
end $$;
revoke all on function public.settle_cash_in_approval(uuid, uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_cash_in_approval(uuid, uuid, text, text, text, uuid, text) to service_role;

create or replace function public.review_cash_in(_id uuid, _action text, _reason text default null)
returns public.cash_in_requests
language plpgsql security definer set search_path = public as $$
declare _row public.cash_in_requests; _actor text;
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
           decision_reason = nullif(trim(_reason),''), reviewed_at = now(),
           approval_method = 'manual', payer_reference_key = null
     where id = _id returning * into _row;
  else
    _row := public.settle_cash_in_approval(_id, auth.uid(), coalesce(_actor,'Super Admin'),
                                           'manual', _reason, null, null);
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, auth.uid(), coalesce(_actor,'Super Admin'),
          case _action when 'approve' then 'Approved cash in' else 'Rejected cash in' end,
          _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'amount_php', _row.amount_php,
                             'credits', _row.credits, 'status', _row.status,
                             'requester_id', _row.user_id, 'approval_method', 'manual',
                             'reason', nullif(trim(_reason),'')));
  return _row;
end $$;
revoke all on function public.review_cash_in(uuid, text, text) from public, anon;
grant execute on function public.review_cash_in(uuid, text, text) to authenticated, service_role;

create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare _row public.cash_in_requests; _rule record; _pay public.verified_payments;
        _key text; _note text;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then return 'disabled'; end if;
  if not exists (select 1 from public.payment_feed_sources where status = 'connected') then
    return 'no_feed';
  end if;
  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    return 'above_auto_limit';
  end if;

  _key := public.normalize_payment_reference(_row.payer_reference);
  if _rule.require_reference_match and _key is null then return 'no_reference'; end if;

  select v.* into _pay
    from public.verified_payments v
   where v.status = 'unmatched'
     and v.consumed_cash_in_id is null
     and abs(v.amount_php - _row.amount_php) <= _rule.amount_tolerance_php
     and (not _rule.require_reference_match or v.payer_reference_key = _key)
     and (v.payment_method_id is null or _row.method_id is null or v.payment_method_id = _row.method_id)
   order by v.paid_at
   for update skip locked
   limit 1;

  if _pay.id is null then return 'no_match'; end if;

  update public.verified_payments
     set status = 'consumed', consumed_cash_in_id = _row.id, consumed_at = now()
   where id = _pay.id and status = 'unmatched';
  if not found then return 'no_match'; end if;

  _note := format('Matched %s transaction %s for %s on %s',
                  _pay.provider, _pay.provider_txn_id, to_char(_pay.amount_php, 'FM999999990.00'),
                  to_char(_pay.paid_at, 'YYYY-MM-DD HH24:MI'));

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic verification', 'automatic',
                                         'Verified payment matched automatically', _pay.id, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic verification', 'Approved cash in', _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'cash_in_id', _row.id,
                             'amount_php', _row.amount_php, 'credits', _row.credits,
                             'approval_method', 'automatic', 'matching_result', 'matched',
                             'provider', _pay.provider, 'provider_txn_id', _pay.provider_txn_id,
                             'matched_amount_php', _pay.amount_php, 'paid_at', _pay.paid_at,
                             'received_at', _pay.received_at,
                             'requester_id', _row.user_id, 'ecosystem_id', _row.ecosystem_id));
  return 'approved';
end $$;
revoke all on function public.try_auto_approve_cash_in(uuid) from public, anon, authenticated;
grant execute on function public.try_auto_approve_cash_in(uuid) to service_role;

create or replace function public.record_verified_payment(
  _provider text, _provider_txn_id text, _amount_php numeric, _paid_at timestamptz default now(),
  _payer_reference text default null, _payer_name text default null, _account_ref text default null,
  _raw jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _src public.payment_feed_sources; _pay public.verified_payments; _fresh boolean := false;
        _target uuid; _result text := 'stored';
begin
  if nullif(trim(_provider), '') is null or nullif(trim(_provider_txn_id), '') is null then
    raise exception 'provider and provider_txn_id are required';
  end if;
  if _amount_php is null or _amount_php <= 0 then raise exception 'amount must be greater than zero'; end if;

  select * into _src from public.payment_feed_sources where provider = _provider;
  if _src.id is null then raise exception 'Unknown payment feed provider %', _provider; end if;

  insert into public.verified_payments (source_id, provider, provider_txn_id, payment_method_id,
                                        account_ref, amount_php, payer_reference, payer_reference_key,
                                        payer_name, paid_at, raw)
  values (_src.id, _provider, _provider_txn_id, _src.payment_method_id, _account_ref, _amount_php,
          nullif(trim(_payer_reference), ''), public.normalize_payment_reference(_payer_reference),
          nullif(trim(_payer_name), ''), coalesce(_paid_at, now()), coalesce(_raw, '{}'::jsonb))
  on conflict (provider, provider_txn_id) do nothing
  returning * into _pay;

  if _pay.id is null then
    select * into _pay from public.verified_payments
     where provider = _provider and provider_txn_id = _provider_txn_id;
    _result := 'duplicate_event';
  else
    _fresh := true;
  end if;

  update public.payment_feed_sources
     set last_event_at = now(), last_error = null, updated_at = now()
   where id = _src.id;

  if _fresh then
    select c.id into _target
      from public.cash_in_requests c
     where c.status = 'pending'
       and (c.payer_reference_key = _pay.payer_reference_key or _pay.payer_reference_key is null)
     order by c.created_at
     limit 1;
    if _target is not null then
      _result := public.try_auto_approve_cash_in(_target);
    else
      _result := 'no_pending_request';
    end if;
  end if;

  return jsonb_build_object('payment_id', _pay.id, 'stored', _fresh, 'result', _result);
end $$;
revoke all on function public.record_verified_payment(text, text, numeric, timestamptz, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_verified_payment(text, text, numeric, timestamptz, text, text, text, jsonb)
  to service_role;

create or replace function public.request_cash_in(
  _method_id uuid, _amount_php numeric, _payer_reference text default null,
  _notes text default null, _request_key text default null, _proof_path text default null)
returns public.cash_in_requests
language plpgsql security definer set search_path = public as $$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _fee numeric(14,2); _net numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text; _proof text; _folder text;
        _ref_key text; _dup boolean := false;
        _dupe_reason constant text := 'Duplicate payment reference/transaction already used.';
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

  _proof := nullif(trim(_proof_path), '');
  if _proof is not null then
    _folder := split_part(_proof, '/', 1);
    if _folder is null or _folder = '' or (_folder <> _subject::text and _folder <> _op::text) then
      raise exception 'That payment screenshot does not belong to this member';
    end if;
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);
  select * into _row from public.cash_in_requests where request_key = _key;
  if _row.id is not null then return _row; end if;

  select * into _s from public.money_settings();
  _fee := round(_amount_php * coalesce(_s.cash_in_fee_percent,0) / 100.0, 2);
  _net := round(_amount_php - _fee, 2);
  if _net <= 0 then raise exception 'That amount is too small to cash in'; end if;
  _credits := round(_net * _s.credits_per_unit / _s.php_per_unit, 2);
  if _credits <= 0 then raise exception 'That amount is too small to cash in'; end if;

  _ref := 'CI-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));
  _ref_key := public.normalize_payment_reference(_payer_reference);

  if _ref_key is not null and exists (
      select 1 from public.cash_in_requests c where c.payer_reference_key = _ref_key) then
    _dup := true;
  end if;

  begin
    insert into public.cash_in_requests (
      reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
      amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
      method_id, method_name, method_type,
      method_details, payer_reference, payer_reference_key, notes, proof_path,
      status, decision_reason, reviewed_at)
    values (_ref, _key, _subject, _eco, _name, _role::text,
            _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
            coalesce(_s.cash_in_fee_percent,0), _fee, _net,
            _m.id, _m.name, _m.method_type,
            jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                               'account_number', _m.account_number, 'notes', _m.notes),
            nullif(trim(_payer_reference),''),
            case when _dup then null else _ref_key end,
            nullif(trim(_notes),''), _proof,
            case when _dup then 'rejected' else 'pending' end,
            case when _dup then _dupe_reason else null end,
            case when _dup then now() else null end)
    returning * into _row;
  exception when unique_violation then
    _dup := true;
    insert into public.cash_in_requests (
      reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
      amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
      method_id, method_name, method_type,
      method_details, payer_reference, notes, proof_path,
      status, decision_reason, reviewed_at)
    values (_ref, _key, _subject, _eco, _name, _role::text,
            _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
            coalesce(_s.cash_in_fee_percent,0), _fee, _net,
            _m.id, _m.name, _m.method_type,
            jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                               'account_number', _m.account_number, 'notes', _m.notes),
            nullif(trim(_payer_reference),''), nullif(trim(_notes),''), _proof,
            'rejected', _dupe_reason, now())
    returning * into _row;
  end;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          case when _dup then 'Rejected duplicate cash in' else 'Requested cash in' end, _name,
          jsonb_build_object('reference', _ref, 'amount_php', _amount_php, 'credits', _credits,
                             'fee_percent', coalesce(_s.cash_in_fee_percent,0), 'fee_php', _fee,
                             'net_php', _net,
                             'method', _m.name, 'requester_id', _subject, 'status', _row.status,
                             'payer_reference', nullif(trim(_payer_reference),''),
                             'duplicate', _dup,
                             'has_proof', _proof is not null));

  if not _dup then
    perform public.try_auto_approve_cash_in(_row.id);
    select * into _row from public.cash_in_requests where id = _row.id;
  end if;

  return _row;
end $$;
revoke all on function public.request_cash_in(uuid, numeric, text, text, text, text) from public, anon;
grant execute on function public.request_cash_in(uuid, numeric, text, text, text, text) to authenticated, service_role;

create or replace function public.cash_in_auto_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _actor uuid := auth.uid();
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can read the payment feed status';
  end if;
  return jsonb_build_object(
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
        'provider', s.provider, 'label', s.label, 'status', s.status,
        'secret_name', s.secret_name, 'last_event_at', s.last_event_at, 'last_error', s.last_error)
        order by s.label) from public.payment_feed_sources s), '[]'::jsonb),
    'connected', exists (select 1 from public.payment_feed_sources where status = 'connected'),
    'platform_rule', (select to_jsonb(r) from public.cash_in_auto_rules r where r.ecosystem_id is null),
    'shop_rules', coalesce((select jsonb_agg(jsonb_build_object(
        'ecosystem_id', r.ecosystem_id, 'ecosystem_name', e.name, 'enabled', r.enabled,
        'require_reference_match', r.require_reference_match,
        'amount_tolerance_php', r.amount_tolerance_php, 'max_auto_amount_php', r.max_auto_amount_php)
        order by e.name)
      from public.cash_in_auto_rules r join public.ecosystems e on e.id = r.ecosystem_id), '[]'::jsonb),
    'unmatched_payments', (select count(*) from public.verified_payments where status = 'unmatched'),
    'auto_approved_30d', (select count(*) from public.cash_in_requests
                           where approval_method = 'automatic' and status = 'approved'
                             and reviewed_at > now() - interval '30 days')
  );
end $$;
revoke all on function public.cash_in_auto_status() from public, anon;
grant execute on function public.cash_in_auto_status() to authenticated, service_role;