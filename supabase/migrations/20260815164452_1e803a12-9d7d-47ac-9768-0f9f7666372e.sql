-- Listener readiness reporting + safety gate for listener-required auto approval
create or replace function public.cash_in_auto_status()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare _actor uuid := auth.uid();
begin
  if not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner can read the cash in matching status';
  end if;
  return jsonb_build_object(
    'platform_rule', (select to_jsonb(r) from public.cash_in_auto_rules r where r.ecosystem_id is null),
    'shop_rules', coalesce((select jsonb_agg(jsonb_build_object(
        'ecosystem_id', r.ecosystem_id, 'ecosystem_name', e.name, 'enabled', r.enabled,
        'require_reference_match', r.require_reference_match,
        'require_listener_match', r.require_listener_match,
        'amount_tolerance_php', r.amount_tolerance_php, 'max_auto_amount_php', r.max_auto_amount_php,
        'expected_amount_php', r.expected_amount_php)
        order by e.name)
      from public.cash_in_auto_rules r join public.ecosystems e on e.id = r.ecosystem_id), '[]'::jsonb),
    'shops_with_number', (select count(*) from public.ecosystems
                           where nullif(trim(cash_in_gcash_number), '') is not null),
    'listener_devices_active', (select count(*) from public.listener_devices where status = 'active'),
    'listener_devices_proven', (select count(*) from public.listener_devices
                                 where status = 'active' and last_event_at is not null),
    'listener_matches_30d', (select count(*) from public.listener_events
                              where consumed_cash_in_id is not null
                                and created_at > now() - interval '30 days'),
    'listener_last_event_at', (select max(last_event_at) from public.listener_devices where status = 'active'),
    'duplicates_blocked_30d', (select count(*) from public.cash_in_requests
                                where status = 'rejected'
                                  and decision_reason like 'Duplicate payment reference%'
                                  and created_at > now() - interval '30 days'),
    'auto_approved_30d', (select count(*) from public.cash_in_requests
                           where approval_method = 'automatic' and status = 'approved'
                             and reviewed_at > now() - interval '30 days')
  );
end $function$;

-- Refuse to demand listener corroboration before a paired device has actually
-- delivered at least one notification: otherwise every cash in would stall.
create or replace function public.guard_require_listener()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.require_listener_match, false)
     and coalesce(old.require_listener_match, false) is distinct from true then
    if not exists (
      select 1 from public.listener_devices d
       where d.status = 'active' and d.last_event_at is not null
         and (new.ecosystem_id is null or d.ecosystem_id is null or d.ecosystem_id = new.ecosystem_id)
    ) then
      raise exception 'Pair a listener device and receive at least one test notification before requiring listener confirmation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_require_listener on public.cash_in_auto_rules;
create trigger trg_guard_require_listener
before insert or update on public.cash_in_auto_rules
for each row execute function public.guard_require_listener();

-- Safety: make sure nothing is currently demanding listener confirmation.
update public.cash_in_auto_rules set require_listener_match = false
 where require_listener_match
   and not exists (select 1 from public.listener_devices d
                    where d.status = 'active' and d.last_event_at is not null);