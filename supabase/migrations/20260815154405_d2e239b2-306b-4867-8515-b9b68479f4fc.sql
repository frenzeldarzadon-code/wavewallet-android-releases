-- Cash In: configured-matching automatic approval (no external payment feed).

alter table public.cash_in_requests
  add column if not exists payer_number text,
  add column if not exists payer_number_key text;

alter table public.ecosystems
  add column if not exists cash_in_gcash_number text;

alter table public.cash_in_auto_rules
  add column if not exists expected_amount_php numeric;

drop function if exists public.cash_in_auto_rule(uuid);

-- Normalise Philippine mobile numbers so 09XXXXXXXXX, +639XXXXXXXXX,
-- 639XXXXXXXXX and 9XXXXXXXXX all compare equal.
create or replace function public.normalize_ph_mobile(_n text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  with d as (select regexp_replace(coalesce(_n,''), '[^0-9]', '', 'g') as v)
  select case
    when v = '' then null
    when length(v) = 11 and left(v,2) = '09' then '63' || right(v, 10)
    when length(v) = 12 and left(v,2) = '63' then v
    when length(v) = 10 and left(v,1) = '9' then '63' || v
    when length(v) = 13 and left(v,3) = '639' then right(v, 12)
    else v
  end from d
$$;

-- The receiving number a member must have paid: the shop's configured number
-- when set, otherwise the account number published on the payment method.
create or replace function public.cash_in_receiving_number(_ecosystem uuid, _method uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select nullif(trim(e.cash_in_gcash_number), '') from public.ecosystems e where e.id = _ecosystem),
    (select nullif(trim(m.account_number), '') from public.payment_methods m where m.id = _method)
  )
$$;

create or replace function public.set_ecosystem_cash_in_number(_ecosystem uuid, _number text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare _actor uuid := auth.uid(); _clean text;
begin
  if not (public.is_super_admin(_actor) or public.is_ecosystem_admin(_actor, _ecosystem)) then
    raise exception 'You cannot change the receiving number for this shop';
  end if;
  _clean := nullif(trim(_number), '');
  if _clean is not null and public.normalize_ph_mobile(_clean) is null then
    raise exception 'Enter a valid GCash number';
  end if;
  update public.ecosystems set cash_in_gcash_number = _clean, updated_at = now() where id = _ecosystem;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor,
          coalesce((select full_name from public.profiles where id = _actor), 'Operator'),
          'Updated cash in receiving number',
          coalesce((select name from public.ecosystems where id = _ecosystem), 'Shop'),
          jsonb_build_object('configured', _clean is not null));
  return _clean;
end $$;

-- Automatic approval now rests on configured matching data plus duplicate
-- protection. It never claims GCash verified anything: the screenshot is
-- retained as supporting evidence for audit and manual review.
create or replace function public.try_auto_approve_cash_in(_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare _row public.cash_in_requests; _rule record; _expected text; _note text;
begin
  select * into _row from public.cash_in_requests where id = _id for update;
  if _row.id is null then return 'not_found'; end if;
  if _row.status <> 'pending' then return 'not_pending'; end if;

  select * into _rule from public.cash_in_auto_rule(_row.ecosystem_id);
  if _rule is null or not _rule.enabled then return 'disabled'; end if;

  if _row.payer_reference_key is null then return 'no_reference'; end if;
  if _row.proof_path is null then return 'no_proof'; end if;

  if _rule.max_auto_amount_php is not null and _row.amount_php > _rule.max_auto_amount_php then
    return 'above_auto_limit';
  end if;
  if _rule.expected_amount_php is not null
     and abs(_row.amount_php - _rule.expected_amount_php) > coalesce(_rule.amount_tolerance_php, 0) then
    return 'amount_mismatch';
  end if;

  _expected := public.normalize_ph_mobile(public.cash_in_receiving_number(_row.ecosystem_id, _row.method_id));
  if _expected is null then return 'no_receiving_number'; end if;
  if _row.payer_number_key is null or _row.payer_number_key <> _expected then
    return 'number_mismatch';
  end if;

  _note := 'Matched the configured receiving GCash number and a new payment reference. '
        || 'The screenshot is retained as supporting evidence — GCash itself was not contacted.';

  _row := public.settle_cash_in_approval(_row.id, null, 'Automatic matching', 'automatic',
                                         'Matched the configured cash in details', null, _note);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, null, 'Automatic matching', 'Approved cash in', _row.requester_name,
          jsonb_build_object('reference', _row.reference, 'cash_in_id', _row.id,
                             'amount_php', _row.amount_php, 'credits', _row.credits,
                             'approval_method', 'automatic', 'matching_result', 'matched',
                             'payer_reference', _row.payer_reference,
                             'requester_id', _row.user_id, 'ecosystem_id', _row.ecosystem_id));
  return 'approved';
