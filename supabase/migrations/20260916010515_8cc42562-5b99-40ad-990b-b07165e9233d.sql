
-- ===========================================================================
-- Historical points -> Admin coin cost reconciliation (1 point = 1 coin)
-- Read-only with respect to points: nothing here writes points_ledger.
-- ===========================================================================

CREATE TABLE public.points_cost_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  points_total numeric(14,2) NOT NULL DEFAULT 0,
  coin_equivalent numeric(14,2) NOT NULL DEFAULT 0,
  amount_debited numeric(14,2) NOT NULL DEFAULT 0,
  shortfall numeric(14,2) NOT NULL DEFAULT 0,
  entries_count integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  ledger_id uuid REFERENCES public.credit_ledger(id) ON DELETE SET NULL,
  tx_id text,
  note text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.points_cost_reconciliations TO authenticated;
GRANT ALL ON public.points_cost_reconciliations TO service_role;
ALTER TABLE public.points_cost_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads reconciliation runs"
  ON public.points_cost_reconciliations FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE TRIGGER update_points_cost_reconciliations_updated_at
  BEFORE UPDATE ON public.points_cost_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- One row per historical point award that has already been charged.
CREATE TABLE public.points_cost_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES public.points_cost_reconciliations(id) ON DELETE CASCADE,
  points_ledger_id uuid NOT NULL REFERENCES public.points_ledger(id) ON DELETE CASCADE,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  points numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The idempotency guarantee: a point award can be charged at most once, ever.
CREATE UNIQUE INDEX points_cost_reconciliation_items_unique
  ON public.points_cost_reconciliation_items (points_ledger_id);
CREATE INDEX points_cost_reconciliation_items_run
  ON public.points_cost_reconciliation_items (reconciliation_id);

GRANT SELECT ON public.points_cost_reconciliation_items TO authenticated;
GRANT ALL ON public.points_cost_reconciliation_items TO service_role;
ALTER TABLE public.points_cost_reconciliation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads reconciliation items"
  ON public.points_cost_reconciliation_items FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Eligible historical point awards.
