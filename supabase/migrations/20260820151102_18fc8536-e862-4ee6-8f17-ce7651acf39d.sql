-- New Generation Shops: free creation -> Demo -> Go Live paid with an existing plan.
-- Legacy shops (ecosystems.shop_kind = 'legacy') are untouched, and the GCash
-- listener matching functions are NOT modified.

create or replace function public.is_new_generation_shop(_ecosystem_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select e.shop_kind = 'subscription' from public.ecosystems e where e.id = _ecosystem_id), false)
$$;

create or replace function public.is_legacy_shop(_ecosystem_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select e.shop_kind = 'legacy' from public.ecosystems e where e.id = _ecosystem_id), false)
$$;

revoke all on function public.is_new_generation_shop(uuid) from public, anon;
revoke all on function public.is_legacy_shop(uuid) from public, anon;
grant execute on function public.is_new_generation_shop(uuid) to authenticated, service_role;
grant execute on function public.is_legacy_shop(uuid) to authenticated, service_role;

alter table public.subscription_requests
  add column if not exists purpose text not null default 'legacy_manual',
  add column if not exists plan_id uuid references public.subscription_plans(id),
  add column if not exists payer_number text,
  add column if not exists payer_number_key text,
  add column if not exists payer_reference_key text,
  add column if not exists listener_event_id uuid,
  add column if not exists auto_state text not null default 'pending',
  add column if not exists auto_reason text;

do $$ begin
  alter table public.subscription_requests
    add constraint subscription_requests_purpose_check
    check (purpose in ('legacy_manual','go_live','plan_change'));
exception when duplicate_object then null; end $$;

create index if not exists subscription_requests_ref_key_idx
  on public.subscription_requests (payer_reference_key);
create index if not exists subscription_requests_pending_idx
  on public.subscription_requests (status, purpose);

update public.subscription_requests
   set payer_reference_key = public.normalize_payment_reference(payment_reference)
 where payer_reference_key is null;

alter table public.listener_events
  add column if not exists consumed_subscription_request_id uuid references public.subscription_requests(id);

create or replace function public.tg_listener_event_single_use()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.consumed_cash_in_id is not null
     and old.consumed_cash_in_id is null
     and coalesce(old.consumed_subscription_request_id, new.consumed_subscription_request_id) is not null then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists listener_events_single_use on public.listener_events;
create trigger listener_events_single_use
  before update on public.listener_events
  for each row execute function public.tg_listener_event_single_use();

create or replace function public.apply_subscription_plan(
  _ecosystem_id uuid, _plan_id uuid, _months integer default 1,
  _amount_php numeric default null, _reference text default null,
  _notes text default null)
returns shop_subscriptions
language plpgsql security definer set search_path to 'public' as $$
declare
  _sub public.shop_subscriptions; _plan public.subscription_plans;
  _prev uuid; _prev_alloc numeric(14,2) := 0; _add numeric(14,2) := 0;
  _admin uuid; _tx text; _start timestamptz; _end timestamptz; _me text; _kind text;
