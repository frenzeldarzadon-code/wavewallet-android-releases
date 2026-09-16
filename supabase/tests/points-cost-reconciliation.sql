-- Test scenario: reward points members already earned are charged to the shop
-- Admin at exactly 1 point = 1 coin, once and only once, without ever touching
-- the points themselves.
--
-- Expectations:
--   * a preview changes nothing at all;
--   * the coin debit equals the historical points, decimals included;
--   * re-running charges nothing more (idempotent);
--   * members' points balances and point history are unchanged;
--   * an admin without enough coins is charged only the awards that fit and the
--     remainder is recorded as a shortfall — never a negative balance;
--   * a shop with no historical points receives no adjustment.
--
-- Run inside a transaction and roll back so no test data is persisted:
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
  if _super is null then raise notice 'no platform owner on this database — skipped'; return; end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (_admin_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rec-admin-a@test.local','x',now(),now()),
         (_admin_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rec-admin-b@test.local','x',now(),now()),
         (_cust,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','rec-cust@test.local','x',now(),now());

  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price, credits_per_point, subscription_state, shop_kind)
  values ('Rec Shop A', 'rec-shop-a', 'rec-a', 'Test', 0, 10, 'active', 'universe') returning id into _a;
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price, credits_per_point, subscription_state, shop_kind)
  values ('Rec Shop B', 'rec-shop-b', 'rec-b', 'Test', 0, 10, 'active', 'universe') returning id into _b;
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price, credits_per_point, subscription_state, shop_kind)
  values ('Rec Shop C', 'rec-shop-c', 'rec-c', 'Test', 0, 10, 'active', 'universe') returning id into _c;

  insert into public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state)
  values (_admin_a, _a, 'admin', 'active'), (_admin_b, _b, 'admin', 'active'),
         (_cust, _a, 'customer', 'active'), (_cust, _b, 'customer', 'active') on conflict do nothing;
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_admin_a, 'admin', _a), (_admin_b, 'admin', _b), (_cust, 'customer', _a) on conflict do nothing;

  update public.profiles set ecosystem_id=_a, full_name='Rec Admin A', status='active' where id=_admin_a;
  update public.profiles set ecosystem_id=_b, full_name='Rec Admin B', status='active' where id=_admin_b;
  update public.profiles set ecosystem_id=_a, full_name='Rec Customer', status='active' where id=_cust;

  perform public.ensure_global_wallet(_admin_a);
  perform public.ensure_global_wallet(_admin_b);
  update public.credit_accounts set balance = 1000 where user_id=_admin_a and ecosystem_id is null;
  update public.credit_accounts set balance = 20   where user_id=_admin_b and ecosystem_id is null;

  insert into public.points_accounts (user_id, ecosystem_id, balance) values (_cust,_a,0) on conflict do nothing;
  insert into public.points_accounts (user_id, ecosystem_id, balance) values (_cust,_b,0) on conflict do nothing;
  select id into _pacct from public.points_accounts where user_id=_cust and ecosystem_id=_a;

  -- Shop A: 100.00 + 25.50 earned --------------------------------------------
  insert into public.points_ledger (account_id,user_id,ecosystem_id,direction,amount,balance_after,reason,actor_id,tx_id,entry_type,credits_basis,credits_per_point_used,points_rule_version,created_at)
  values (_pacct,_cust,_a,'credit',100.00,100.00,'earn 1',_cust,'REC-1','earn',1000,10,1, now()-interval '3 days'),
         (_pacct,_cust,_a,'credit', 25.50,125.50,'earn 2',_cust,'REC-2','earn', 255,10,1, now()-interval '2 days');
  update public.points_accounts set balance = 125.50 where id=_pacct;

  -- Shop B: 15.00 + 25.00 earned, admin only holds 20 coins ------------------
  insert into public.points_ledger (account_id,user_id,ecosystem_id,direction,amount,balance_after,reason,actor_id,tx_id,entry_type,credits_basis,credits_per_point_used,points_rule_version,created_at)
  select id,_cust,_b,'credit',15.00,15.00,'earn b1',_cust,'REC-B1','earn',150,10,1, now()-interval '3 days'
    from public.points_accounts where user_id=_cust and ecosystem_id=_b;
  insert into public.points_ledger (account_id,user_id,ecosystem_id,direction,amount,balance_after,reason,actor_id,tx_id,entry_type,credits_basis,credits_per_point_used,points_rule_version,created_at)
  select id,_cust,_b,'credit',25.00,40.00,'earn b2',_cust,'REC-B2','earn',250,10,1, now()-interval '2 days'
    from public.points_accounts where user_id=_cust and ecosystem_id=_b;
  update public.points_accounts set balance = 40.00 where user_id=_cust and ecosystem_id=_b;

  select count(*) into _hist_before from public.points_ledger where ecosystem_id=_a;
  select balance into _bal_before from public.credit_accounts where user_id=_admin_a and ecosystem_id is null;

  perform set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);

  -- A preview changes nothing ------------------------------------------------
  for _r in select * from public.super_reconcile_points_cost(true,_a) loop
    assert _r.points_total = 125.50, 'preview points ' || _r.points_total;
    assert _r.amount_debited = 125.50, 'preview debit ' || _r.amount_debited;
  end loop;
  assert (select balance from public.credit_accounts where user_id=_admin_a and ecosystem_id is null)=_bal_before,'a preview must never move coins';
  assert (select count(*) from public.points_cost_reconciliation_items where ecosystem_id=_a)=0,'a preview must never record items';

  -- Real run: 1 point = 1 coin ----------------------------------------------
  perform public.super_reconcile_points_cost(false,_a);
  assert (select balance from public.credit_accounts where user_id=_admin_a and ecosystem_id is null)=_bal_before-125.50,'the debit must equal the points exactly';
  assert (select amount_debited from public.points_cost_reconciliations where ecosystem_id=_a)=125.50,'the run must record what was charged';
  assert (select count(*) from public.points_cost_reconciliation_items where ecosystem_id=_a)=2,'both awards must be marked as charged';

  -- Idempotency --------------------------------------------------------------
  select count(*) into _rows from public.super_reconcile_points_cost(false,_a);
  assert _rows=0,'a second run must find nothing left to charge';
  assert (select balance from public.credit_accounts where user_id=_admin_a and ecosystem_id is null)=_bal_before-125.50,'a repeated run must never charge twice';

  -- Members keep every point -------------------------------------------------
  assert (select balance from public.points_accounts where id=_pacct)=125.50,'member points balance must be untouched';
  assert (select count(*) from public.points_ledger where ecosystem_id=_a)=_hist_before,'no point history row may be added or removed';

  -- Shortfall instead of a negative balance ----------------------------------
  perform public.super_reconcile_points_cost(false,_b);
  assert (select balance from public.credit_accounts where user_id=_admin_b and ecosystem_id is null)>=0,'a reconciliation must never create a negative balance';
  assert (select amount_debited from public.points_cost_reconciliations where ecosystem_id=_b)=15.00,'only whole awards within the available balance may be charged';
  assert (select shortfall from public.points_cost_reconciliations where ecosystem_id=_b)=25.00,'the uncharged remainder must be recorded as a shortfall';

  -- Nothing to charge --------------------------------------------------------
  select count(*) into _rows from public.super_reconcile_points_cost(false,_c);
  assert _rows=0,'a shop with no historical points must receive no adjustment';

  RAISE NOTICE 'historical points cost reconciliation test passed';
END $$;

ROLLBACK;
