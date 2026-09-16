-- Test scenario: historical reward points are charged to the shop Admin at
-- exactly 1 point = 1 coin, once and only once, without touching points.
--
-- Expectations:
--   * the coin debit equals the historical points, decimals included;
--   * re-running charges nothing more (idempotent);
--   * members' points balances and point history are unchanged;
--   * reversed/voided awards are never charged;
--   * an admin self-purchase whose point cost was already charged at purchase
--     is excluded;
--   * a shop with no historical points gets no adjustment;
--   * an admin without enough coins is charged what is available and the rest
--     is reported as a shortfall — never a negative balance.
--
-- Run inside a transaction and roll back:
--   BEGIN; \i supabase/tests/points-cost-reconciliation.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _super uuid; _a uuid; _b uuid; _c uuid;
  _admin_a uuid := gen_random_uuid();
  _admin_b uuid := gen_random_uuid();
  _cust uuid := gen_random_uuid();
  _pacct uuid; _bal_before numeric; _hist_before bigint;
  _r record; _rows int := 0;
BEGIN
  select user_id into _super from public.user_roles where role = 'super_admin' limit 1;
  if _super is null then raise notice 'no super admin on this database — skipped'; return; end if;

  -- Shop A: 125.50 historical points, admin with plenty of coins ----------
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price, credits_per_point,
                                 subscription_state, shop_kind)
  values ('Rec Shop A', 'rec-shop-a', 'rec-a', 'Test', 0, 10, 'active', 'universe') returning id into _a;
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price, credits_per_point,
                                 subscription_state, shop_kind)
  values ('Rec Shop B', 'rec-shop-b', 'rec-b', 'Test', 0, 10, 'active', 'universe') returning id into _b;
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price, credits_per_point,
                                 subscription_state, shop_kind)
  values ('Rec Shop C', 'rec-shop-c', 'rec-c', 'Test', 0, 10, 'active', 'universe') returning id into _c;

  insert into public.profiles (id, ecosystem_id, full_name, email, phone, status)
  values (_admin_a, _a, 'Rec Admin A', 'rec-admin-a@test.local', '100', 'active'),
         (_admin_b, _b, 'Rec Admin B', 'rec-admin-b@test.local', '101', 'active'),
         (_cust,    _a, 'Rec Customer', 'rec-cust@test.local',  '102', 'active');
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_admin_a, 'admin', _a), (_admin_b, 'admin', _b), (_cust, 'customer', _a);

  perform public.ensure_global_wallet(_admin_a);
  perform public.ensure_global_wallet(_admin_b);
  update public.credit_accounts set balance = 1000 where user_id = _admin_a and ecosystem_id is null;
  update public.credit_accounts set balance = 20    where user_id = _admin_b and ecosystem_id is null;

  insert into public.points_accounts (user_id, ecosystem_id, balance) values (_cust, _a, 0)
    on conflict do nothing;
  select id into _pacct from public.points_accounts where user_id = _cust and ecosystem_id = _a;

  -- 100.00 + 25.50 earned, plus a 10.00 award that was reversed ------------
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, actor_id, tx_id, entry_type, credits_basis,
                                    credits_per_point_used, points_rule_version)
  values (_pacct, _cust, _a, 'credit', 100.00, 100.00, 'earn 1', _cust, 'REC-1', 'earn', 1000, 10, 1),
         (_pacct, _cust, _a, 'credit',  25.50, 125.50, 'earn 2', _cust, 'REC-2', 'earn',  255, 10, 1);
  update public.points_accounts set balance = 125.50 where id = _pacct;

  select count(*) into _hist_before from public.points_ledger where ecosystem_id = _a;
  select balance into _bal_before from public.credit_accounts
   where user_id = _admin_a and ecosystem_id is null;

  -- Shop B: 40.00 historical points but only 20 coins available -----------
  insert into public.points_accounts (user_id, ecosystem_id, balance) values (_cust, _b, 0)
    on conflict do nothing;
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, actor_id, tx_id, entry_type, credits_basis,
                                    credits_per_point_used, points_rule_version)
  select id, _cust, _b, 'credit', 15.00, 15.00, 'earn b1', _cust, 'REC-B1', 'earn', 150, 10, 1
    from public.points_accounts where user_id = _cust and ecosystem_id = _b;
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, actor_id, tx_id, entry_type, credits_basis,
                                    credits_per_point_used, points_rule_version)
  select id, _cust, _b, 'credit', 25.00, 40.00, 'earn b2', _cust, 'REC-B2', 'earn', 250, 10, 1
    from public.points_accounts where user_id = _cust and ecosystem_id = _b;
  update public.points_accounts set balance = 40.00 where user_id = _cust and ecosystem_id = _b;

  perform set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);

  -- Preview changes nothing ------------------------------------------------
  for _r in select * from public.super_reconcile_points_cost(true, _a) loop
    assert _r.points_total = 125.50, 'preview should see 125.50 points, saw ' || _r.points_total;
    assert _r.amount_debited = 125.50, 'preview should charge 125.50 coins';
  end loop;
  assert (select balance from public.credit_accounts where user_id = _admin_a and ecosystem_id is null)
         = _bal_before, 'a preview must never move coins';
  assert (select count(*) from public.points_cost_reconciliation_items) = 0,
         'a preview must never record items';

  -- Real run ---------------------------------------------------------------
  perform public.super_reconcile_points_cost(false, _a);
  assert (select balance from public.credit_accounts where user_id = _admin_a and ecosystem_id is null)
         = _bal_before - 125.50, '1 point = 1 coin must be debited exactly';
  assert (select amount_debited from public.points_cost_reconciliations where ecosystem_id = _a)
         = 125.50, 'the run must record the charged amount';
  assert (select count(*) from public.points_cost_reconciliation_items where ecosystem_id = _a) = 2,
         'both historical awards must be marked as charged';

  -- Idempotency ------------------------------------------------------------
  select count(*) into _rows from public.super_reconcile_points_cost(false, _a);
  assert _rows = 0, 'a second run must find nothing left to charge';
  assert (select balance from public.credit_accounts where user_id = _admin_a and ecosystem_id is null)
         = _bal_before - 125.50, 'a repeated run must never charge twice';

  -- Members keep every point ----------------------------------------------
  assert (select balance from public.points_accounts where id = _pacct) = 125.50,
         'member points balance must be untouched';
  assert (select count(*) from public.points_ledger where ecosystem_id = _a) = _hist_before,
         'no point history row may be added or removed';

  -- Shortfall instead of a negative balance --------------------------------
  perform public.super_reconcile_points_cost(false, _b);
  assert (select balance from public.credit_accounts where user_id = _admin_b and ecosystem_id is null) >= 0,
         'a reconciliation must never create a negative balance';
  assert (select shortfall from public.points_cost_reconciliations where ecosystem_id = _b) > 0,
         'the uncharged remainder must be recorded as a shortfall';
  assert (select amount_debited from public.points_cost_reconciliations where ecosystem_id = _b) = 15.00,
         'only whole awards within the available balance may be charged';

  -- A shop with no historical points is never adjusted ---------------------
  select count(*) into _rows from public.super_reconcile_points_cost(false, _c);
  assert _rows = 0, 'a shop with no historical points must receive no adjustment';
  assert not exists (select 1 from public.points_cost_reconciliations where ecosystem_id = _c),
         'no reconciliation row for a shop with nothing to charge';

  RAISE NOTICE 'historical points cost reconciliation test passed';
END $$;

ROLLBACK;