begin
  if coalesce(_months, 1) < 1 or _months > 24 then raise exception 'Months must be between 1 and 24'; end if;

  select shop_kind into _kind from public.ecosystems where id = _ecosystem_id;
  if _kind is distinct from 'subscription' then
    raise exception 'Only Subscription Shops use the subscription plan system';
  end if;
  select * into _plan from public.subscription_plans where id = _plan_id and active;
  if _plan.id is null then raise exception 'Choose an available plan'; end if;

  insert into public.shop_subscriptions (ecosystem_id, state) values (_ecosystem_id, 'review')
  on conflict (ecosystem_id) do nothing;
  select * into _sub from public.shop_subscriptions where ecosystem_id = _ecosystem_id for update;

  _prev := _sub.plan_id;
  _prev_alloc := coalesce(_sub.allocation_total, 0);
  _add := greatest(0, round(_plan.coin_allocation - _prev_alloc, 2));

  _start := case when _sub.period_end is not null and _sub.period_end > now()
                 then _sub.period_end else now() end;
  _end := _start + (_months || ' months')::interval;

  if coalesce((select is_review from public.ecosystems where id = _ecosystem_id), false) then
    delete from public.demo_ledger where ecosystem_id = _ecosystem_id;
    delete from public.demo_wallets where ecosystem_id = _ecosystem_id;
    delete from public.demo_vouchers where ecosystem_id = _ecosystem_id;
    update public.ecosystems
       set is_review = false, review_ends_at = null, signup_enabled = true
     where id = _ecosystem_id;
  end if;

  update public.ecosystems
     set subscription_state = 'active',
         operations_frozen = false,
         frozen_reason = null,
         plan_name = _plan.name,
         plan_price = _plan.monthly_price,
         current_period_end = _end,
         payment_reference = coalesce(nullif(trim(_reference),''), payment_reference),
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = _ecosystem_id;

  if _add > 0 then
    select m.user_id into _admin from public.ecosystem_memberships m
     where m.ecosystem_id = _ecosystem_id and m.role = 'admin'
       and m.membership_state = 'active' and m.status = 'active'
     order by m.created_at limit 1;
    if _admin is null then raise exception 'This shop has no active admin to receive the allocation'; end if;
    _tx := public.superadmin_issue_credits(
      _admin, _add,
      'Subscription cashflow allocation — ' || _plan.name,
      'Subscription allocation',
      nullif(trim(_reference),''), null, _ecosystem_id);
  end if;

  update public.shop_subscriptions
     set plan_id = _plan.id,
         state = 'active',
         allocation_total = greatest(_prev_alloc, _plan.coin_allocation),
         period_start = _start,
         period_end = _end,
         review_ends_at = null,
         updated_at = now()
   where ecosystem_id = _ecosystem_id
   returning * into _sub;

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.subscription_events
    (ecosystem_id, event_type, previous_plan_id, new_plan_id, amount_php,
     allocation_granted, additional_allocation, payment_reference, verification_status,
     period_start, period_end, tx_id, actor_id, actor_name, notes)
  values
    (_ecosystem_id,
     case when _prev is null then 'activation'
          when _prev = _plan.id then 'renewal' else 'upgrade' end,
     _prev, _plan.id, _amount_php, _add, _add,
     nullif(trim(_reference),''), 'verified', _start, _end, _tx, auth.uid(),
     coalesce(_me,'Platform owner'),
     coalesce(_notes, 'SUBSCRIPTION_PAYMENT — not a cash in, not a coin transfer'));

  return _sub;
end $$;

revoke all on function public.apply_subscription_plan(uuid, uuid, integer, numeric, text, text) from public, anon, authenticated;
grant execute on function public.apply_subscription_plan(uuid, uuid, integer, numeric, text, text) to service_role;

create or replace function public.activate_subscription(
  _ecosystem_id uuid, _plan_id uuid, _amount_php numeric default null,
  _reference text default null, _months integer default 1)
returns shop_subscriptions
language plpgsql security definer set search_path to 'public' as $$
declare _sub public.shop_subscriptions;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can activate a subscription';
  end if;
  _sub := public.apply_subscription_plan(_ecosystem_id, _plan_id, _months, _amount_php, _reference, null);
  return _sub;
end $$;

create or replace function public.go_live_reference_duplicate(_key text, _id uuid default null)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select 'cash_in' from public.cash_in_requests c
      where _key is not null and c.status in ('pending','approved')
        and _key in (coalesce(c.payer_reference_key,''), coalesce(c.receipt_reference_key,''), coalesce(c.ocr_reference_key,''))
      limit 1),
    (select 'subscription' from public.subscription_requests r
      where _key is not null and r.id is distinct from _id
        and r.status in ('pending','approved')
        and r.payer_reference_key = _key
      limit 1))
$$;

