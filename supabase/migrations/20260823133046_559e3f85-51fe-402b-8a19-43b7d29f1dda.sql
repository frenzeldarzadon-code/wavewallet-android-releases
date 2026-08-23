-- 1) Payment-requirement override (reusable, audited) -------------------------
alter table public.subscription_requests
  add column if not exists payment_override boolean not null default false,
  add column if not exists payment_override_by uuid,
  add column if not exists payment_override_at timestamptz,
  add column if not exists payment_override_reason text;

create or replace function public.override_subscription_payment(
  _ecosystem_id uuid, _reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  _actor uuid := auth.uid();
  _actor_name text;
  _req public.subscription_requests;
  _eco public.ecosystems;
  _result text;
begin
  if _actor is null or not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can override the payment requirement';
  end if;
  if coalesce(btrim(_reason), '') = '' then
    raise exception 'A reason is required for a payment override';
  end if;

  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco.id is null then raise exception 'Shop not found'; end if;

  select * into _req from public.subscription_requests
   where ecosystem_id = _ecosystem_id and status = 'pending'
   order by created_at desc limit 1;
  if _req.id is null then
    raise exception 'This shop has no payment awaiting verification to override';
  end if;

  -- Reuse the ordinary activation path so the plan, period and Coin
  -- allocation are applied exactly as a verified payment would.
  _result := public.activate_go_live_request(_req.id);
  if _result <> 'activated' then
    raise exception 'Could not activate this shop (%)', _result;
  end if;

  select coalesce(full_name, 'Platform owner') into _actor_name
    from public.profiles where id = _actor;
  _actor_name := coalesce(_actor_name, 'Platform owner');

  update public.subscription_requests
     set payment_override = true,
         payment_override_by = _actor,
         payment_override_at = now(),
         payment_override_reason = btrim(_reason),
         reviewed_by = _actor,
         reviewed_by_name = _actor_name || ' (payment override)',
         auto_state = 'override',
         auto_reason = 'Payment requirement overridden by the platform owner',
         super_review_state = 'verified',
         entitlement_hold = false
   where id = _req.id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, _actor, _actor_name,
          'Overrode subscription payment requirement', _eco.name,
          jsonb_build_object('request_id', _req.id, 'reason', btrim(_reason),
                             'plan', _req.plan_name,
                             'reference', _req.payment_reference));

  return jsonb_build_object('request_id', _req.id, 'ecosystem_id', _ecosystem_id,
                            'plan', _req.plan_name, 'overridden_by', _actor_name);
end;
$fn$;

revoke all on function public.override_subscription_payment(uuid, text) from public, anon;
grant execute on function public.override_subscription_payment(uuid, text) to authenticated, service_role;

-- 2) Outstanding member coins + shop deletion rule ----------------------------
create or replace function public.shop_deletion_check(_ecosystem_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $fn$
declare
  _actor uuid := auth.uid();
  _holders jsonb;
  _total numeric;
begin
  if _actor is null
     or not (public.is_super_admin(_actor) or public.is_ecosystem_admin(_actor, _ecosystem_id)) then
    raise exception 'Only the shop admin or the platform owner can check shop deletion';
  end if;

  -- Outstanding = coins still held by anyone in this shop other than the
  -- shop admins themselves. Coins returned to the admin are therefore not
  -- outstanding, which is exactly the rule the admin is asked to satisfy.
  select coalesce(sum(ca.balance), 0),
         coalesce(jsonb_agg(jsonb_build_object(
                    'user_id', ca.user_id,
                    'name', coalesce(p.full_name, p.handle, 'Member'),
                    'handle', p.handle,
                    'balance', ca.balance) order by ca.balance desc), '[]'::jsonb)
    into _total, _holders
    from public.credit_accounts ca
    left join public.profiles p on p.id = ca.user_id
   where ca.ecosystem_id = _ecosystem_id
     and ca.balance > 0
     and not public.is_ecosystem_admin(ca.user_id, _ecosystem_id)
     and not public.is_super_admin(ca.user_id);

  return jsonb_build_object(
    'ecosystem_id', _ecosystem_id,
    'outstanding_total', coalesce(_total, 0),
    'holders', coalesce(_holders, '[]'::jsonb),
    'can_delete', coalesce(_total, 0) = 0
  );
end;
$fn$;

revoke all on function public.shop_deletion_check(uuid) from public, anon;
grant execute on function public.shop_deletion_check(uuid) to authenticated, service_role;

alter table public.platform_deletion_log
  add column if not exists deletion_kind text not null default 'super_admin_purge',
  add column if not exists outstanding_snapshot jsonb;

create or replace function public.delete_own_shop(
  _ecosystem_id uuid, _confirm_name text, _reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  _actor uuid := auth.uid();
  _eco public.ecosystems;
  _check jsonb;
  _result jsonb;
begin
  if _actor is null
     or not (public.is_ecosystem_admin(_actor, _ecosystem_id) or public.is_super_admin(_actor)) then
    raise exception 'Only this shop''s admin can delete it';
  end if;
  if coalesce(btrim(_reason), '') = '' then
    raise exception 'A reason is required';
  end if;

  select * into _eco from public.ecosystems where id = _ecosystem_id;
  if _eco.id is null then raise exception 'Shop not found or already deleted'; end if;
  if btrim(coalesce(_confirm_name, '')) <> _eco.name then
    raise exception 'Type the shop name exactly to confirm permanent deletion';
  end if;

  -- Superseding rule: no member may still hold Coins. Coins returned to the
  -- admin count as settled; anything still sitting with a member blocks.
  _check := public.shop_deletion_check(_ecosystem_id);
  if not (_check->>'can_delete')::boolean then
    raise exception 'Members still hold % Coins in this shop. Every member balance must be zero — have those Coins returned to the shop admin first.',
      trim(to_char((_check->>'outstanding_total')::numeric, 'FM999999990.##'));
  end if;

  _result := public.purge_ecosystem_internal(_ecosystem_id, _actor, btrim(_reason),
                                             'admin_self_delete', _check);
  return _result;
end;
$fn$;

revoke all on function public.delete_own_shop(uuid, text, text) from public, anon;
grant execute on function public.delete_own_shop(uuid, text, text) to authenticated, service_role;