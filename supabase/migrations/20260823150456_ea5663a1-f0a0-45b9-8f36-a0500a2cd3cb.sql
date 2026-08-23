CREATE OR REPLACE FUNCTION public.purge_ecosystem_internal(_ecosystem_id uuid, _actor uuid, _reason text, _deletion_kind text, _outstanding jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _actor_name text;
  _eco record;
  _counts jsonb;
  _members uuid[];
  _cash_ins uuid[];
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
    'cash_in_requests', (select count(*) from public.cash_in_requests where ecosystem_id = _ecosystem_id),
    'withdrawal_requests', (select count(*) from public.withdrawal_requests where ecosystem_id = _ecosystem_id),
    'credit_purchase_orders', (select count(*) from public.credit_purchase_orders where ecosystem_id = _ecosystem_id),
    'platform_issuances_detached', (select count(*) from public.platform_credit_issuances i
        join public.credit_ledger l on l.id = i.ledger_id where l.ecosystem_id = _ecosystem_id),
    'audit_logs', (select count(*) from public.audit_logs where ecosystem_id = _ecosystem_id)
  );

  perform set_config('wavewallet.retention_purge', 'on', true);

  -- Platform-level history must survive the shop: detach the pointer, keep the record.
  update public.platform_credit_issuances i
     set ledger_id = null
   where i.ledger_id in (select id from public.credit_ledger where ecosystem_id = _ecosystem_id);

  -- Shop-scoped money requests that reference shop ledger rows.
  select coalesce(array_agg(id), '{}') into _cash_ins
    from public.cash_in_requests where ecosystem_id = _ecosystem_id;

  if array_length(_cash_ins, 1) is not null then
    -- platform-level records keep their history, only the link is dropped
    update public.listener_events set consumed_cash_in_id = null
     where consumed_cash_in_id = any(_cash_ins);
    update public.verified_payments set consumed_cash_in_id = null
     where consumed_cash_in_id = any(_cash_ins);
    update public.payment_reference_seen set cash_in_id = null
     where cash_in_id = any(_cash_ins);
    delete from public.payment_match_records where cash_in_id = any(_cash_ins);
    delete from public.cash_in_reference_conflicts
     where new_request_id = any(_cash_ins) or old_request_id = any(_cash_ins);
    update public.cash_in_requests
       set duplicate_of = null, duplicate_receipt_of = null
     where duplicate_of = any(_cash_ins) or duplicate_receipt_of = any(_cash_ins);
  end if;

  delete from public.cash_in_reference_conflicts where ecosystem_id = _ecosystem_id;
  delete from public.cash_in_requests where ecosystem_id = _ecosystem_id;
  delete from public.withdrawal_requests where ecosystem_id = _ecosystem_id;
  delete from public.credit_purchase_orders where ecosystem_id = _ecosystem_id;

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
  -- Shop-scoped bookkeeping and session records: owned by this shop only, and
  -- must never block an otherwise eligible deletion. Global/platform rows and
  -- other shops' rows are untouched (everything here is scoped by ecosystem_id).
  delete from public.spending_income_entries where ecosystem_id = _ecosystem_id;
  delete from public.spending_categories where ecosystem_id = _ecosystem_id;
  delete from public.impersonation_sessions where ecosystem_id = _ecosystem_id;

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
$function$;

create or replace function public.spending_category_delete_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- The permanent shop-deletion rule supersedes this guard: during a controlled
  -- shop purge / retention run, shop-scoped automatic categories are removed
  -- together with the rest of the shop. Outside a purge they stay protected.
  if current_setting('wavewallet.retention_purge', true) = 'on' then
    return old;
  end if;
  if old.auto_key is not null then
    raise exception 'Automatic categories cannot be deleted';
  end if;
  return old;
end;
$function$;