create or replace function public.activate_go_live_request(_request_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _req public.subscription_requests; _eco public.ecosystems;
begin
  select * into _req from public.subscription_requests where id = _request_id for update;
  if _req.id is null then return 'not_found'; end if;
  if _req.status <> 'pending' then return 'already_activated'; end if;
  if _req.plan_id is null then return 'no_plan'; end if;
  select * into _eco from public.ecosystems where id = _req.ecosystem_id;

  perform public.apply_subscription_plan(
    _req.ecosystem_id, _req.plan_id, coalesce(_req.months_purchased, 1),
    _req.amount_paid, _req.payment_reference,
    case when _req.purpose = 'go_live' then 'GO_LIVE — verified GCash subscription payment'
         else 'PLAN_CHANGE — verified GCash subscription payment' end);

  update public.subscription_requests
     set status = 'approved', reviewed_at = now(),
         reviewed_by_name = 'WaveWallet GCash listener',
         auto_state = 'activated',
         auto_reason = 'Verified payment — the shop is live on the ' || _req.plan_name || ' plan',
         period_start = now()
   where id = _request_id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_req.ecosystem_id, _req.requested_by, 'WaveWallet GCash listener',
          'Activated shop from verified GCash payment', coalesce(_eco.name,'Shop'),
          jsonb_build_object('request_id', _req.id, 'plan', _req.plan_name,
                             'reference', _req.payment_reference,
                             'listener_event_id', _req.listener_event_id,
                             'months', _req.months_purchased));
  return 'activated';
end $$;

