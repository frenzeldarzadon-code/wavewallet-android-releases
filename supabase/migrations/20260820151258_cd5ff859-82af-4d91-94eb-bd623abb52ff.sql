-- The subscription allocation is minted by the platform itself. When a Go Live
-- payment is verified by the GCash listener there is no signed-in platform
-- owner, so superadmin_issue_credits accepts a transaction-local flag that only
-- apply_subscription_plan sets. Every other caller still needs is_super_admin.
create or replace function public.superadmin_issue_credits(_user_id uuid, _amount numeric, _reason text, _category text DEFAULT NULL::text, _reference text DEFAULT NULL::text, _request_key text DEFAULT NULL::text, _ecosystem_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _eco uuid; _eco_name text; _acct uuid; _tx text; _key text;
  _actor text; _target text; _role app_role;
  _before numeric(14,2); _after numeric(14,2); _ledger uuid; _existing text;
begin
  if not (public.is_super_admin(auth.uid())
          or coalesce(current_setting('wavewallet.subscription_allocation', true), '') = 'on') then
    raise exception 'Only the platform owner can issue credits';
  end if;
  if _amount is null or _amount <= 0 then
    raise exception 'Enter how many credits to issue';
  end if;
  if _amount <> trunc(_amount) then
    raise exception 'Credits must be a whole number';
  end if;
  if _amount > 10000000 then
    raise exception 'A single issuance is limited to 10,000,000 credits';
  end if;
  if coalesce(trim(_reason),'') = '' then
    raise exception 'A reason is required';
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);

  select tx_id into _existing from public.platform_credit_issuances where request_key = _key;
  if _existing is not null then
    return _existing;
  end if;

  select p.full_name || ' — ' || p.email into _target
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _target is null then raise exception 'Member not found'; end if;

  if public.is_super_admin(_user_id) then
    _eco := null;
  else
    _eco := coalesce(_ecosystem_id, public.active_ecosystem(_user_id));
    if _eco is null then raise exception 'Choose the shop whose wallet receives the credits'; end if;
    if not exists (select 1 from public.ecosystem_memberships m
                    where m.user_id = _user_id and m.ecosystem_id = _eco
                      and m.membership_state = 'active') then
      raise exception 'That member is not an approved member of the selected shop';
    end if;
  end if;

  select name into _eco_name from public.ecosystems where id = _eco;
  _role := public.membership_role(_user_id, _eco);

  if _eco is null then
    _acct := public.ensure_global_wallet(_user_id);
  else
    _acct := public.ensure_credit_account(_user_id, _eco);
  end if;
  select balance into _before from public.credit_accounts where id = _acct;

  _tx := public.new_tx_id();

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, 'credit', _amount, 0, trim(_reason),
          nullif(trim(_reference),''), auth.uid(), _tx, 'superadmin_credit_issuance',
          _amount, 0, 0)
  returning id, balance_after into _ledger, _after;

  select full_name into _actor from public.profiles where id = auth.uid();

  insert into public.platform_credit_issuances (
    tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name,
    recipient_role, ecosystem_id, ecosystem_name, amount, balance_before, balance_after,
    reason, category, reference, ledger_id)
  values (_tx, _key, auth.uid(), coalesce(_actor,'WaveWallet platform'), _user_id, _target,
          _role, _eco, _eco_name, _amount, _before, _after,
          trim(_reason), nullif(trim(_category),''), nullif(trim(_reference),''), _ledger);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'WaveWallet platform'),
          'Issued platform credits', _target,
          jsonb_build_object('amount', _amount, 'reason', trim(_reason),
                             'category', nullif(trim(_category),''), 'reference', nullif(trim(_reference),''),
                             'ecosystem_id', _eco, 'shop', _eco_name, 'recipient_id', _user_id,
                             'balance_before', _before, 'balance_after', _after,
                             'operator_id', auth.uid(), 'action_type', 'manual_credit',
                             'entry_kind', 'superadmin_credit_issuance', 'tx_id', _tx));
  return _tx;
end; $function$;

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
    perform set_config('wavewallet.subscription_allocation', 'on', true);
    _tx := public.superadmin_issue_credits(
      _admin, _add,
      'Subscription cashflow allocation — ' || _plan.name,
      'Subscription allocation',
      nullif(trim(_reference),''), null, _ecosystem_id);
    perform set_config('wavewallet.subscription_allocation', 'off', true);
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
     coalesce(_me,'WaveWallet platform'),
     coalesce(_notes, 'SUBSCRIPTION_PAYMENT — not a cash in, not a coin transfer'));

  return _sub;
end $$;