-- Authoritative source: points_ledger 'earn' rows.
-- Excluded: reversed awards, awards whose coin cost the purchase already
-- charged the admin (admin self-purchase net charge), non-Universe shops,
-- rows without a shop, and rows already reconciled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.points_cost_pending_entries(_eco uuid DEFAULT NULL)
RETURNS TABLE(entry_id uuid, ecosystem_id uuid, points numeric, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select l.id, l.ecosystem_id, l.amount, l.created_at
    from public.points_ledger l
    join public.ecosystems e on e.id = l.ecosystem_id
    left join public.voucher_sales vs on vs.id = l.sale_id
   where l.entry_type = 'earn'
     and e.shop_kind = 'universe'
     and (_eco is null or l.ecosystem_id = _eco)
     and not exists (select 1 from public.points_cost_reconciliation_items i
                      where i.points_ledger_id = l.id)
     -- already reversed / voided by the authoritative points rules
     and not exists (select 1 from public.points_ledger r
                      where r.entry_type = 'adjust' and r.direction = 'debit'
                        and ((r.retail_order_id is not null and r.retail_order_id = l.retail_order_id)
                          or (r.sale_id is not null and r.sale_id = l.sale_id)))
     -- admin self-purchase: the 1 point = 1 coin cost was charged at purchase
     and not (vs.id is not null
              and vs.buyer_role = 'admin'
              and vs.buyer_id = public.shop_primary_admin(l.ecosystem_id)
              and coalesce(vs.self_cashback, 0) > 0)
$$;

REVOKE ALL ON FUNCTION public.points_cost_pending_entries(uuid) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Per-shop report (platform owner only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_points_cost_report()
RETURNS TABLE(ecosystem_id uuid, shop_name text, admin_id uuid, admin_name text,
              historical_points numeric, charged_points numeric, pending_points numeric,
              charged_coins numeric, shortfall_coins numeric, admin_available numeric,
              status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;
  return query
  with pend as (
    select p.ecosystem_id eco, sum(p.points) pts
      from public.points_cost_pending_entries(null) p group by 1
  ), done as (
    select i.ecosystem_id eco, sum(i.points) pts
      from public.points_cost_reconciliation_items i group by 1
  ), paid as (
    select r.ecosystem_id eco, sum(r.amount_debited) coins
      from public.points_cost_reconciliations r group by 1
  )
  select e.id, e.name,
         public.shop_primary_admin(e.id),
         (select pr.full_name from public.profiles pr where pr.id = public.shop_primary_admin(e.id)),
         round(coalesce(pend.pts,0) + coalesce(done.pts,0), 2),
         round(coalesce(done.pts,0), 2),
         round(coalesce(pend.pts,0), 2),
         round(coalesce(paid.coins,0), 2),
         round(coalesce(pend.pts,0), 2),
         case when public.shop_primary_admin(e.id) is null then 0
              else public.admin_unsecured_balance(public.shop_primary_admin(e.id)) end,
         case when coalesce(pend.pts,0) <= 0 and coalesce(done.pts,0) > 0 then 'settled'
              when coalesce(pend.pts,0) <= 0 then 'nothing_to_charge'
              when public.shop_primary_admin(e.id) is null then 'unresolved_no_admin'
              when coalesce(done.pts,0) > 0 then 'partial'
              else 'pending' end
    from public.ecosystems e
    left join pend on pend.eco = e.id
    left join done on done.eco = e.id
    left join paid on paid.eco = e.id
   where e.shop_kind = 'universe'
   order by round(coalesce(pend.pts,0) + coalesce(done.pts,0), 2) desc;
end $$;

-- Point awards that cannot be charged to any shop admin.
CREATE OR REPLACE FUNCTION public.super_points_cost_unresolved()
RETURNS TABLE(bucket text, detail text, entries integer, points numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;
  return query
  select 'no_shop'::text, 'Point awards with no shop recorded'::text,
         count(*)::int, round(coalesce(sum(l.amount),0),2)
    from public.points_ledger l
   where l.entry_type = 'earn' and l.ecosystem_id is null
  having count(*) > 0
  union all
  select 'non_universe_shop', coalesce(e.name,'Unknown shop'), count(*)::int,
         round(coalesce(sum(l.amount),0),2)
    from public.points_ledger l join public.ecosystems e on e.id = l.ecosystem_id
   where l.entry_type = 'earn' and e.shop_kind <> 'universe'
   group by e.name
  union all
  select 'no_shop_admin', e.name, count(*)::int, round(coalesce(sum(p.points),0),2)
    from public.points_cost_pending_entries(null) p
    join public.ecosystems e on e.id = p.ecosystem_id
   where public.shop_primary_admin(p.ecosystem_id) is null
   group by e.name;
end $$;

CREATE OR REPLACE FUNCTION public.super_points_cost_runs(_limit integer DEFAULT 200)
RETURNS TABLE(id uuid, ecosystem_id uuid, shop_name text, admin_id uuid, admin_name text,
              points_total numeric, coin_equivalent numeric, amount_debited numeric,
              shortfall numeric, entries_count integer, status text, tx_id text,
              note text, created_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;
  return query
  select r.id, r.ecosystem_id, e.name, r.admin_id, pr.full_name,
         r.points_total, r.coin_equivalent, r.amount_debited, r.shortfall,
         r.entries_count, r.status, r.tx_id, r.note, r.created_at
    from public.points_cost_reconciliations r
    join public.ecosystems e on e.id = r.ecosystem_id
    left join public.profiles pr on pr.id = r.admin_id
   order by r.created_at desc
   limit greatest(coalesce(_limit, 200), 1);
end $$;

-- ---------------------------------------------------------------------------
-- The reconciliation itself. _dry_run = true changes nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_reconcile_points_cost(_dry_run boolean DEFAULT true,
                                                              _eco uuid DEFAULT NULL)
RETURNS TABLE(ecosystem_id uuid, shop_name text, admin_id uuid, admin_name text,
              points_total numeric, coin_equivalent numeric, amount_debited numeric,
              shortfall numeric, entries_count integer, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare _s record; _admin uuid; _total numeric(14,2); _cap numeric(14,2);
        _acc numeric(14,2); _n integer; _e record; _acct uuid; _tx text;
        _ledger uuid; _run uuid; _status text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;

  for _s in select e.id, e.name from public.ecosystems e
             where e.shop_kind = 'universe' and (_eco is null or e.id = _eco)
             order by e.created_at
  loop
    select round(coalesce(sum(p.points),0),2) into _total
      from public.points_cost_pending_entries(_s.id) p;
    continue when coalesce(_total,0) <= 0;

    _admin := public.shop_primary_admin(_s.id);
    _acc := 0; _n := 0; _ledger := null; _tx := null;

    if _admin is null then
      _status := 'unresolved_no_admin';
    else
      _acct := public.ensure_global_wallet(_admin);
      -- Lock the wallet so two concurrent runs cannot spend the same balance.
      if not _dry_run then
        perform 1 from public.credit_accounts where id = _acct for update;
      end if;
      _cap := public.admin_unsecured_balance(_admin);

      -- Charge whole awards only, oldest first: the ledger amount always
      -- equals the exact set of awards marked as reconciled.
      for _e in select * from public.points_cost_pending_entries(_s.id) order by created_at, entry_id
      loop
        exit when round(_acc + _e.points, 2) > _cap;
        _acc := round(_acc + _e.points, 2);
        _n := _n + 1;
      end loop;

      _status := case when _acc >= _total then 'settled'
                      when _acc > 0 then 'partial'
                      else 'unresolved_insufficient_balance' end;
    end if;

    if not _dry_run then
      insert into public.points_cost_reconciliations
        (ecosystem_id, admin_id, points_total, coin_equivalent, amount_debited,
         shortfall, entries_count, status, actor_id, note)
      values (_s.id, _admin, _total, _total, _acc, round(_total - _acc, 2), _n, _status, auth.uid(),
              'Historical points reconciliation — 1 point = 1 coin')
      returning id into _run;

      if _acc > 0 then
        _tx := public.new_tx_id();
        insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                          balance_after, reason, reference, actor_id, tx_id, entry_kind,
                                          base_amount, commission_percent, commission_amount)
        values (_acct, _admin, _s.id, 'debit', _acc, 0,
                'Historical reward points cost — ' || _s.name || ' (' || _acc::text || ' points × 1 coin)',
                _tx, auth.uid(), _tx, 'points_cost_reconciliation', _acc, 0, 0)
        returning id into _ledger;

        insert into public.points_cost_reconciliation_items
          (reconciliation_id, points_ledger_id, ecosystem_id, points)
        select _run, p.entry_id, p.ecosystem_id, p.points
          from (select * from public.points_cost_pending_entries(_s.id)
                 order by created_at, entry_id limit _n) p
        on conflict (points_ledger_id) do nothing;

        update public.points_cost_reconciliations
           set ledger_id = _ledger, tx_id = _tx where id = _run;
      end if;

      insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
      values (_s.id, auth.uid(),
              coalesce((select full_name from public.profiles where id = auth.uid()),'Platform owner'),
              'Reconciled historical points cost', _s.name,
              jsonb_build_object('points_total', _total, 'debited', _acc,
                                 'shortfall', round(_total - _acc, 2), 'status', _status,
                                 'entries', _n, 'tx_id', _tx));
    end if;

    return query select _s.id, _s.name, _admin,
                        (select pr.full_name from public.profiles pr where pr.id = _admin),
                        _total, _total, _acc, round(_total - _acc, 2), _n, _status;
  end loop;
end $$;

REVOKE ALL ON FUNCTION public.super_points_cost_report() FROM public, anon;
REVOKE ALL ON FUNCTION public.super_points_cost_unresolved() FROM public, anon;
REVOKE ALL ON FUNCTION public.super_points_cost_runs(integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.super_reconcile_points_cost(boolean, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.super_points_cost_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_points_cost_unresolved() TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_points_cost_runs(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_reconcile_points_cost(boolean, uuid) TO authenticated;
