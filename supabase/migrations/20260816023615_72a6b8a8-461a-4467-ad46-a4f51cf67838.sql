-- Stage 3: Admin-GCash Cash In is an internal 1:1 transfer from the shop admin
-- to the requester. Nothing is minted on this path; the Super Admin GCash path
-- keeps the existing platform issuance behaviour untouched.

alter table public.cash_in_requests
  add column if not exists funding_source text not null default 'platform',
  add column if not exists funding_admin_id uuid references public.profiles(id),
  add column if not exists funding_account_id uuid references public.credit_accounts(id),
  add column if not exists funding_ledger_id uuid references public.credit_ledger(id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cash_in_requests_funding_source_check') then
    alter table public.cash_in_requests
      add constraint cash_in_requests_funding_source_check
      check (funding_source in ('platform','admin'));
  end if;
end $$;

create index if not exists cash_in_requests_funding_admin_idx
  on public.cash_in_requests (funding_admin_id, status)
  where funding_source = 'admin';

-- The shop admin who funds Admin-GCash cash in for a shop.
create or replace function public.shop_funding_admin(_ecosystem uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m.user_id from public.ecosystem_memberships m
   where m.ecosystem_id = _ecosystem and m.role = 'admin'
     and m.membership_state = 'active' and m.status = 'active'
   order by m.created_at
   limit 1;
$function$;

-- Spendable capacity = the admin's wallet for this shop minus the credits already
-- reserved by pending Admin-GCash cash in requests.
create or replace function public.admin_cash_in_capacity(_ecosystem uuid)
 returns table(admin_id uuid, admin_name text, balance numeric, reserved numeric, available numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare _admin uuid; _bal numeric(14,2); _res numeric(14,2);
begin
  _admin := public.shop_funding_admin(_ecosystem);
  if _admin is null then
    return query select null::uuid, null::text, 0::numeric, 0::numeric, 0::numeric;
    return;
  end if;
  select coalesce(ca.balance, 0) into _bal from public.credit_accounts ca
   where ca.user_id = _admin and ca.ecosystem_id is not distinct from _ecosystem;
  select coalesce(sum(c.credits), 0) into _res from public.cash_in_requests c
   where c.funding_source = 'admin' and c.funding_admin_id = _admin
     and c.ecosystem_id is not distinct from _ecosystem and c.status = 'pending';
  return query select _admin,
                      (select p.full_name from public.profiles p where p.id = _admin),
                      coalesce(_bal,0),
                      coalesce(_res,0),
                      greatest(coalesce(_bal,0) - coalesce(_res,0), 0);
end $function$;

revoke all on function public.shop_funding_admin(uuid) from public, anon;
revoke all on function public.admin_cash_in_capacity(uuid) from public, anon;
grant execute on function public.admin_cash_in_capacity(uuid) to authenticated;

-- Legacy overload without the sending number: retired so every cash in goes
-- through the verified path.
drop function if exists public.request_cash_in(uuid, numeric, text, text, text, text);
drop function if exists public.request_cash_in(uuid, numeric, text, text, text, text, text);

create or replace function public.request_cash_in(_method_id uuid, _amount_php numeric, _payer_reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _request_key text DEFAULT NULL::text, _proof_path text DEFAULT NULL::text, _payer_number text DEFAULT NULL::text, _funding_source text DEFAULT 'platform'::text)
 RETURNS cash_in_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _fee numeric(14,2); _net numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text; _proof text; _folder text;
        _ref_key text; _num text; _num_key text; _dup boolean := false; _prev uuid;
        _fund text; _admin uuid; _admin_acct uuid; _avail numeric(14,2);
        _dupe_reason constant text :=
          'This GCash reference was already submitted. Held for manual investigation — '
          || 'the earlier transaction was left untouched.';
begin
  _op := auth.uid(); _subject := public.effective_uid();
  _fund := lower(coalesce(nullif(trim(_funding_source),''), 'platform'));
  if _fund not in ('platform','admin') then raise exception 'Choose a valid cash in destination'; end if;

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
  if _num_key is null then raise exception 'Enter the GCash number you paid from'; end if;

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

  if _fund = 'admin' then
    if _eco is null then raise exception 'Choose a shop before cashing in with your shop admin'; end if;
    _admin := public.shop_funding_admin(_eco);
    if _admin is null then raise exception 'This shop has no active admin to fund a cash in'; end if;
    if _admin = _subject then
      raise exception 'A shop admin cannot cash in against their own wallet';
    end if;
    -- Lock the funding wallet so two requests cannot reserve the same credits.
    _admin_acct := public.ensure_credit_account(_admin, _eco);
    if _admin_acct is null then raise exception 'The shop admin has no wallet in this shop'; end if;
    perform 1 from public.credit_accounts where id = _admin_acct for update;
    select c.available into _avail from public.admin_cash_in_capacity(_eco) c;
    if coalesce(_avail,0) < _credits then
      raise exception 'Your shop admin can only fund % credits right now', trunc(coalesce(_avail,0));
    end if;
  end if;

  _ref := 'CI-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  select c.id into _prev from public.cash_in_requests c
   where c.payer_reference_key = _ref_key
   order by (c.status = 'approved') desc, c.created_at asc
   limit 1;
  _dup := _prev is not null;

  insert into public.cash_in_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
    amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
    method_id, method_name, method_type,
    method_details, payer_reference, payer_reference_key, payer_number, payer_number_key,
    sender_number, sender_number_key, duplicate_reference, duplicate_of,
    notes, proof_path, status, decision_reason,
    funding_source, funding_admin_id, funding_account_id)
  values (_ref, _key, _subject, _eco, _name, _role::text,
          _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
          coalesce(_s.cash_in_fee_percent,0), _fee, _net,
          _m.id, _m.name, _m.method_type,
          jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                             'account_number', _m.account_number, 'notes', _m.notes),
          nullif(trim(_payer_reference),''), _ref_key, _num, _num_key, _num, _num_key,
          _dup, _prev,
          nullif(trim(_notes),''), _proof,
          'pending', case when _dup then _dupe_reason else null end,
          _fund, _admin, _admin_acct)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          case when _dup then 'Flagged duplicate cash in' else 'Requested cash in' end, _name,
          jsonb_build_object('reference', _ref, 'amount_php', _amount_php, 'credits', _credits,
                             'fee_percent', coalesce(_s.cash_in_fee_percent,0), 'fee_php', _fee,
                             'net_php', _net,
                             'method', _m.name, 'requester_id', _subject, 'status', _row.status,
                             'payer_reference', nullif(trim(_payer_reference),''),
                             'funding_source', _fund, 'funding_admin_id', _admin,
                             'duplicate', _dup,
                             'has_proof', true));

  if _dup then
    perform public.record_cash_in_reference_conflict(_row.id);
  else
    perform public.link_cash_in_listener_event(_row.id);
    perform public.try_auto_approve_cash_in(_row.id);
  end if;

  select * into _row from public.cash_in_requests where id = _row.id;
  return _row;
end $function$;

revoke all on function public.request_cash_in(uuid, numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.request_cash_in(uuid, numeric, text, text, text, text, text, text) to authenticated;