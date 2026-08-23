-- Regression: automatic (system-created) spending categories must never block
-- the permanent shop-deletion rule.
--
-- Rule: a shop admin may permanently delete their own shop when no member still
-- holds Coins. Automatic categories are shop-scoped bookkeeping, so the purge
-- removes them with the shop. Outside a purge they stay protected, and a shop
-- where a member still holds Coins is still blocked.
--
-- Runs inside a transaction that is ROLLED BACK.

begin;

do $$
declare
  _kill uuid; _keep uuid;
  _owner uuid := gen_random_uuid();
  _member uuid;
  _cat uuid;
  _err text;
begin
  -- an existing non-super-admin identity (profiles reference auth.users)
  select p.id into _member from public.profiles p
   where not public.is_super_admin(p.id)
   order by p.created_at limit 1;
  if _member is null then raise notice 'no member available'; return; end if;

  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price)
  values ('FIXTURE Cat Purge', 'fixture-cat-purge', 'tok-cat-kill', 'Starter', 150)
  returning id into _kill;
  insert into public.ecosystems (name, slug, signup_token, plan_name, plan_price)
  values ('FIXTURE Cat Keep', 'fixture-cat-keep', 'tok-cat-keep', 'Starter', 150)
  returning id into _keep;

  insert into public.spending_categories (ecosystem_id, kind, name, auto_key)
  values (_kill, 'income', 'FIXTURE Auto Income', 'auto_income')
  returning id into _cat;
  insert into public.spending_categories (ecosystem_id, kind, name)
  values (_kill, 'expense', 'FIXTURE Manual Expense');
  insert into public.spending_categories (ecosystem_id, kind, name, auto_key)
  values (_keep, 'income', 'FIXTURE Auto Income', 'auto_income');

  insert into public.spending_income_entries
    (ecosystem_id, category_id, amount, description, created_by)
  values (_kill, _cat, 100, 'FIXTURE income', _member);

  -- 1. outside a purge, automatic categories are still protected
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

  -- 2. ineligible shop (a member still holds Coins) stays blocked
  insert into public.ecosystem_memberships (user_id, ecosystem_id, role, status)
  values (_member, _kill, 'customer', 'active')
  on conflict do nothing;
  insert into public.credit_accounts (user_id, ecosystem_id, balance)
  values (_member, _kill, 250)
  on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set balance = 250;
  if (public.shop_deletion_check_unchecked(_kill)->>'can_delete')::boolean then
    raise exception 'FAIL: deletion allowed while a member holds Coins';
  end if;

  -- 3. eligible shop + automatic categories => deletion succeeds
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

  -- 4. another shop's automatic category is untouched
  if not exists (select 1 from public.spending_categories
                  where ecosystem_id = _keep and auto_key = 'auto_income') then
    raise exception 'FAIL: another shop automatic category was deleted';
  end if;

  -- 5. the permanent deletion record is still written
  if not exists (select 1 from public.platform_deletion_log
                  where ecosystem_id = _kill and ecosystem_name = 'FIXTURE Cat Purge') then
    raise exception 'FAIL: platform deletion record missing';
  end if;

  -- 6. the guard is restored once the purge finishes
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
