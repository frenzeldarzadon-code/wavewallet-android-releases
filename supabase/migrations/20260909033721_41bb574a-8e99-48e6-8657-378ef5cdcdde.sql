create or replace function public.retail_award_order_points(_order_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _o public.retail_orders; _ratio numeric; _ver integer;
        _net numeric(14,2); _earn numeric(14,2); _pacct uuid;
begin
  select * into _o from public.retail_orders where id = _order_id for update;
  if _o.id is null then return 0; end if;
  if _o.status <> 'approved' or _o.fulfillment_status <> 'completed' then return 0; end if;
  if coalesce(_o.payment_method, '') <> 'credit' then return 0; end if;
  if not public.is_universe_shop(_o.ecosystem_id) then return 0; end if;
  if public.is_super_admin(_o.customer_id) then return 0; end if;

  -- Already awarded (or already reversed): never award twice.
  if exists (select 1 from public.points_ledger
              where retail_order_id = _order_id and entry_type = 'earn') then
    return 0;
  end if;

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
          _o.id, _net, _ratio, _ver);

  return _earn;
end $function$;

revoke all on function public.retail_award_order_points(uuid) from public, anon, authenticated;