end $$;

-- Request: reference, receiving number and screenshot are now all required.
create or replace function public.request_cash_in(
  _method_id uuid, _amount_php numeric, _payer_reference text default null,
  _notes text default null, _request_key text default null, _proof_path text default null,
  _payer_number text default null)
returns cash_in_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _fee numeric(14,2); _net numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text; _proof text; _folder text;
        _ref_key text; _num text; _num_key text; _dup boolean := false;
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

  _ref_key := public.normalize_payment_reference(_payer_reference);
  if _ref_key is null then raise exception 'Enter the GCash payment reference number'; end if;

  _num := nullif(trim(_payer_number), '');
  _num_key := public.normalize_ph_mobile(_num);
  if _num_key is null then raise exception 'Enter the GCash number you paid'; end if;

  _proof := nullif(trim(_proof_path), '');
  if _proof is null then raise exception 'Attach your payment screenshot'; end if;
  _folder := split_part(_proof, '/', 1);
  if _folder is null or _folder = '' or (_folder <> _subject::text and _folder <> _op::text) then
    raise exception 'That payment screenshot does not belong to this member';
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

  if exists (select 1 from public.cash_in_requests c where c.payer_reference_key = _ref_key) then
    _dup := true;
  end if;

  begin
    insert into public.cash_in_requests (
      reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
      amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
      method_id, method_name, method_type,
      method_details, payer_reference, payer_reference_key, payer_number, payer_number_key,
      notes, proof_path, status, decision_reason, reviewed_at)
    values (_ref, _key, _subject, _eco, _name, _role::text,
            _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
            coalesce(_s.cash_in_fee_percent,0), _fee, _net,
            _m.id, _m.name, _m.method_type,
            jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                               'account_number', _m.account_number, 'notes', _m.notes),
            nullif(trim(_payer_reference),''),
            case when _dup then null else _ref_key end,
            _num, _num_key,
            nullif(trim(_notes),''), _proof,
            case when _dup then 'rejected' else 'pending' end,
            case when _dup then _dupe_reason else null end,
            case when _dup then now() else null end)
    returning * into _row;
  exception when unique_violation then
    -- Two submissions raced for the same reference: the loser is recorded as a
    -- rejected duplicate and credits nothing.
    _dup := true;
    insert into public.cash_in_requests (
      reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
      amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
      method_id, method_name, method_type,
      method_details, payer_reference, payer_number, payer_number_key, notes, proof_path,
      status, decision_reason, reviewed_at)
    values (_ref, _key, _subject, _eco, _name, _role::text,
            _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
            coalesce(_s.cash_in_fee_percent,0), _fee, _net,
            _m.id, _m.name, _m.method_type,
            jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                               'account_number', _m.account_number, 'notes', _m.notes),
            nullif(trim(_payer_reference),''), _num, _num_key, nullif(trim(_notes),''), _proof,
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
                             'has_proof', true));

  if not _dup then
    perform public.try_auto_approve_cash_in(_row.id);
    select * into _row from public.cash_in_requests where id = _row.id;
  end if;

  return _row;
end $function$;

create or replace function public.set_cash_in_auto_approval(
  _ecosystem uuid, _enabled boolean, _require_reference boolean default true,
  _tolerance numeric default 0, _max_amount numeric default null,
  _expected_amount numeric default null)
