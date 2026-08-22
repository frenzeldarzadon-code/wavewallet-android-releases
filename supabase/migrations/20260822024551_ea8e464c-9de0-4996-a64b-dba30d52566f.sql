alter table public.ecosystems
  add column if not exists use_platform_payment_methods boolean not null default false;

-- Backfill: legacy shops keep working exactly as before the consolidation,
-- where the platform-wide receiving account was the only one members ever saw.
update public.ecosystems
   set use_platform_payment_methods = true
 where shop_kind is distinct from 'subscription';

create or replace function public.ecosystem_platform_payment_option(_ecosystem uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'enabled', coalesce(e.use_platform_payment_methods, false),
    'legacy', e.shop_kind is distinct from 'subscription',
    'can_change', public.is_super_admin(auth.uid())
      or (public.is_ecosystem_admin(auth.uid(), e.id) and e.shop_kind is distinct from 'subscription')
  )
  from public.ecosystems e
  where e.id = _ecosystem
$$;

revoke execute on function public.ecosystem_platform_payment_option(uuid) from anon;
grant execute on function public.ecosystem_platform_payment_option(uuid) to authenticated;

create or replace function public.set_ecosystem_platform_payment_methods(_ecosystem uuid, _enabled boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare _actor uuid := auth.uid(); _kind text;
begin
  select shop_kind into _kind from public.ecosystems where id = _ecosystem;
  if _kind is null then raise exception 'Shop not found'; end if;

  if not (
    public.is_super_admin(_actor)
    or (public.is_ecosystem_admin(_actor, _ecosystem) and _kind is distinct from 'subscription')
  ) then
    raise exception 'You cannot change the customer payment source for this shop';
  end if;

  update public.ecosystems
     set use_platform_payment_methods = coalesce(_enabled, false), updated_at = now()
   where id = _ecosystem;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem, _actor,
          coalesce((select full_name from public.profiles where id = _actor), 'Operator'),
          case when _enabled then 'Enabled platform payment methods for cash in'
               else 'Disabled platform payment methods for cash in' end,
          coalesce((select name from public.ecosystems where id = _ecosystem), 'Shop'),
          jsonb_build_object('enabled', coalesce(_enabled, false), 'shop_kind', _kind));

  return coalesce(_enabled, false);
end $$;

revoke execute on function public.set_ecosystem_platform_payment_methods(uuid, boolean) from anon;
grant execute on function public.set_ecosystem_platform_payment_methods(uuid, boolean) to authenticated;