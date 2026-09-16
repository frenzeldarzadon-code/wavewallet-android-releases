-- Reward Points OFF converts a shop's existing points to Universe Coins 1:1.
-- Run inside a transaction; the final RAISE forces a rollback.
begin;

do $t$
declare
  _eco uuid; _eco_b uuid; _u uuid; _pa uuid; _gen int;
  _coins_before numeric(14,2); _coins_after numeric(14,2);
  _bal numeric(14,2); _b_bal_before numeric(14,2); _b_bal_after numeric(14,2);
  _converted numeric(14,2); _again numeric(14,2); _rows int;
begin
  select id into _eco from public.ecosystems where shop_kind = 'universe' and points_enabled order by created_at limit 1;
  select id into _eco_b from public.ecosystems where shop_kind = 'universe' and points_enabled and id <> _eco order by created_at limit 1;
  select user_id into _u from public.points_accounts where ecosystem_id = _eco limit 1;
  if _eco is null or _eco_b is null or _u is null then raise exception 'fixture missing'; end if;

  -- give the member exactly 125.50 available points in shop A
  update public.points_accounts set balance = 125.50, held = 0 where ecosystem_id = _eco and user_id = _u
    returning id into _pa;
  -- shop B keeps its own points
  insert into public.points_accounts (user_id, ecosystem_id) values (_u, _eco_b)
    on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
  update public.points_accounts set balance = 40, held = 0 where ecosystem_id = _eco_b and user_id = _u;
  select balance into _b_bal_before from public.points_accounts where ecosystem_id = _eco_b and user_id = _u;

  select balance into _coins_before from public.credit_accounts where id = public.ensure_global_wallet(_u);
  select points_rule_version + 1 into _gen from public.ecosystems where id = _eco;

  -- 1. disable converts 125.50 points -> 125.50 coins, points go to zero
  update public.ecosystems set points_enabled = false, points_rule_version = _gen where id = _eco;
  _converted := public.convert_shop_points_to_coins(_eco, _gen);

  select balance into _bal from public.points_accounts where id = _pa;
  select balance into _coins_after from public.credit_accounts where id = public.ensure_global_wallet(_u);
  if _bal <> 0 then raise exception 'points not zeroed: %', _bal; end if;
  if _coins_after - _coins_before < 125.50 then raise exception 'coins not credited 1:1: % -> %', _coins_before, _coins_after; end if;

  -- 2. idempotent: retrying the same disable event converts nothing more
  _again := public.convert_shop_points_to_coins(_eco, _gen);
  if _again <> 0 then raise exception 'conversion repeated: %', _again; end if;
  select count(*) into _rows from public.points_disable_conversions
   where ecosystem_id = _eco and generation = _gen and user_id = _u;
  if _rows <> 1 then raise exception 'duplicate audit rows: %', _rows; end if;

  -- 3. other shop untouched
  select balance into _b_bal_after from public.points_accounts where ecosystem_id = _eco_b and user_id = _u;
  if _b_bal_after <> _b_bal_before then raise exception 'other shop converted: % -> %', _b_bal_before, _b_bal_after; end if;

  -- 4. while disabled no new points can be awarded (and no replacement coins)
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    entry_type, reason)
  values (_pa, _u, _eco, 'credit', 10, 0, 'earn', 'test award while disabled');
  select balance into _bal from public.points_accounts where id = _pa;
  if _bal <> 0 then raise exception 'points awarded while disabled: %', _bal; end if;
  select count(*) into _rows from public.points_disable_conversions where ecosystem_id = _eco;
  if _rows <> 1 then raise exception 'admin charged for would-be points'; end if;

  -- 5. re-enable starts a fresh period, converted coins stay coins
  update public.ecosystems set points_enabled = true, points_rule_version = _gen + 1 where id = _eco;
  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    entry_type, reason)
  values (_pa, _u, _eco, 'credit', 10, 0, 'earn', 'fresh period award');
  select balance into _bal from public.points_accounts where id = _pa;
  if _bal <> 10 then raise exception 'fresh earning broken: %', _bal; end if;
  select balance into _coins_after from public.credit_accounts where id = public.ensure_global_wallet(_u);
  if _coins_after - _coins_before < 125.50 then raise exception 'conversion refunded on re-enable'; end if;

  -- 6. disabling again converts only the new 10 points
  update public.ecosystems set points_enabled = false, points_rule_version = _gen + 2 where id = _eco;
  _converted := public.convert_shop_points_to_coins(_eco, _gen + 2);
  select balance into _bal from public.points_accounts where id = _pa;
  if _bal <> 0 then raise exception 'second conversion left points: %', _bal; end if;
  select points_converted into _converted from public.points_disable_conversions
   where ecosystem_id = _eco and generation = _gen + 2 and user_id = _u;
  if _converted <> 10 then raise exception 'second conversion amount wrong: %', _converted; end if;

  -- 7. rewards listing is empty and redemption blocked while disabled
  if exists (select 1 from public.list_rewards(_eco)) then raise exception 'rewards listed while disabled'; end if;

  raise notice 'ALL POINTS-DISABLE CONVERSION TESTS PASSED';
end $t$;

do $r$ begin raise exception 'rollback test transaction'; end $r$;
rollback;