returns cash_in_auto_rules
language plpgsql
security definer
set search_path to 'public'
as $$
declare _row public.cash_in_auto_rules; _actor uuid := auth.uid();
begin
  if not (public.is_super_admin(_actor)
          or (_ecosystem is not null and public.is_ecosystem_admin(_actor, _ecosystem))) then
    raise exception 'You cannot change automatic cash in approval for this shop';
  end if;
  if _tolerance is null or _tolerance < 0 then raise exception 'Amount tolerance cannot be negative'; end if;

  if _ecosystem is null then
    update public.cash_in_auto_rules
       set enabled = _enabled, require_reference_match = true,
           amount_tolerance_php = _tolerance, max_auto_amount_php = _max_amount,
           expected_amount_php = _expected_amount,
           updated_by = _actor, updated_at = now()
     where ecosystem_id is null returning * into _row;
    if _row.id is null then
      insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                             amount_tolerance_php, max_auto_amount_php,
                                             expected_amount_php, updated_by)
      values (null, _enabled, true, _tolerance, _max_amount, _expected_amount, _actor)
      returning * into _row;
    end if;
  else
    insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                           amount_tolerance_php, max_auto_amount_php,
                                           expected_amount_php, updated_by)
    values (_ecosystem, _enabled, true, _tolerance, _max_amount, _expected_amount, _actor)
    on conflict (ecosystem_id) where ecosystem_id is not null
    do update set enabled = excluded.enabled,
                  require_reference_match = true,
                  amount_tolerance_php = excluded.amount_tolerance_php,
                  max_auto_amount_php = excluded.max_auto_amount_php,
                  expected_amount_php = excluded.expected_amount_php,
                  updated_by = excluded.updated_by, updated_at = now()
    returning * into _row;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor, coalesce((select full_name from public.profiles where id = _actor), 'Super Admin'),
          case when _enabled then 'Enabled automatic cash in approval' else 'Disabled automatic cash in approval' end,
          coalesce((select name from public.ecosystems where id = _ecosystem), 'Platform default'),
          jsonb_build_object('amount_tolerance_php', _tolerance, 'max_auto_amount_php', _max_amount,
                             'expected_amount_php', _expected_amount));
  return _row;
end $$;

create or replace function public.cash_in_auto_rule(_ecosystem uuid)
returns table(enabled boolean, require_reference_match boolean, amount_tolerance_php numeric,
              max_auto_amount_php numeric, expected_amount_php numeric, scope text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         r.expected_amount_php,
         case when r.ecosystem_id is null then 'platform' else 'shop' end
    from public.cash_in_auto_rules r
   where r.ecosystem_id is not distinct from _ecosystem
   union all
  select r.enabled, r.require_reference_match, r.amount_tolerance_php, r.max_auto_amount_php,
         r.expected_amount_php, 'platform'
    from public.cash_in_auto_rules r
   where r.ecosystem_id is null
     and not exists (select 1 from public.cash_in_auto_rules s where s.ecosystem_id = _ecosystem)
   union all
  select false, true, 0::numeric, null::numeric, null::numeric, 'default'
   where not exists (select 1 from public.cash_in_auto_rules)
   limit 1
$$;

create or replace function public.cash_in_auto_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare _actor uuid := auth.uid();
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can read the cash in matching status';
  end if;
  return jsonb_build_object(
    'platform_rule', (select to_jsonb(r) from public.cash_in_auto_rules r where r.ecosystem_id is null),
    'shop_rules', coalesce((select jsonb_agg(jsonb_build_object(
        'ecosystem_id', r.ecosystem_id, 'ecosystem_name', e.name, 'enabled', r.enabled,
        'require_reference_match', r.require_reference_match,
        'amount_tolerance_php', r.amount_tolerance_php, 'max_auto_amount_php', r.max_auto_amount_php,
        'expected_amount_php', r.expected_amount_php)
        order by e.name)
      from public.cash_in_auto_rules r join public.ecosystems e on e.id = r.ecosystem_id), '[]'::jsonb),
    'shops_with_number', (select count(*) from public.ecosystems
                           where nullif(trim(cash_in_gcash_number), '') is not null),
    'duplicates_blocked_30d', (select count(*) from public.cash_in_requests
                                where status = 'rejected'
                                  and decision_reason like 'Duplicate payment reference%'
                                  and created_at > now() - interval '30 days'),
    'auto_approved_30d', (select count(*) from public.cash_in_requests
                           where approval_method = 'automatic' and status = 'approved'
                             and reviewed_at > now() - interval '30 days')
  );
end $$;

drop function if exists public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric);
