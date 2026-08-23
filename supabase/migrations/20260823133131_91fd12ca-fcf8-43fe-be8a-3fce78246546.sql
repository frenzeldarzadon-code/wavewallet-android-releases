-- Shared deletion body: authorization and rule checks belong to the callers
-- (purge_ecosystem = platform owner; delete_own_shop = shop admin + Coin rule).
create or replace function public.purge_ecosystem_internal(
  _ecosystem_id uuid,
  _actor uuid,
  _reason text,
  _deletion_kind text,
  _outstanding jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  _actor_name text;
  _eco record;
  _counts jsonb;
  _members uuid[];
begin
  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco.id is null then
    raise exception 'Shop not found or already deleted';
  end if;

  select coalesce(array_agg(p.id), '{}')
    into _members
    from public.profiles p
   where p.ecosystem_id = _ecosystem_id
     and not public.is_super_admin(p.id);

  _counts := jsonb_build_object(
    'members', coalesce(array_length(_members, 1), 0),
    'credit_ledger', (select count(*) from public.credit_ledger where ecosystem_id = _ecosystem_id),
    'points_ledger', (select count(*) from public.points_ledger where ecosystem_id = _ecosystem_id),
    'voucher_sales', (select count(*) from public.voucher_sales where ecosystem_id = _ecosystem_id),
    'voucher_codes', (select count(*) from public.voucher_codes where ecosystem_id = _ecosystem_id),
    'voucher_batches', (select count(*) from public.voucher_imports where ecosystem_id = _ecosystem_id),
    'voucher_products', (select count(*) from public.voucher_products where ecosystem_id = _ecosystem_id),
    'reward_products', (select count(*) from public.reward_products where ecosystem_id = _ecosystem_id),
    'reward_redemptions', (select count(*) from public.reward_redemptions where ecosystem_id = _ecosystem_id),
    'sale_commissions', (select count(*) from public.sale_commissions where ecosystem_id = _ecosystem_id),
    'transfer_reversals', (select count(*) from public.credit_transfer_reversals where ecosystem_id = _ecosystem_id),
    'subscription_requests', (select count(*) from public.subscription_requests where ecosystem_id = _ecosystem_id),
    'audit_logs', (select count(*) from public.audit_logs where ecosystem_id = _ecosystem_id)
  );

  perform set_config('wavewallet.retention_purge', 'on', true);

  delete from public.reward_redemptions where ecosystem_id = _ecosystem_id;
  delete from public.sale_commissions where ecosystem_id = _ecosystem_id;
  delete from public.credit_transfer_reversals where ecosystem_id = _ecosystem_id;
  delete from public.credit_lot_consumptions where ecosystem_id = _ecosystem_id;
  delete from public.credit_lots where ecosystem_id = _ecosystem_id;
  delete from public.points_ledger where ecosystem_id = _ecosystem_id;
  delete from public.credit_ledger where ecosystem_id = _ecosystem_id;
  delete from public.voucher_codes where ecosystem_id = _ecosystem_id;
  delete from public.voucher_sales where ecosystem_id = _ecosystem_id;
  delete from public.voucher_imports where ecosystem_id = _ecosystem_id;
  delete from public.voucher_products where ecosystem_id = _ecosystem_id;
  delete from public.reward_products where ecosystem_id = _ecosystem_id;
  delete from public.points_accounts where ecosystem_id = _ecosystem_id;
  delete from public.credit_accounts where ecosystem_id = _ecosystem_id;
  delete from public.subscription_adjustments where ecosystem_id = _ecosystem_id;
  delete from public.subscription_requests where ecosystem_id = _ecosystem_id;
  delete from public.admin_invitations where ecosystem_id = _ecosystem_id;
  delete from public.test_data_resets where ecosystem_id = _ecosystem_id;
  delete from public.audit_logs where ecosystem_id = _ecosystem_id;

  update public.profiles set reseller_id = null
   where ecosystem_id = _ecosystem_id and reseller_id is not null;
  delete from public.user_roles
   where user_id = any(_members) and coalesce(ecosystem_id, _ecosystem_id) = _ecosystem_id;
  delete from public.user_roles where ecosystem_id = _ecosystem_id;
  delete from public.profiles where id = any(_members);

  delete from public.ecosystems where id = _ecosystem_id;

  perform set_config('wavewallet.retention_purge', 'off', true);

  select coalesce(full_name, 'Platform owner') into _actor_name
    from public.profiles where id = _actor;
  _actor_name := coalesce(_actor_name,
    case when _deletion_kind = 'admin_self_delete' then 'Shop admin' else 'Platform owner' end);

  insert into public.platform_deletion_log
    (ecosystem_id, ecosystem_name, ecosystem_slug, actor_id, actor_name, reason, counts,
     deletion_kind, outstanding_snapshot)
  values
    (_ecosystem_id, _eco.name, _eco.slug, _actor, _actor_name, btrim(_reason), _counts,
     coalesce(_deletion_kind, 'super_admin_purge'), _outstanding);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, _actor, _actor_name,
          case when _deletion_kind = 'admin_self_delete'
               then 'Shop admin permanently deleted their shop'
               else 'Permanently deleted ecosystem' end,
          _eco.name || ' (/join/' || _eco.slug || ')',
          jsonb_build_object('ecosystem_id', _ecosystem_id, 'reason', btrim(_reason),
                             'counts', _counts, 'deletion_kind', coalesce(_deletion_kind,'super_admin_purge'),
                             'outstanding', _outstanding));

  return jsonb_build_object('ecosystem_id', _ecosystem_id, 'name', _eco.name, 'counts', _counts);
