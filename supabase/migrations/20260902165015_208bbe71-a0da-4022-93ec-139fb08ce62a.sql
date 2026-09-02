create or replace function public.consolidate_universe_wallets(_ecosystem_id uuid, _dry_run boolean default true)
returns table(user_id uuid, ecosystem_id uuid, amount numeric, outcome text, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare _r record; _kind text; _name text; _frozen boolean; _global uuid; _tx text;
        _out uuid; _in uuid; _block text; _actor uuid := auth.uid();
begin
  if _actor is not null and not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner may consolidate wallets';
  end if;
  select e.shop_kind, e.name, coalesce(e.operations_frozen,false) into _kind, _name, _frozen
    from public.ecosystems e where e.id = _ecosystem_id;
  if _kind is null then raise exception 'Shop not found'; end if;
  if _kind <> 'universe' then
    raise exception 'Only Universe shops can be consolidated (this shop is %)', _kind;
  end if;

  for _r in
    select a.id as account_id, a.user_id as uid, a.balance
      from public.credit_accounts a
     where a.ecosystem_id = _ecosystem_id
     order by a.created_at
     for update
  loop
    user_id := _r.uid; ecosystem_id := _ecosystem_id; amount := _r.balance; detail := null;

    if exists (select 1 from public.universe_wallet_consolidations c
                where c.user_id = _r.uid and c.ecosystem_id = _ecosystem_id) then
      outcome := 'already_consolidated'; return next; continue;
    end if;
    if _r.balance <= 0 then
      outcome := 'zero'; return next; continue;
    end if;
    if public.is_super_admin(_r.uid) then
      outcome := 'blocked'; detail := 'platform owner holds no member wallet'; return next; continue;
    end if;

    _block := null;
    if _frozen then _block := 'shop is frozen'; end if;
    if _block is null and exists (select 1 from public.withdrawal_requests w
          where w.user_id = _r.uid and w.ecosystem_id = _ecosystem_id and w.status in ('pending','approved')) then
      _block := 'pending withdrawal';
    end if;
    if _block is null and exists (select 1 from public.cash_in_requests c
          where (c.user_id = _r.uid or c.funding_admin_id = _r.uid) and c.ecosystem_id = _ecosystem_id and c.status = 'pending') then
      _block := 'pending cash in';
    end if;
    if _block is null and exists (select 1 from public.credit_purchase_orders o
          where o.buyer_id = _r.uid and o.ecosystem_id = _ecosystem_id and o.status = 'pending') then
      _block := 'pending credit order';
    end if;
    if _block is null and exists (select 1 from public.retail_orders o
          where o.customer_id = _r.uid and o.ecosystem_id = _ecosystem_id and o.status = 'pending') then
      _block := 'pending retail order';
    end if;
    if _block is not null then
      outcome := 'blocked'; detail := _block; return next; continue;
    end if;

    if _dry_run then
      outcome := 'would_move'; return next; continue;
    end if;

    _global := public.ensure_global_wallet(_r.uid);
    perform 1 from public.credit_accounts where id = _global for update;
    _tx := public.new_tx_id();

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_r.account_id, _r.uid, _ecosystem_id, 'debit', _r.balance, 0,
            'Moved to your Universe wallet — ' || _name, _tx, null, _tx, 'universe_consolidation_out')
    returning id into _out;

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_global, _r.uid, null, 'credit', _r.balance, 0,
            'Universe wallet consolidation — from ' || _name, _tx, null, _tx || '-R', 'universe_consolidation_in')
    returning id into _in;

    insert into public.universe_wallet_consolidations
      (user_id, ecosystem_id, shop_account_id, global_account_id, amount, tx_id, shop_ledger_id, global_ledger_id, created_by)
    values (_r.uid, _ecosystem_id, _r.account_id, _global, _r.balance, _tx, _out, _in, _actor);

    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_ecosystem_id, _actor, 'Platform', 'Consolidated shop wallet into Universe wallet', _r.uid::text,
            jsonb_build_object('amount', _r.balance, 'tx_id', _tx, 'shop_account_id', _r.account_id,
                               'global_account_id', _global));

    outcome := 'moved'; detail := _tx; return next;
  end loop;
  return;
end $$;