create or replace function public.reconcile_go_live_request(_request_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _req public.subscription_requests; _ev uuid; _n int; _tol numeric;
begin
  select * into _req from public.subscription_requests where id = _request_id for update;
  if _req.id is null then return 'not_found'; end if;
  if _req.status <> 'pending' then return 'not_pending'; end if;
  if _req.purpose not in ('go_live','plan_change') then return 'not_applicable'; end if;
  if _req.payer_number_key is null then return 'missing_sender_number'; end if;

  select coalesce(r.amount_tolerance_php, 0) into _tol from public.cash_in_auto_rule(null) r;

  select count(*), min(e.id) into _n, _ev
    from public.listener_events e
    join public.listener_devices d on d.id = e.device_id
   where e.outcome = 'accepted'
     and d.owner_role = 'platform'
     and d.status = 'active'
     and e.consumed_cash_in_id is null
     and e.consumed_subscription_request_id is null
     and e.sender_number_key = _req.payer_number_key
     and e.amount_php is not null
     and abs(e.amount_php - _req.amount_due) <= coalesce(_tol, 0)
     and coalesce(e.posted_at, e.created_at)
           between _req.created_at - interval '3 days' and _req.created_at + interval '3 days'
     and not exists (
       select 1 from public.cash_in_requests c
        where c.status = 'pending' and c.listener_event_id is null
          and public.listener_event_fits_cash_in(e, c));

  if _n = 0 then
    update public.subscription_requests
       set auto_state = 'pending',
           auto_reason = 'Waiting for the GCash notification for this amount and sending number'
     where id = _request_id;
    return 'no_match';
  end if;
  if _n > 1 then
    update public.subscription_requests
       set auto_state = 'ambiguous',
           auto_reason = 'More than one GCash notification matches — held for the platform owner to review'
     where id = _request_id;
    return 'ambiguous';
  end if;

  update public.listener_events
     set consumed_subscription_request_id = _request_id,
         match_result = 'matched:subscription', review_state = 'matched'
   where id = _ev and consumed_subscription_request_id is null and consumed_cash_in_id is null;
  if not found then
    update public.subscription_requests set auto_state = 'pending',
           auto_reason = 'The matching GCash notification was already used elsewhere'
     where id = _request_id;
    return 'already_consumed';
  end if;

  update public.subscription_requests
     set listener_event_id = _ev, auto_state = 'verified',
         auto_reason = 'Payment confirmed by the platform GCash listener'
   where id = _request_id;

  return public.activate_go_live_request(_request_id);
end $$;

create or replace function public.submit_go_live_payment(
  _ecosystem_id uuid, _plan_id uuid, _payer_number text, _reference text,
  _months integer default 1, _amount_paid numeric default null, _proof_path text default null)
returns subscription_requests
language plpgsql security definer set search_path to 'public' as $$
declare _req public.subscription_requests; _plan public.subscription_plans; _eco public.ecosystems;
        _name text; _num_key text; _ref_key text; _dup text; _amount numeric(14,2); _purpose text;
begin
  if not (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _ecosystem_id)) then
    raise exception 'Only this shop admin can pay for its subscription';
  end if;
  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco.id is null then raise exception 'Shop not found'; end if;
  if _eco.shop_kind is distinct from 'subscription' then
    raise exception 'Legacy shops keep their existing subscription workflow';
  end if;
  if coalesce(_months, 1) < 1 or _months > 24 then raise exception 'Months must be between 1 and 24'; end if;

  select * into _plan from public.subscription_plans where id = _plan_id and active;
  if _plan.id is null then raise exception 'Choose an available plan'; end if;

  _num_key := public.normalize_ph_mobile(_payer_number);
  if _num_key is null or length(_num_key) <> 12 then
    raise exception 'Enter the GCash number you are paying from (09XXXXXXXXX)';
  end if;
  _ref_key := public.normalize_payment_reference(_reference);
  if _ref_key is null then raise exception 'A GCash reference number is required'; end if;
  if _proof_path is not null and split_part(_proof_path, '/', 1) <> _ecosystem_id::text then
    raise exception 'Proof of payment must belong to this shop';
  end if;

  _dup := public.go_live_reference_duplicate(_ref_key, null);
  if _dup is not null then
    raise exception 'That GCash reference was already used for another payment. Each reference can only be used once.';
  end if;

  if exists (select 1 from public.subscription_requests r
              where r.ecosystem_id = _ecosystem_id and r.status = 'pending') then
    raise exception 'A payment for this shop is already awaiting verification';
  end if;

  _amount := coalesce(_amount_paid, round(_plan.monthly_price * _months, 2));
  _purpose := case when coalesce(_eco.is_review, false) then 'go_live' else 'plan_change' end;
  select coalesce(full_name, 'Shop operator') into _name from public.profiles where id = auth.uid();

  insert into public.subscription_requests (
    ecosystem_id, requested_by, requested_by_name, plan_name, plan_price, billing_period,
    amount_due, amount_paid, currency, payment_reference, proof_path,
    months_purchased, monthly_rate, remainder_amount,
    purpose, plan_id, payer_number, payer_number_key, payer_reference_key, auto_state
  ) values (
    _ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'), _plan.name, _plan.monthly_price, 'monthly',
    round(_plan.monthly_price * _months, 2), _amount,
    coalesce((select currency from public.platform_settings where id = 1), 'PHP'),
    btrim(_reference), _proof_path, _months, _plan.monthly_price,
    greatest(0, _amount - round(_plan.monthly_price * _months, 2)),
    _purpose, _plan.id, btrim(_payer_number), _num_key, _ref_key, 'pending'
  ) returning * into _req;

  update public.ecosystems
     set subscription_state = 'awaiting_approval',
         payment_reference = btrim(_reference),
         submitted_at = now()
   where id = _ecosystem_id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_name,'Shop operator'),
          case when _purpose = 'go_live' then 'Submitted Go Live payment' else 'Submitted plan change payment' end,
          coalesce(_eco.name,'Shop'),
          jsonb_build_object('request_id', _req.id, 'plan', _plan.name, 'months', _months,
                             'amount', _amount, 'reference', btrim(_reference),
                             'payer_number_key', _num_key));

  perform public.reconcile_go_live_request(_req.id);
  select * into _req from public.subscription_requests where id = _req.id;
  return _req;
end $$;

create or replace function public.reconcile_go_live_payments(_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _id uuid; _res text; _checked int := 0; _activated int := 0;
        _since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days,30), 365)));