end;
$fn$;

revoke all on function public.purge_ecosystem_internal(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.purge_ecosystem_internal(uuid, uuid, text, text, jsonb) to service_role;

create or replace function public.purge_ecosystem(_ecosystem_id uuid, _confirm_name text, _reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  _actor uuid := auth.uid();
  _eco record;
  _trusted boolean := session_user in ('postgres', 'supabase_admin', 'service_role');
begin
  if not _trusted then
    if _actor is null or not public.is_super_admin(_actor) then
      raise exception 'Only the platform owner can permanently delete a shop';
    end if;
  end if;

  if coalesce(btrim(_reason), '') = '' then
    raise exception 'A reason is required';
  end if;

  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco.id is null then
    raise exception 'Shop not found or already deleted';
  end if;
  if btrim(coalesce(_confirm_name, '')) <> _eco.name then
    raise exception 'Type the shop name exactly to confirm permanent deletion';
  end if;

  return public.purge_ecosystem_internal(
    _ecosystem_id, _actor, _reason, 'super_admin_purge',
    (select public.shop_deletion_check_unchecked(_ecosystem_id)));
end;
$fn$;

-- Read-only outstanding-Coin snapshot with no caller check, so the platform
-- owner's purge can record what was outstanding at deletion time.
create or replace function public.shop_deletion_check_unchecked(_ecosystem_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $fn$
  select jsonb_build_object(
    'ecosystem_id', _ecosystem_id,
    'outstanding_total', coalesce(sum(ca.balance), 0),
    'can_delete', coalesce(sum(ca.balance), 0) = 0
  )
  from public.credit_accounts ca
  where ca.ecosystem_id = _ecosystem_id
    and ca.balance > 0
    and not public.is_ecosystem_admin(ca.user_id, _ecosystem_id)
    and not public.is_super_admin(ca.user_id);
$fn$;

revoke all on function public.shop_deletion_check_unchecked(uuid) from public, anon, authenticated;
grant execute on function public.shop_deletion_check_unchecked(uuid) to service_role;

revoke all on function public.purge_ecosystem(uuid, text, text) from public, anon;
grant execute on function public.purge_ecosystem(uuid, text, text) to authenticated, service_role;