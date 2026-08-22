
-- Configurable notification-source filtering for listener devices.
create table if not exists public.listener_source_rules (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid references public.ecosystems(id) on delete cascade,
  device_id uuid references public.listener_devices(id) on delete cascade,
  package_name text not null,
  mode text not null check (mode in ('allow','deny')),
  provider_id text references public.payment_provider_registry(id),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists listener_source_rules_scope_pkg
  on public.listener_source_rules (
    coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(package_name));

grant select, insert, update, delete on public.listener_source_rules to authenticated;
grant all on public.listener_source_rules to service_role;
alter table public.listener_source_rules enable row level security;

drop policy if exists "listener source rules managed by owner or shop admin" on public.listener_source_rules;
create policy "listener source rules managed by owner or shop admin"
  on public.listener_source_rules for all to authenticated
  using (public.is_super_admin(auth.uid())
         or (ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), ecosystem_id)))
  with check (public.is_super_admin(auth.uid())
         or (ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), ecosystem_id)));

-- Decision for one device + package.
-- Safe default: with no rules, every source is allowed, so existing GCash
-- installations keep working untouched. Precedence, most specific first:
-- device rule > shop rule > platform rule; inside one scope an exact package
-- rule beats the '*' wildcard, and 'allow' beats 'deny'.
create or replace function public.listener_source_allowed(_device uuid, _package text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with dev as (select id, ecosystem_id from public.listener_devices where id = _device),
  ranked as (
    select r.mode,
           (case when r.device_id is not null then 3
                 when r.ecosystem_id is not null then 2 else 1 end) as scope_rank,
           (case when r.package_name = '*' then 0 else 1 end) as pkg_rank,
           (case when r.mode = 'allow' then 1 else 0 end) as mode_rank
      from public.listener_source_rules r, dev d
     where (r.package_name = '*' or lower(r.package_name) = lower(trim(coalesce(_package, ''))))
       and (r.device_id = d.id
            or (r.device_id is null and r.ecosystem_id is not null and r.ecosystem_id = d.ecosystem_id)
            or (r.device_id is null and r.ecosystem_id is null))
  )
  select coalesce(
    (select mode = 'allow' from ranked
      order by scope_rank desc, pkg_rank desc, mode_rank desc limit 1),
    true);
$$;

-- Management RPCs. Shop admins are confined to their own shop / their own devices.
create or replace function public.set_listener_source_rule(
  _package text, _mode text, _ecosystem uuid default null, _device uuid default null,
  _note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _actor uuid := auth.uid(); _super boolean; _eco uuid := _ecosystem; _row public.listener_source_rules;
begin
  _super := public.is_super_admin(_actor);
  if _device is not null then
    select ecosystem_id into _eco from public.listener_devices where id = _device;
    if not found then raise exception 'Unknown listener device'; end if;
  end if;
  if not (_super or (_eco is not null and public.is_ecosystem_admin(_actor, _eco))) then
    raise exception 'You cannot configure notification sources for this scope';
  end if;
  if _mode not in ('allow','deny') then raise exception 'Mode must be allow or deny'; end if;
  if nullif(trim(coalesce(_package,'')), '') is null then raise exception 'Give the app package name'; end if;

  insert into public.listener_source_rules (ecosystem_id, device_id, package_name, mode, note,
                                            provider_id, created_by)
  values (_eco, _device, lower(trim(_package)), _mode, nullif(trim(coalesce(_note,'')), ''),
          public.payment_provider_for(lower(trim(_package)), null), _actor)
  on conflict (coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid),
               lower(package_name))
  do update set mode = excluded.mode, note = excluded.note, updated_at = now(), created_by = _actor
  returning * into _row;

  return to_jsonb(_row);
end $$;

create or replace function public.delete_listener_source_rule(_rule uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare _actor uuid := auth.uid(); _row public.listener_source_rules;
begin
  select * into _row from public.listener_source_rules where id = _rule;
  if not found then return false; end if;
  if not (public.is_super_admin(_actor)
          or (_row.ecosystem_id is not null and public.is_ecosystem_admin(_actor, _row.ecosystem_id))) then
    raise exception 'You cannot change notification sources for this scope';
  end if;
  delete from public.listener_source_rules where id = _rule;
  return true;
end $$;

create or replace function public.listener_source_rules_list(_ecosystem uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare _actor uuid := auth.uid(); _super boolean;
begin
  _super := public.is_super_admin(_actor);
  if not (_super or (_ecosystem is not null and public.is_ecosystem_admin(_actor, _ecosystem))) then
    raise exception 'You cannot read notification sources for this scope';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'ecosystem_id', r.ecosystem_id, 'ecosystem_name', e.name,
      'device_id', r.device_id, 'device_label', d.label,
      'package_name', r.package_name, 'mode', r.mode, 'provider_id', r.provider_id,
      'note', r.note, 'created_at', r.created_at, 'updated_at', r.updated_at)
      order by r.created_at desc)
      from public.listener_source_rules r
      left join public.ecosystems e on e.id = r.ecosystem_id
      left join public.listener_devices d on d.id = r.device_id
     where _super
        or r.ecosystem_id = _ecosystem
        or exists (select 1 from public.listener_devices x
                    where x.id = r.device_id and x.ecosystem_id = _ecosystem)), '[]'::jsonb);
end $$;

grant execute on function public.listener_source_allowed(uuid, text) to authenticated, service_role;
grant execute on function public.set_listener_source_rule(text, text, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.delete_listener_source_rule(uuid) to authenticated, service_role;
grant execute on function public.listener_source_rules_list(uuid) to authenticated, service_role;
