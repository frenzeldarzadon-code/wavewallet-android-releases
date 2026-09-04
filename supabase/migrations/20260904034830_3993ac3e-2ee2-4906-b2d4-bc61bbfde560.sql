-- Single definition of "online" for the whole app (heartbeat is every 60s while the app is visible).
create or replace function public.presence_online_window()
returns interval language sql immutable as $$ select interval '2 minutes' $$;
revoke all on function public.presence_online_window() from public, anon;
grant execute on function public.presence_online_window() to authenticated, service_role;

drop function if exists public.universe_sellers_for_shop(text);
create or replace function public.universe_sellers_for_shop(_slug text)
 returns table(seller_id uuid, seller_name text, seller_handle text, avatar_path text, store_name text,
               online boolean, last_seen_at timestamptz)
 language sql stable security definer set search_path to 'public' as $function$
  select p.id, p.full_name, p.handle, p.avatar_path,
         coalesce(nullif(btrim(p.preferences->>'storefront_name'), ''), p.full_name || '''s Store'),
         coalesce(mp.last_seen_at > now() - public.presence_online_window(), false) as online,
         -- coarse (minute) precision only; never expose exact activity timestamps
         date_trunc('minute', mp.last_seen_at) as last_seen_at
    from public.ecosystems e
    join public.shop_seller_authorizations a on a.ecosystem_id = e.id and a.active
    join public.profiles p on p.id = a.user_id and p.deleted_at is null and p.status = 'active' and p.handle is not null
    left join public.member_presence mp on mp.user_id = p.id
   where e.slug = _slug and e.shop_kind = 'universe' and e.archived_at is null
     and e.frozen_at is null and not coalesce(e.operations_frozen, false)
     and e.public_storefront_enabled and e.store_voucher_enabled
     and (not e.is_test or public.can_see_test_shop(e.id))
   order by (coalesce(mp.last_seen_at > now() - public.presence_online_window(), false)) desc,
            mp.last_seen_at desc nulls last,
            p.full_name;
$function$;
revoke all on function public.universe_sellers_for_shop(text) from public;
grant execute on function public.universe_sellers_for_shop(text) to anon, authenticated, service_role;