begin
  if auth.uid() is not null and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can run subscription payment reconciliation';
  end if;
  for _id in select id from public.subscription_requests
              where status = 'pending' and purpose in ('go_live','plan_change')
                and created_at >= _since order by created_at loop
    _res := public.reconcile_go_live_request(_id);
    _checked := _checked + 1;
    if _res = 'activated' then _activated := _activated + 1; end if;
  end loop;
  return jsonb_build_object('checked', _checked, 'activated', _activated, 'since', _since);
end $$;

create or replace function public.tg_listener_event_subscription_match()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _id uuid;
begin
  if new.outcome <> 'accepted' or new.consumed_cash_in_id is not null
     or new.consumed_subscription_request_id is not null or new.amount_php is null
     or new.sender_number_key is null then
    return null;
  end if;
  for _id in select r.id from public.subscription_requests r
              where r.status = 'pending' and r.purpose in ('go_live','plan_change')
                and r.payer_number_key = new.sender_number_key
              order by r.created_at loop
    perform public.reconcile_go_live_request(_id);
  end loop;
  return null;
end $$;

drop trigger if exists listener_events_subscription_match on public.listener_events;
create trigger listener_events_subscription_match
  after insert on public.listener_events
  for each row execute function public.tg_listener_event_subscription_match();

create or replace function public.superadmin_set_shop_plan(
  _ecosystem_id uuid, _plan_id uuid, _months integer default 1,
  _discount_percent numeric default 0, _reason text default null)
returns shop_subscriptions
language plpgsql security definer set search_path to 'public' as $$
declare _sub public.shop_subscriptions; _plan public.subscription_plans;
        _amount numeric(14,2); _eco text; _me text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can override a subscription';
  end if;
  if coalesce(_discount_percent,0) < 0 or coalesce(_discount_percent,0) > 100 then
    raise exception 'Discount must be between 0 and 100 percent';
  end if;
  select * into _plan from public.subscription_plans where id = _plan_id and active;
  if _plan.id is null then raise exception 'Choose an available plan'; end if;
  if not public.is_new_generation_shop(_ecosystem_id) then
    raise exception 'Legacy shops keep their existing subscription handling';
  end if;

  _amount := round(_plan.monthly_price * coalesce(_months,1) * (100 - coalesce(_discount_percent,0)) / 100.0, 2);
  _sub := public.apply_subscription_plan(
    _ecosystem_id, _plan_id, _months, _amount, null,
    'PLATFORM_OVERRIDE — ' || _plan.name || ' at ' || coalesce(_discount_percent,0) || '% discount'
      || coalesce(' — ' || nullif(btrim(_reason),''), ''));

  select name into _eco from public.ecosystems where id = _ecosystem_id;
  select coalesce(full_name,'Platform owner') into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), _me, 'Platform owner set shop subscription plan', coalesce(_eco,'Shop'),
          jsonb_build_object('plan', _plan.name, 'months', _months,
                             'discount_percent', coalesce(_discount_percent,0),
                             'amount_charged', _amount, 'free', _amount = 0, 'reason', _reason));
  return _sub;
end $$;

revoke all on function public.submit_go_live_payment(uuid, uuid, text, text, integer, numeric, text) from public, anon;
revoke all on function public.reconcile_go_live_request(uuid) from public, anon;
revoke all on function public.activate_go_live_request(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_go_live_payments(integer) from public, anon;
revoke all on function public.superadmin_set_shop_plan(uuid, uuid, integer, numeric, text) from public, anon;
revoke all on function public.go_live_reference_duplicate(text, uuid) from public, anon;
grant execute on function public.submit_go_live_payment(uuid, uuid, text, text, integer, numeric, text) to authenticated;
grant execute on function public.reconcile_go_live_request(uuid) to authenticated;
grant execute on function public.reconcile_go_live_payments(integer) to authenticated;
grant execute on function public.superadmin_set_shop_plan(uuid, uuid, integer, numeric, text) to authenticated;
grant execute on function public.go_live_reference_duplicate(text, uuid) to authenticated;
grant execute on function public.activate_go_live_request(uuid) to service_role;