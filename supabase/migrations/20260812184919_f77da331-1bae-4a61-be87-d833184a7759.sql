create or replace function public.reset_ecosystem_test_data(
  _ecosystem_id uuid,
  _reason text,
  _dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _actor_name text;
  _counts jsonb;
  _n_ledger int; _n_points int; _n_sales int; _n_comm int; _n_lots int;
  _n_cons int; _n_rev int; _n_red int; _n_codes int;
begin
  if _actor is not null and not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can reset test data';
  end if;
  if coalesce(btrim(_reason), '') = '' then
    raise exception 'A reason is required';
  end if;
  if not exists (select 1 from public.ecosystems where id = _ecosystem_id) then
    raise exception 'Shop not found';
  end if;

  select count(*) into _n_ledger from public.credit_ledger where ecosystem_id = _ecosystem_id;
  select count(*) into _n_points from public.points_ledger where ecosystem_id = _ecosystem_id;
  select count(*) into _n_sales from public.voucher_sales where ecosystem_id = _ecosystem_id;
  select count(*) into _n_comm from public.sale_commissions where ecosystem_id = _ecosystem_id;
  select count(*) into _n_lots from public.credit_lots where ecosystem_id = _ecosystem_id;
  select count(*) into _n_cons from public.credit_lot_consumptions where ecosystem_id = _ecosystem_id;
  select count(*) into _n_rev from public.credit_transfer_reversals where ecosystem_id = _ecosystem_id;
  select count(*) into _n_red from public.reward_redemptions where ecosystem_id = _ecosystem_id;
  select count(*) into _n_codes from public.voucher_codes
    where ecosystem_id = _ecosystem_id and status <> 'unused';

  _counts := jsonb_build_object(
    'credit_ledger', _n_ledger,
    'points_ledger', _n_points,
    'voucher_sales', _n_sales,
    'sale_commissions', _n_comm,
    'credit_lots', _n_lots,
    'credit_lot_consumptions', _n_cons,
    'transfer_reversals', _n_rev,
    'reward_redemptions', _n_red,
    'voucher_codes_restored', _n_codes
  );

  if _dry_run then
    return jsonb_build_object('dry_run', true, 'counts', _counts);
  end if;

  perform set_config('wavewallet.retention_purge', 'on', true);

  update public.voucher_codes
     set status = 'unused', sold_to = null, sale_id = null, sold_at = null
   where ecosystem_id = _ecosystem_id and status <> 'unused';

  update public.reward_products rp
     set stock = rp.stock + coalesce(x.qty, 0), reserved = 0
    from (
      select reward_id, count(*) as qty
        from public.reward_redemptions
       where ecosystem_id = _ecosystem_id
         and status in ('pending', 'approved', 'claimed')
       group by reward_id
    ) x
   where rp.id = x.reward_id and rp.ecosystem_id = _ecosystem_id;
  update public.reward_products set reserved = 0
   where ecosystem_id = _ecosystem_id and reserved <> 0;

  delete from public.reward_redemptions where ecosystem_id = _ecosystem_id;
  delete from public.sale_commissions where ecosystem_id = _ecosystem_id;
  delete from public.credit_transfer_reversals where ecosystem_id = _ecosystem_id;
  delete from public.credit_lot_consumptions where ecosystem_id = _ecosystem_id;
  delete from public.credit_lots where ecosystem_id = _ecosystem_id;
  delete from public.points_ledger where ecosystem_id = _ecosystem_id;
  delete from public.credit_ledger where ecosystem_id = _ecosystem_id;
  delete from public.voucher_sales where ecosystem_id = _ecosystem_id;

  update public.credit_accounts set balance = 0, updated_at = now()
   where ecosystem_id = _ecosystem_id and balance <> 0;
  update public.points_accounts set balance = 0, held = 0, updated_at = now()
   where ecosystem_id = _ecosystem_id and (balance <> 0 or held <> 0);

  perform set_config('wavewallet.retention_purge', 'off', true);

  select coalesce(full_name, 'Platform owner') into _actor_name
    from public.profiles where id = _actor;
  _actor_name := coalesce(_actor_name, 'Platform owner');

  insert into public.test_data_resets (ecosystem_id, actor_id, actor_name, reason, counts)
  values (_ecosystem_id, _actor, _actor_name, btrim(_reason), _counts);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  select _ecosystem_id, _actor, _actor_name, 'Reset test transaction data', e.name,
         jsonb_build_object('reason', btrim(_reason), 'counts', _counts)
    from public.ecosystems e where e.id = _ecosystem_id;

  return jsonb_build_object('dry_run', false, 'counts', _counts);
end;
$$;

revoke all on function public.reset_ecosystem_test_data(uuid, text, boolean) from public;
grant execute on function public.reset_ecosystem_test_data(uuid, text, boolean) to authenticated, service_role;