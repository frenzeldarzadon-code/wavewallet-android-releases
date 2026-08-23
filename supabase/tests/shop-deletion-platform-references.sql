-- Shop deletion must survive platform-level references to shop coin history.
--
-- platform_credit_issuances.ledger_id has a NO ACTION foreign key to
-- credit_ledger. Deleting a shop that received platform-issued Coins used to
-- fail on that reference. The correct behaviour: the platform issuance record
-- is PRESERVED (it is platform history, not shop data) and only its pointer to
-- the deleted shop ledger row is detached.
--
-- Also re-asserts the permanent eligibility rule: deletion stays blocked while
-- any member still holds Coins.
--
-- Runs inside a transaction that is ROLLED BACK.

begin;

do $$
declare
  _eco uuid;
  _admin uuid := gen_random_uuid();
  _cust uuid := gen_random_uuid();
  _acct uuid;
  _ledger uuid;
  _issuance uuid;
begin
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price)
  values ('FIXTURE Platform Ref Shop', 'fixture-platform-ref', 'tok-platref', 'Starter', 150)
  returning id into _eco;

  -- profile creation triggers wallet creation, which needs real auth users
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          'fixture-pr-admin@example.test','x', now(), now()),
         (_cust, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          'fixture-pr-cust@example.test','x', now(), now());
  insert into public.profiles (id, ecosystem_id, full_name, email, phone)
  values (_admin, _eco, 'FIXTURE Admin', 'fixture-pr-admin@example.test', '0'),
         (_cust, _eco, 'FIXTURE Customer', 'fixture-pr-cust@example.test', '0');
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_admin, 'admin', _eco), (_cust, 'customer', _eco);

  insert into public.credit_accounts (user_id, ecosystem_id, balance)
  values (_cust, _eco, 500)
  on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set balance = 500
  returning id into _acct;
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, entry_kind)
  values (_acct, _cust, _eco, 'credit', 500, 500, 'FIXTURE platform issue', 'credit_issue')
  returning id into _ledger;

  -- the platform-level record that used to block deletion
  insert into public.platform_credit_issuances
    (tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name, recipient_role,
     ecosystem_id, ecosystem_name, amount, balance_before, balance_after, reason, category, ledger_id)
  values (gen_random_uuid(), 'FIXTURE-KEY-' || gen_random_uuid()::text, _admin, 'FIXTURE Owner', _cust, 'FIXTURE Customer', 'customer',
          _eco, 'FIXTURE Platform Ref Shop', 500, 0, 500, 'FIXTURE issuance', 'platform_issue', _ledger)
  returning id into _issuance;

  -- 1. eligibility rule unchanged: a member still holds Coins -> blocked
  if (public.shop_deletion_check_unchecked(_eco)->>'can_delete')::boolean then
    raise exception 'FAIL: deletion allowed while a member holds Coins';
  end if;

  -- member returns / spends their Coins
  update public.credit_accounts set balance = 0 where ecosystem_id = _eco;
  if not (public.shop_deletion_check_unchecked(_eco)->>'can_delete')::boolean then
    raise exception 'FAIL: deletion still blocked with all member balances at zero';
  end if;

  -- 2. cleanup succeeds despite the platform reference
  perform public.purge_ecosystem_internal(_eco, _admin, 'Regression fixture', 'admin_self_delete',
                                          public.shop_deletion_check_unchecked(_eco));

  if exists (select 1 from public.ecosystems where id = _eco)
     or exists (select 1 from public.credit_ledger where ecosystem_id = _eco) then
    raise exception 'FAIL: shop data remains after deletion';
  end if;

  -- 3. platform history survives, detached
  if not exists (select 1 from public.platform_credit_issuances where id = _issuance) then
    raise exception 'FAIL: platform issuance history was deleted';
  end if;
  if (select ledger_id from public.platform_credit_issuances where id = _issuance) is not null then
    raise exception 'FAIL: platform issuance still points at a deleted ledger row';
  end if;

  -- 4. the deletion audit/snapshot is preserved
  if not exists (
    select 1 from public.platform_deletion_log
     where ecosystem_id = _eco and deletion_kind = 'admin_self_delete'
       and outstanding_snapshot is not null
  ) then
    raise exception 'FAIL: deletion log/snapshot missing';
  end if;

  raise notice 'shop-deletion platform-reference fixtures PASS';
end $$;

rollback;
