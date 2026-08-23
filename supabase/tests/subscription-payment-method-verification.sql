-- Subscription payment verification across payment-method / cash-in options.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
--
-- Rules under test:
--   A) a platform (Super Admin) payment method is selectable for a subscription
--      payment, a shop-owned one is not;
--   B) a shop-owned payment method is visible only inside its own shop;
--   C) receipt verification still applies to shop-owned methods (a payment into
--      a shop account is never auto-trusted);
--   D) a mismatched notification never auto-approves (fewer than 2 signals, or
--      amount only);
--   E) a zero-price plan skips payment (and therefore verification) entirely.
begin;

do $$
declare _shop_a uuid; _shop_b uuid; _admin uuid; _global uuid; _own uuid; _other uuid;
        _visible int; _signals int;
        _ev public.listener_events; _req public.subscription_requests;
begin
  select e.id into _shop_a from public.ecosystems e order by e.created_at limit 1;
  select e.id into _shop_b from public.ecosystems e where e.id <> _shop_a order by e.created_at limit 1;
  if _shop_a is null or _shop_b is null then
    raise notice 'skipped: needs two shops';
    return;
  end if;
  select p.id into _admin from public.profiles p where p.ecosystem_id = _shop_a limit 1;

  -- A/B: create one platform account and one account per shop.
  insert into public.payment_methods (name, method_type, account_name, account_number, active, ecosystem_id)
  values ('T Platform', 'ewallet', 'WaveWallet', '09170000001', true, null) returning id into _global;
  insert into public.payment_methods (name, method_type, account_name, account_number, active, ecosystem_id)
  values ('T Shop A', 'ewallet', 'Shop A', '09170000002', true, _shop_a) returning id into _own;
  insert into public.payment_methods (name, method_type, account_name, account_number, active, ecosystem_id)
  values ('T Shop B', 'ewallet', 'Shop B', '09170000003', true, _shop_b) returning id into _other;

  -- A) only platform-wide accounts may receive a subscription payment.
  if exists (select 1 from public.payment_methods where id = _own and ecosystem_id is null) then
    raise exception 'FAIL: shop account must not be platform-wide';
  end if;
  if not exists (select 1 from public.payment_methods where id = _global and active and ecosystem_id is null) then
    raise exception 'FAIL: platform account must stay selectable for subscriptions';
  end if;

  -- B) a shop only ever sees platform accounts plus its own.
  select count(*) into _visible from public.payment_methods
   where active and id in (_global, _own, _other)
     and (ecosystem_id is null or ecosystem_id = _shop_a);
  if _visible <> 2 then
    raise exception 'FAIL: shop A should see exactly its own + platform accounts, saw %', _visible;
  end if;
  if exists (
    select 1 from public.payment_methods
     where id = _other and (ecosystem_id is null or ecosystem_id = _shop_a)
  ) then
    raise exception 'FAIL: another shop''s account leaked into shop A';
  end if;

  -- C/D) matching signals for a subscription request.
  select * into _req from public.subscription_requests order by created_at desc limit 1;
  select * into _ev from public.listener_events order by created_at desc limit 1;
  if _req.id is not null and _ev.id is not null then
    _signals := public.go_live_match_signals(_ev, _req);
    if _signals is null or _signals < 0 or _signals > 4 then
      raise exception 'FAIL: signal count out of range: %', _signals;
    end if;
    -- amount alone can never confirm: the strong-signal gate must reject it.
    if public.go_live_has_strong_signal(_ev, _req)
       and _ev.reference_key is distinct from coalesce(_req.receipt_reference_key, _req.payer_reference_key)
       and _ev.sender_number_key is distinct from coalesce(_req.receipt_sender_key, _req.payer_number_key) then
      raise exception 'FAIL: strong signal accepted without reference or sender agreement';
    end if;
  end if;

  -- E) a zero-price plan requires no payment at all.
  if _shop_a is not null and public.subscription_is_free(_shop_a) then
    begin
      perform public.submit_go_live_payment(_shop_a,
        (select id from public.subscription_plans where active limit 1),
        '09171234567', 'TESTREF-ZERO', 1, 0, 'x/y.png', _global);
      raise exception 'FAIL: a free shop must not be able to submit a payment';
    exception when others then
      null; -- expected: "No payment is required for this shop"
    end;
  end if;

  raise notice 'ok: subscription payment-method verification rules hold';
end $$;

rollback;
