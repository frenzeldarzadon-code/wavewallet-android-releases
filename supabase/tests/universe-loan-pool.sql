-- Universe Loan Pool: contribution, partial funding, automatic release on full
-- funding, unrestricted released coins, repayment distribution, reducing-balance
-- interest and the early-payoff interest adjustment.
-- Runs inside a transaction that is rolled back: nothing here is kept.
begin;

do $$
declare
  v_borrower uuid := gen_random_uuid();
  v_f1 uuid := gen_random_uuid();
  v_f2 uuid := gen_random_uuid();
  v_f3 uuid := gen_random_uuid();
  v_loan uuid;
  v_path text;
  v_msg text;
  v_bal numeric;
  v_restricted numeric;
  v_status text;
  v_int numeric;
  v_paid numeric;
  v_owner numeric;
  v_share numeric;
  v_avail numeric;
  v_alloc numeric;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, aud, role)
  values (v_borrower, 'ulp-borrower@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
         (v_f1, 'ulp-f1@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
         (v_f2, 'ulp-f2@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
         (v_f3, 'ulp-f3@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated');

  -- Fund the three contributors' Universe wallets.
  perform public.ensure_global_wallet(v_f1);
  perform public.ensure_global_wallet(v_f2);
  perform public.ensure_global_wallet(v_f3);
  perform public.ensure_global_wallet(v_borrower);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, reason, entry_kind, actor_id)
  select id, user_id, null, 'credit', 6000, 'test seed', 'general', user_id
    from public.credit_accounts where user_id in (v_f1, v_f2, v_f3, v_borrower) and ecosystem_id is null;

  -- 1. Contributions land in the pool and leave the wallet.
  perform set_config('request.jwt.claims', json_build_object('sub', v_f1, 'role', 'authenticated')::text, true);
  perform public.loan_pool_contribute(4000);
  perform set_config('request.jwt.claims', json_build_object('sub', v_f2, 'role', 'authenticated')::text, true);
  perform public.loan_pool_contribute(3000);
  perform set_config('request.jwt.claims', json_build_object('sub', v_f3, 'role', 'authenticated')::text, true);
  perform public.loan_pool_contribute(3000);

  select available into v_avail from public.loan_pool_accounts where user_id = v_f1;
  select balance into v_bal from public.credit_accounts where user_id = v_f1 and ecosystem_id is null;
  if v_avail <> 4000 or v_bal <> 2000 then
    raise exception 'FAIL: contribution did not move coins (available %, wallet %)', v_avail, v_bal;
  end if;
  raise notice 'PASS contribution moves coins into the pool';

  -- 2. Application requires a valid ID and a supported term.
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower, 'role', 'authenticated')::text, true);
  begin
    perform public.apply_universe_loan(10000, 6, null);
    raise exception 'FAIL: applied without an ID';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    raise notice 'PASS no ID refused: %', v_msg;
  end;

  v_path := v_borrower::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('loan-ids', v_path, v_borrower, '{}');

  begin
    perform public.apply_universe_loan(10000, 5, v_path);
    raise exception 'FAIL: accepted an unsupported term';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    raise notice 'PASS unsupported term refused: %', v_msg;
  end;

  v_loan := public.apply_universe_loan(10000, 6, v_path, 'tok-1');
  if v_loan <> public.apply_universe_loan(10000, 6, v_path, 'tok-1') then
    raise exception 'FAIL: the same application token created two loans';
  end if;
  raise notice 'PASS application is idempotent on its token';

  -- 3. Partial funding never releases.
  perform set_config('request.jwt.claims', json_build_object('sub', v_f1, 'role', 'authenticated')::text, true);
  perform public.fund_universe_loan(v_loan, 4000);
  perform set_config('request.jwt.claims', json_build_object('sub', v_f2, 'role', 'authenticated')::text, true);
  perform public.fund_universe_loan(v_loan, 3000);

  select status into v_status from public.universe_loans where id = v_loan;
  select balance into v_bal from public.credit_accounts where user_id = v_borrower and ecosystem_id is null;
  if v_status <> 'partially_funded' or v_bal <> 6000 then
    raise exception 'FAIL: a partially funded loan released (status %, wallet %)', v_status, v_bal;
  end if;
  select available, allocated into v_avail, v_alloc from public.loan_pool_accounts where user_id = v_f1;
  if v_avail <> 0 or v_alloc <> 4000 then
    raise exception 'FAIL: funds were not reserved (available %, allocated %)', v_avail, v_alloc;
  end if;
  raise notice 'PASS partial funding reserves funds and does not release';

  -- A funder cannot commit more than their available pool funds.
  perform set_config('request.jwt.claims', json_build_object('sub', v_f1, 'role', 'authenticated')::text, true);
  begin
    perform public.fund_universe_loan(v_loan, 1000);
    raise exception 'FAIL: funded beyond available pool funds';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    raise notice 'PASS over-allocation refused: %', v_msg;
  end;

  -- 4. The final contribution releases the loan automatically.
  perform set_config('request.jwt.claims', json_build_object('sub', v_f3, 'role', 'authenticated')::text, true);
  perform public.fund_universe_loan(v_loan, 3000);

  select status into v_status from public.universe_loans where id = v_loan;
  select balance, restricted_balance into v_bal, v_restricted
    from public.credit_accounts where user_id = v_borrower and ecosystem_id is null;
  if v_status <> 'active' or v_bal <> 15800 or v_restricted <> 0 then
    raise exception 'FAIL: release wrong (status %, wallet %, restricted %)', v_status, v_bal, v_restricted;
  end if;
  raise notice 'PASS full funding releases 9800 unrestricted coins after the 2%% fee';

  if (select count(*) from public.universe_loan_schedule where loan_id = v_loan) <> 6 then
    raise exception 'FAIL: no six-month schedule was generated';
  end if;
  if (select amount from public.universe_loan_earnings
       where loan_id = v_loan and kind = 'platform_fee') <> 200 then
    raise exception 'FAIL: the platform fee was not recorded';
  end if;
  raise notice 'PASS schedule and platform fee recorded';

  -- 5. One month of interest on the full principal.
  update public.universe_loans set last_accrual_at = now() - interval '30 days' where id = v_loan;
  perform public.accrue_universe_loan(v_loan);
  select interest_accrued into v_int from public.universe_loans where id = v_loan;
  if round(v_int, 2) <> 200 then
    raise exception 'FAIL: one month of interest should be 200, got %', v_int;
  end if;
  raise notice 'PASS reducing-balance interest accrued 200 for month one';

  -- 6. A payment settles interest first, then principal, and pays the funders.
  perform set_config('request.jwt.claims', json_build_object('sub', v_borrower, 'role', 'authenticated')::text, true);
  perform public.pay_universe_loan(5200);
  select principal_outstanding, interest_paid into v_bal, v_paid
    from public.universe_loans where id = v_loan;
  if round(v_paid,2) <> 200 or round(v_bal,2) <> 5000 then
    raise exception 'FAIL: payment split wrong (interest %, principal left %)', v_paid, v_bal;
  end if;

  select coalesce(sum(amount),0) into v_owner from public.universe_loan_earnings
   where loan_id = v_loan and kind like 'owner_interest%';
  if round(v_owner,2) <> 100 then
    raise exception 'FAIL: the owner interest share should be 100, got %', v_owner;
  end if;
  select interest_earned into v_share from public.universe_loan_fundings
   where loan_id = v_loan and funder_id = v_f1;
  if round(v_share,2) <> 40 then
    raise exception 'FAIL: the 4000 funder should earn 40 of the 100 contributor share, got %', v_share;
  end if;
  select available into v_avail from public.loan_pool_accounts where user_id = v_f1;
  if round(v_avail,2) <> 2040 then
    raise exception 'FAIL: the funder should have 2000 principal + 40 interest back, got %', v_avail;
  end if;
  raise notice 'PASS interest split 50/50 and principal returned pro rata';

  -- 7. Paying the rest immediately costs no further interest: the remaining
  --    principal was outstanding for no extra time.
  perform public.pay_universe_loan(999999);
  select status, principal_outstanding, interest_paid into v_status, v_bal, v_paid
    from public.universe_loans where id = v_loan;
  if v_status <> 'early_paid' or round(v_bal,2) <> 0 then
    raise exception 'FAIL: early payoff wrong (status %, principal %)', v_status, v_bal;
  end if;
  if round(v_paid,2) <> 200 then
    raise exception 'FAIL: early payoff charged interest for months not used (%)', v_paid;
  end if;
  raise notice 'PASS early payoff charges no future interest';

  -- 8. Changing the settings afterwards never touches an existing loan.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select user_id from public.user_roles where role = 'super_admin' limit 1),
                      'role', 'authenticated')::text, true);
  perform public.set_universe_loan_settings(true, 5, 25, 75, 4);
  select interest_percent, platform_fee_percent into v_int, v_share
    from public.universe_loans where id = v_loan;
  if round(v_int,2) <> 2 or round(v_share,2) <> 2 then
    raise exception 'FAIL: a settings change rewrote an existing loan (% / %)', v_int, v_share;
  end if;
  raise notice 'PASS settings changes only apply to future loans';

  -- 9. Shares must total 100.
  begin
    perform public.set_universe_loan_settings(true, 5, 30, 50, 4);
    raise exception 'FAIL: accepted shares that do not total 100';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    raise notice 'PASS share split must total 100: %', v_msg;
  end;

  raise notice 'ALL UNIVERSE LOAN POOL CHECKS PASSED';
end $$;

rollback;
