-- Regression: automatic (system-created) spending categories must never block
-- the permanent shop-deletion rule.
--
-- The rule: a shop admin may permanently delete their own shop when no member
-- still holds Coins. Automatic categories are shop-scoped bookkeeping, so the
-- purge removes them with the shop. Outside a purge they stay protected, and
-- an ineligible shop (a member still holding Coins) is still blocked.
--
-- Runs inside a transaction that is ROLLED BACK.

begin;

do $$
declare
  _kill uuid; _keep uuid;
  _owner uuid := gen_random_uuid();
  _member uuid := gen_random_uuid();
  _cat uuid;
  _err text;
begin
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price)
  values ('FIXTURE Cat Purge', 'fixture-cat-purge', 'tok-cat-kill', 'Starter', 150)
  returning id into _kill;
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price)
  values ('FIXTURE Cat Keep', 'fixture-cat-keep', 'tok-cat-keep', 'Starter', 150)
  returning id into _keep;

  set constraints all deferred;
  insert into public.profiles (id, ecosystem_id, full_name, email, phone)
  values (_member, _kill, 'FIXTURE Member', 'fixture-cat-member@example.test', '0');

  -- automatic + manual categories in both shops
  insert into public.spending_categories (ecosystem_id, kind, name, auto_key)
  values (_kill, 'income', 'FIXTURE Auto Income', 'auto_income')
  returning id into _cat;
  insert into public.spending_categories (ecosystem_id, kind, name)
  values (_kill, 'expense', 'FIXTURE Manual Expense');
  insert into public.spending_categories (ecosystem_id, kind, name, auto_key)
  values (_keep, 'income', 'FIXTURE Auto Income', 'auto_income');

  insert into public.spending_income_entries
    (ecosystem_id, category_id, occurred_on, amount, note)
  values (_kill, _cat, current_date, 100, 'FIXTURE income');

  -- 1. outside a purge the automatic category is still protected
  begin
    delete from public.spending_categories where id = _cat;
    raise exception 'FAIL: automatic category was deletable outside a purge';
  exception when others then
    get stacked diagnostics _err = message_text;
    if _err like 'FAIL:%' then raise exception '%', _err; end if;
    if _err not like '%Automatic categories cannot be deleted%' then
      raise exception 'FAIL: unexpected error %', _err;
    end if;
  end;

  -- 2. ineligible shop (a member still holds Coins) is still blocked
  insert into public.credit_accounts (user_id, ecosystem_id, balance)
  values (_member, _kill, 250);
  if (public.shop_deletion_check_unchecked(_kill)->>'can_delete')::boolean then
    raise exception 'FAIL: deletion allowed while a member holds Coins';
  end if;

  -- 3. eligible shop + automatic category => deletion succeeds
  update public.credit_accounts set balance = 0
   where ecosystem_id = _kill and user_id = _member;
  if not (public.shop_deletion_check_unchecked(_kill)->>'can_delete')::boolean then
    raise exception 'FAIL: eligible shop reported as blocked';
  end if;

  perform public.purge_ecosystem_internal(_kill, _owner, 'Regression fixture',
                                          'admin_self_delete',
                                          public.shop_deletion_check_unchecked(_kill));

  if exists (select 1 from public.ecosystems where id = _kill)
     or exists (select 1 from public.spending_categories where ecosystem_id = _kill)
     or exists (select 1 from public.spending_income_entries where ecosystem_id = _kill) then
    raise exception 'FAIL: shop or its categories survived the deletion';
  end if;

  -- 4. the other shop's automatic category is untouched
  if not exists (
    select 1 from public.spending_categories
     where ecosystem_id = _keep and auto_key = 'auto_income'
  ) then
    raise exception 'FAIL: another shop''s automatic category was deleted';
  end if;

  -- 5. the permanent deletion record is still written
  if not exists (
    select 1 from public.platform_deletion_log
     where ecosystem_id = _kill and ecosystem_name = 'FIXTURE Cat Purge'
  ) then
    raise exception 'FAIL: platform deletion record missing';
  end if;

  -- 6. the guard is restored after the purge finishes
  begin
    delete from public.spending_categories where ecosystem_id = _keep;
    raise exception 'FAIL: guard stayed disabled after the purge';
  exception when others then
    get stacked diagnostics _err = message_text;
    if _err like 'FAIL:%' then raise exception '%', _err; end if;
  end;

  raise notice 'shop-deletion automatic-category fixtures PASS';
end $$;

rollback;
