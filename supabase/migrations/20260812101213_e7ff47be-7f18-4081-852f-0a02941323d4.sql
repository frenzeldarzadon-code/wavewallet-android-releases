-- ---------------------------------------------------------------------------
-- Retention run log
-- ---------------------------------------------------------------------------
create table if not exists public.retention_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cutoff timestamptz not null,
  dry_run boolean not null default false,
  status text not null default 'running',      -- running | success | failed
  deleted jsonb not null default '{}'::jsonb,
  flagged jsonb not null default '{}'::jsonb,  -- categories retained for review
  error text,
  triggered_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists retention_runs_recent_idx on public.retention_runs (started_at desc);

grant select on public.retention_runs to authenticated;
grant all on public.retention_runs to service_role;
alter table public.retention_runs enable row level security;
create policy "Staff read retention runs" on public.retention_runs
  for select to authenticated
  using (public.is_super_admin(auth.uid()) or public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Ledgers stay immutable, except for the retention purge which may only DELETE
-- whole rows older than the window (never UPDATE them).
-- ---------------------------------------------------------------------------
create or replace function public.block_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('wavewallet.retention_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Ledger entries are immutable';
end;
$$;

-- ---------------------------------------------------------------------------
-- The purge itself
-- ---------------------------------------------------------------------------
create or replace function public.run_retention_purge(_dry_run boolean default false)
returns public.retention_runs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _cutoff timestamptz := now() - interval '12 months';
  _run public.retention_runs;
  _d jsonb := '{}'::jsonb;
  _f jsonb := '{}'::jsonb;
  _n bigint;
begin
  -- The scheduler runs without a session (auth.uid() is null); humans must be
  -- the platform owner.
  if auth.uid() is not null and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can run the retention cleanup';
  end if;

  insert into public.retention_runs (cutoff, dry_run, triggered_by)
  values (_cutoff, coalesce(_dry_run, false), auth.uid())
  returning * into _run;

  -- Categories that may carry legal/accounting obligations: counted, never deleted.
  select count(*) into _n from public.audit_logs where created_at < _cutoff;
  _f := _f || jsonb_build_object('audit_logs', _n);
  select count(*) into _n from public.subscription_requests where created_at < _cutoff;
  _f := _f || jsonb_build_object('subscription_requests', _n);
  select count(*) into _n from public.admin_invitations where created_at < _cutoff;
  _f := _f || jsonb_build_object('admin_invitations', _n);

  if coalesce(_dry_run, false) then
    -- Count only; nothing is removed.
    select count(*) into _n from public.credit_ledger where created_at < _cutoff;
    _d := _d || jsonb_build_object('credit_ledger', _n);
    select count(*) into _n from public.points_ledger where created_at < _cutoff;
    _d := _d || jsonb_build_object('points_ledger', _n);
    select count(*) into _n from public.voucher_sales where created_at < _cutoff;
    _d := _d || jsonb_build_object('voucher_sales', _n);
    select count(*) into _n from public.voucher_codes where status = 'sold' and sold_at < _cutoff;
    _d := _d || jsonb_build_object('voucher_codes', _n);
    select count(*) into _n from public.reward_redemptions
      where created_at < _cutoff and status in ('fulfilled','rejected','cancelled','expired');
    _d := _d || jsonb_build_object('reward_redemptions', _n);
  else
    perform set_config('wavewallet.retention_purge', 'on', true);

    with x as (delete from public.sale_commissions where created_at < _cutoff returning 1)
      select count(*) into _n from x;
    _d := _d || jsonb_build_object('sale_commissions', _n);

    with x as (delete from public.credit_lot_consumptions where created_at < _cutoff returning 1)
      select count(*) into _n from x;
    _d := _d || jsonb_build_object('credit_lot_consumptions', _n);

    -- Only fully-spent lots go; lots still backing a live balance stay.
    with x as (
      delete from public.credit_lots l
       where l.created_at < _cutoff
         and l.remaining = 0
         and not exists (select 1 from public.credit_lot_consumptions c where c.lot_id = l.id)
         and not exists (select 1 from public.sale_commissions s where s.source_lot_id = l.id)
      returning 1)
      select count(*) into _n from x;
    _d := _d || jsonb_build_object('credit_lots', _n);

    -- Balances live on credit_accounts, so removing history cannot change them.
    with x as (
      delete from public.credit_ledger e
       where e.created_at < _cutoff
         and not exists (select 1 from public.credit_lots l where l.ledger_id = e.id)
         and not exists (select 1 from public.credit_lot_consumptions c where c.ledger_id = e.id)
         and not exists (select 1 from public.sale_commissions s
                          where s.ledger_id = e.id or s.source_ledger_id = e.id)
      returning 1)
      select count(*) into _n from x;
    _d := _d || jsonb_build_object('credit_ledger', _n);

    with x as (delete from public.points_ledger where created_at < _cutoff returning 1)
      select count(*) into _n from x;
    _d := _d || jsonb_build_object('points_ledger', _n);

    -- Sold codes are history; unused stock is live inventory and stays.
    with x as (
      delete from public.voucher_codes
       where status = 'sold' and sold_at is not null and sold_at < _cutoff
      returning 1)
      select count(*) into _n from x;
    _d := _d || jsonb_build_object('voucher_codes', _n);

    with x as (
      delete from public.voucher_sales v
       where v.created_at < _cutoff
         and not exists (select 1 from public.voucher_codes c where c.sale_id = v.id)
         and not exists (select 1 from public.credit_ledger e where e.sale_id = v.id)
         and not exists (select 1 from public.points_ledger p where p.sale_id = v.id)
         and not exists (select 1 from public.sale_commissions s where s.sale_id = v.id)
      returning 1)
      select count(*) into _n from x;
    _d := _d || jsonb_build_object('voucher_sales', _n);

    -- Settled redemptions only; anything pending stays until it is handled.
    with x as (
      delete from public.reward_redemptions r
       where r.created_at < _cutoff
         and r.status in ('fulfilled','rejected','cancelled','expired')
         and not exists (select 1 from public.points_ledger p where p.redemption_id = r.id)
      returning 1)
      select count(*) into _n from x;
    _d := _d || jsonb_build_object('reward_redemptions', _n);

    with x as (
      delete from public.voucher_imports i
       where i.created_at < _cutoff
         and not exists (select 1 from public.voucher_codes c where c.import_id = i.id)
      returning 1)
      select count(*) into _n from x;
    _d := _d || jsonb_build_object('voucher_imports', _n);

    perform set_config('wavewallet.retention_purge', 'off', true);
  end if;

  update public.retention_runs
     set finished_at = now(), status = 'success', deleted = _d, flagged = _f
   where id = _run.id
  returning * into _run;

  return _run;
exception when others then
  perform set_config('wavewallet.retention_purge', 'off', true);
  update public.retention_runs
     set finished_at = now(), status = 'failed', error = sqlerrm, deleted = _d, flagged = _f
   where id = _run.id
  returning * into _run;
  return _run;
end;
$$;

revoke all on function public.run_retention_purge(boolean) from public, anon;
grant execute on function public.run_retention_purge(boolean) to authenticated, service_role;

create extension if not exists pg_cron;
