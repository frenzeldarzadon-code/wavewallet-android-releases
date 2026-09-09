-- 1. Link points entries to retail orders and guarantee one earn per order.
alter table public.points_ledger
  add column if not exists retail_order_id uuid references public.retail_orders(id) on delete set null;

create unique index if not exists points_ledger_retail_earn_once
  on public.points_ledger (retail_order_id)
  where entry_type = 'earn' and retail_order_id is not null;

-- 2. Voucher purchases: base points on the coins ACTUALLY charged (net of the
--    buyer's own self-purchase cashback). Patch the authoritative function in
--    place so no other behaviour changes.
do $mig$
declare _src text; _new text;
  _a1 text := 'update public.voucher_sales vs set self_cashback = _self_cb, buyer_charge = _charge where vs.id = _sale;';
  _a2 text := $q$_sale, _total, _ratio, _ver);$q$;
begin
  select pg_get_functiondef(p.oid) into _src
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'purchase_voucher';
  if _src is null then raise exception 'purchase_voucher not found'; end if;
  if position(_a1 in _src) = 0 then raise exception 'purchase_voucher: netting anchor not found'; end if;
  if position(_a2 in _src) = 0 then raise exception 'purchase_voucher: points anchor not found'; end if;

  _new := replace(_src, _a1,
    _a1 || '
    if coalesce(_ratio,0) > 0 then
      _earn := round(greatest(coalesce(_charge, _total), 0) / _ratio, 2);
      if _pacct is null then _earn := 0; end if;
      update public.voucher_sales vs3 set points_earned = _earn where vs3.id = _sale;
    end if;');
  _new := replace(_new, _a2, '_sale, coalesce(_charge, _total), _ratio, _ver);');
  execute _new;
end $mig$;

-- 3. Universe retail orders earn points on confirmed receipt.
create or replace function public.retail_award_order_points(_order_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _o public.retail_orders; _ratio numeric; _ver integer;
        _net numeric(14,2); _earn numeric(14,2); _pacct uuid;
begin
  select * into _o from public.retail_orders where id = _order_id;
  if _o.id is null then return 0; end if;
  if _o.status <> 'approved' or _o.fulfillment_status <> 'completed' then return 0; end if;
  if coalesce(_o.payment_method, '') <> 'credit' then return 0; end if;
  if not public.is_universe_shop(_o.ecosystem_id) then return 0; end if;
  if public.is_super_admin(_o.customer_id) then return 0; end if;

  _net := round(greatest(coalesce(_o.buyer_charge,
            round(coalesce(_o.total, 0) - coalesce(_o.self_cashback, 0), 2)), 0), 2);
  if _net <= 0 then return 0; end if;

  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _o.ecosystem_id;
  if coalesce(_ratio, 0) <= 0 then return 0; end if;

  _earn := round(_net / _ratio, 2);
  if _earn <= 0 then return 0; end if;

  insert into public.points_accounts (user_id, ecosystem_id) values (_o.customer_id, _o.ecosystem_id)
  on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
  select id into _pacct from public.points_accounts
   where user_id = _o.customer_id and ecosystem_id = _o.ecosystem_id;
  if _pacct is null then return 0; end if;

  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type,
                                    retail_order_id, credits_basis, credits_per_point_used, points_rule_version)
  values (_pacct, _o.customer_id, _o.ecosystem_id, 'credit', _earn, 0,
          'Points earned — order ' || _o.order_no || ' (' || _ratio::text || ' credits = 1 pt)',
          _o.order_no, _o.customer_id,
          coalesce(_o.credit_hold_tx, _o.order_no) || '-P', 'earn',
          _o.id, _net, _ratio, _ver)
  on conflict do nothing;

  return _earn;
end $function$;

revoke all on function public.retail_award_order_points(uuid) from public, anon, authenticated;

create or replace function public.retail_reverse_order_points(_order_id uuid, _reason text)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _orig public.points_ledger; _acct uuid;
begin
  select * into _orig from public.points_ledger
   where retail_order_id = _order_id and entry_type = 'earn' limit 1;
  if _orig.id is null then return 0; end if;
  if exists (select 1 from public.points_ledger
              where retail_order_id = _order_id and entry_type = 'adjust' and direction = 'debit') then
    return 0;
  end if;

  select id into _acct from public.points_accounts
   where user_id = _orig.user_id and ecosystem_id = _orig.ecosystem_id;
  if _acct is null then return 0; end if;

  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type,
                                    retail_order_id, credits_basis, credits_per_point_used, points_rule_version)
  values (_acct, _orig.user_id, _orig.ecosystem_id, 'debit', _orig.amount, 0,
          'Points reversed — ' || coalesce(nullif(btrim(_reason), ''), 'order reversed'),
          _orig.reference, auth.uid(), public.new_tx_id(), 'adjust',
          _order_id, _orig.credits_basis, _orig.credits_per_point_used, _orig.points_rule_version);
  return _orig.amount;
end $function$;

revoke all on function public.retail_reverse_order_points(uuid, text) from public, anon, authenticated;

-- 4. Hook the award into the authoritative fulfillment transition.
do $mig$
declare _src text; _new text;
  _a text := 'update public.retail_orders set fulfillment_status = _next where id = _o.id and status = ''approved'';';
begin
  select pg_get_functiondef(p.oid) into _src
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'retail_update_fulfillment';
  if _src is null then raise exception 'retail_update_fulfillment not found'; end if;
  if position(_a in _src) = 0 then raise exception 'retail_update_fulfillment: anchor not found'; end if;
  _new := replace(_src, _a,
    _a || '
  if _next = ''completed'' then perform public.retail_award_order_points(_o.id); end if;');
  execute _new;
end $mig$;