alter table public.notification_preferences
  add column if not exists push_show_details boolean not null default true;

-- 3-arg setter; the old 2-arg one keeps working and preserves the detail flag.
create or replace function public.set_notification_preferences(
  _disabled_kinds text[], _push_enabled boolean, _push_show_details boolean
) returns void language sql security definer set search_path to 'public' as $$
  insert into public.notification_preferences (user_id, disabled_kinds, push_enabled, push_show_details)
  values (auth.uid(), coalesce(_disabled_kinds, '{}'), coalesce(_push_enabled, false), coalesce(_push_show_details, true))
  on conflict (user_id) do update
    set disabled_kinds = excluded.disabled_kinds,
        push_enabled = excluded.push_enabled,
        push_show_details = excluded.push_show_details,
        updated_at = now();
$$;
revoke execute on function public.set_notification_preferences(text[], boolean, boolean) from public, anon;
grant execute on function public.set_notification_preferences(text[], boolean, boolean) to authenticated;

create or replace function public.set_notification_preferences(
  _disabled_kinds text[], _push_enabled boolean
) returns void language sql security definer set search_path to 'public' as $$
  insert into public.notification_preferences (user_id, disabled_kinds, push_enabled)
  values (auth.uid(), coalesce(_disabled_kinds, '{}'), coalesce(_push_enabled, false))
  on conflict (user_id) do update
    set disabled_kinds = excluded.disabled_kinds,
        push_enabled = excluded.push_enabled,
        updated_at = now();
$$;

drop function if exists public.claim_push_deliveries(integer);
create or replace function public.claim_push_deliveries(_limit integer default 50)
returns table(delivery_id uuid, notification_id uuid, device_id uuid, user_id uuid,
              endpoint text, p256dh text, auth_secret text,
              kind text, category text, title text, body text, link text,
              created_at timestamptz, ecosystem_id uuid, show_details boolean)
language plpgsql security definer set search_path to 'public' as $$
begin
  update public.notification_deliveries d
     set status = 'pending', updated_at = now()
   where d.status = 'sending' and d.updated_at < now() - interval '10 minutes';
  update public.notification_deliveries d
     set status = 'expired', reason = 'stale', updated_at = now()
   where d.status = 'pending' and d.created_at < now() - interval '24 hours';

  return query
  with picked as (
    select d.id
      from public.notification_deliveries d
      join public.push_devices pd on pd.id = d.device_id
     where d.status = 'pending' and pd.expired_at is null and pd.push_enabled
     order by d.created_at
     limit greatest(1, least(coalesce(_limit, 50), 200))
     for update of d skip locked
  ), marked as (
    update public.notification_deliveries d
       set status = 'sending', updated_at = now()
      from picked
     where d.id = picked.id
    returning d.id, d.notification_id, d.device_id, d.user_id, d.created_at
  )
  select m.id, m.notification_id, m.device_id, m.user_id,
         pd.endpoint, pd.p256dh, pd.auth_secret,
         n.kind, n.category, n.title, n.body, n.link, m.created_at,
         n.ecosystem_id,
         coalesce((select p.push_show_details from public.notification_preferences p where p.user_id = m.user_id), true)
    from marked m
    join public.push_devices pd on pd.id = m.device_id
    join public.member_notifications n on n.id = m.notification_id;
end $$;
revoke execute on function public.claim_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_push_deliveries(integer) to service_role;

-- Post gifts: the ledger writes credit/debit, never 'in'.
create or replace function public.tg_notify_social_gift()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _link text;
begin
  if NEW.direction = 'credit' and coalesce(NEW.source,'') ilike '%gift%' then
    _link := case when NEW.reference ~ '^[0-9a-f-]{36}$' then '/universe?post=' || NEW.reference else '/universe' end;
    perform public.notify_universe(NEW.user_id, 'social_gift', 'You received a gift',
      coalesce(NEW.reason, 'Gift from a member') || ' — ' || NEW.amount::text || ' social credits on your post', _link);
  end if;
  return NEW;
end $$;