create table if not exists public.platform_deletion_log (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null,
  ecosystem_name text not null,
  ecosystem_slug text not null,
  actor_id uuid,
  actor_name text not null,
  reason text not null,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

grant select on public.platform_deletion_log to authenticated;
grant all on public.platform_deletion_log to service_role;

alter table public.platform_deletion_log enable row level security;

create policy "Platform owner reads deletion log"
  on public.platform_deletion_log for select to authenticated
  using (public.is_super_admin(auth.uid()));

create or replace function public.purge_ecosystem(
  _ecosystem_id uuid,
  _confirm_name text,
  _reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _actor_name text;
  _eco record;
  _counts jsonb;
  _members uuid[];
begin
  if _actor is not null and not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can permanently delete a shop';
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

  -- Members of this shop only. Platform owners are never removed.
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

  -- Deliberate, explicit bypass of ledger immutability: the platform owner
  -- chose a permanent purge. Normal retention/reversal rules are untouched.
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
  delete from public.retention_runs where false;
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
  _actor_name := coalesce(_actor_name, 'Platform owner');

  -- Platform-level record: lives outside every shop so it survives the purge.
  insert into public.platform_deletion_log
    (ecosystem_id, ecosystem_name, ecosystem_slug, actor_id, actor_name, reason, counts)
  values
    (_ecosystem_id, _eco.name, _eco.slug, _actor, _actor_name, btrim(_reason), _counts);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, _actor, _actor_name, 'Permanently deleted ecosystem',
          _eco.name || ' (/join/' || _eco.slug || ')',
          jsonb_build_object('ecosystem_id', _ecosystem_id, 'reason', btrim(_reason), 'counts', _counts));

  return jsonb_build_object('ecosystem_id', _ecosystem_id, 'name', _eco.name, 'counts', _counts);
end;
$$;

revoke all on function public.purge_ecosystem(uuid, text, text) from public;
grant execute on function public.purge_ecosystem(uuid, text, text) to authenticated, service_role;