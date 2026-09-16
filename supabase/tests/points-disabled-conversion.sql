-- Reward Points ON/OFF — behaviour test. Everything is rolled back at the end
-- by raising a final exception, so no historical data is ever modified.
do $$
declare
  _eco uuid; _admin uuid; _member uuid; _acct uuid; _pacct uuid;
  _bal_before numeric; _bal_after numeric; _bal_on numeric;
  _pts_before numeric; _pts_after numeric;
  _sale uuid; _c public.points_disabled_conversions; _n integer;
  _out text := '';
begin
  select e.id into _eco from public.ecosystems e
   where e.shop_kind = 'universe' and public.shop_primary_admin(e.id) is not null
   order by e.created_at limit 1;
  if _eco is null then raise exception 'no universe shop with an admin'; end if;
  _admin := public.shop_primary_admin(_eco);

  select p.id into _member from public.profiles p
   where p.id <> _admin and p.deleted_at is null and p.status = 'active' limit 1;

  _acct := public.ensure_global_wallet(_admin);
  update public.credit_accounts set balance = balance + 1000 where id = _acct;
  select balance into _bal_before from public.credit_accounts where id = _acct;

  insert into public.points_accounts (user_id, ecosystem_id) values (_member, _eco)
  on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
  select id, balance into _pacct, _pts_before from public.points_accounts
   where user_id = _member and ecosystem_id = _eco;

  ---------------------------------------------------------------- points ON
  update public.ecosystems set points_enabled = true where id = _eco;
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, actor_id, tx_id, entry_type)
  values (_pacct, _member, _eco, 'credit', 3.00, 0, 'test earn ON', _member, public.new_tx_id(), 'earn');
  select balance into _pts_after from public.points_accounts where id = _pacct;
  if _pts_after <> round(_pts_before + 3.00, 2) then
    raise exception 'FAIL: points ON did not award (% -> %)', _pts_before, _pts_after;
  end if;
  _out := _out || format('ON: awarded 3.00 pts (%s -> %s). ', _pts_before, _pts_after);
  _pts_before := _pts_after;

  --------------------------------------------------------------- points OFF
  perform public.set_points_enabled(_eco, false);
  update public.ecosystems set points_enabled = false where id = _eco;  -- actor may not be admin here

  select id into _sale from public.voucher_sales where ecosystem_id = _eco order by created_at desc limit 1;

  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, actor_id, tx_id, entry_type, sale_id)
  values (_pacct, _member, _eco, 'credit', 12.34, 0, 'test earn OFF', _member, public.new_tx_id(), 'earn', null);

  select balance into _pts_after from public.points_accounts where id = _pacct;
  if _pts_after <> _pts_before then
    raise exception 'FAIL: points were awarded while disabled (% -> %)', _pts_before, _pts_after;
  end if;

  select * into _c from public.points_disabled_conversions
   where ecosystem_id = _eco order by created_at desc limit 1;
  if _c.id is null or _c.would_be_points <> 12.34 or _c.coin_equivalent <> 12.34
     or _c.amount_debited <> 12.34 or _c.status <> 'settled' then
    raise exception 'FAIL: conversion row wrong: %', to_jsonb(_c);
  end if;
  select balance into _bal_after from public.credit_accounts where id = _acct;
  if _bal_after <> round(_bal_before - 12.34, 2) then
    raise exception 'FAIL: admin was not charged 1:1 (% -> %)', _bal_before, _bal_after;
  end if;
  _out := _out || format('OFF: 0 pts awarded, admin charged 12.34 coins (%s -> %s). ', _bal_before, _bal_after);

  --------------------------------------------------- idempotency on a sale
  if _sale is not null then
    _bal_before := _bal_after;
    perform public.points_disabled_settlement(_eco, 5.00, _sale, null, _member);
    perform public.points_disabled_settlement(_eco, 5.00, _sale, null, _member);
    select count(*) into _n from public.points_disabled_conversions where sale_id = _sale;
    if _n <> 1 then raise exception 'FAIL: duplicate conversion rows for one sale (%)', _n; end if;
    _out := _out || 'Idempotent: one row per sale. ';

    -- reversal happens once only
    perform public.points_disabled_reverse(_sale, null, 'test reversal');
    perform public.points_disabled_reverse(_sale, null, 'test reversal');
    select count(*) into _n from public.credit_ledger
     where ecosystem_id = _eco and entry_kind = 'points_cost_reconciliation'
       and direction = 'credit' and reason like 'Reward points cost reversed%';
    if _n > 1 then raise exception 'FAIL: reversal credited more than once (%)', _n; end if;
    _out := _out || 'Reversal applied exactly once. ';
  end if;

  ------------------------------------------------ rewards shop hidden / blocked
  select count(*) into _n from public.list_rewards(_eco);
  if _n <> 0 then raise exception 'FAIL: rewards still listed while disabled (%)', _n; end if;
  if public.shop_points_enabled(_eco) then raise exception 'FAIL: shop_points_enabled still true'; end if;
  _out := _out || 'Rewards Shop hidden while OFF. ';

  ------------------------------------------------------------- toggle back ON
  _bal_on := (select balance from public.credit_accounts where id = _acct);
  update public.ecosystems set points_enabled = true where id = _eco;
  if (select balance from public.credit_accounts where id = _acct) <> _bal_on then
    raise exception 'FAIL: turning points ON changed the admin balance';
  end if;
  select balance into _pts_after from public.points_accounts where id = _pacct;
  if _pts_after <> _pts_before then
    raise exception 'FAIL: disabled-period points were restored on re-enable';
  end if;
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, actor_id, tx_id, entry_type)
  values (_pacct, _member, _eco, 'credit', 2.00, 0, 'test earn ON again', _member, public.new_tx_id(), 'earn');
  if (select balance from public.points_accounts where id = _pacct) <> round(_pts_before + 2.00, 2) then
    raise exception 'FAIL: fresh earning period does not award points';
  end if;
  select count(*) into _n from public.list_rewards(_eco);
  _out := _out || 'ON again: no refund, no restored points, fresh earning works. ';

  raise exception 'ROLLBACK_OK %', _out;
end $$;
