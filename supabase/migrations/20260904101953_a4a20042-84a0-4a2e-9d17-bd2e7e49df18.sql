create or replace function public.platform_cash_in_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare _actor uuid := auth.uid(); _rule public.cash_in_auto_rules;
begin
  if _actor is null or not exists (
      select 1 from public.profiles p where p.id = _actor and p.status = 'active') then
    raise exception 'Sign in to read the platform cash in status';
  end if;
  select * into _rule from public.cash_in_auto_rules where ecosystem_id is null;
  return jsonb_build_object(
    'auto_enabled', coalesce(_rule.enabled, false),
    'require_listener_match', coalesce(_rule.require_listener_match, true),
    'max_auto_amount_php', _rule.max_auto_amount_php,
    'methods', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'method_type', m.method_type,
        'account_tail', right(regexp_replace(coalesce(m.account_number, ''), '\D', '', 'g'), 4),
        'listener_watching', exists (
          select 1 from public.listener_devices d
           where d.status = 'active' and d.ecosystem_id is null
             and d.receiving_number_key is not null
             and d.receiving_number_key = public.normalize_ph_mobile(m.account_number)),
        'listener_online', exists (
          select 1 from public.listener_devices d
           where d.status = 'active' and d.ecosystem_id is null
             and d.receiving_number_key = public.normalize_ph_mobile(m.account_number)
             and d.last_seen_at > now() - make_interval(mins => d.offline_after_minutes)
             and coalesce(d.listener_connected, true)
             and coalesce(d.notification_access, true))
      ) order by m.sort_order, m.name)
      from public.payment_methods m
     where m.ecosystem_id is null and m.active), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.platform_cash_in_readiness() from public, anon;
grant execute on function public.platform_cash_in_readiness() to authenticated, service_role;