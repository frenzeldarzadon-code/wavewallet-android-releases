
-- ROLES ENUM
create type public.app_role as enum ('super_admin', 'admin', 'reseller', 'customer');
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'suspended', 'cancelled');
create type public.account_status as enum ('active', 'suspended');

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- ECOSYSTEMS
create table public.ecosystems (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  contact_email text,
  contact_phone text,
  signup_enabled boolean not null default true,
  signup_token text not null default encode(gen_random_bytes(9), 'hex'),
  subscription_status public.subscription_status not null default 'trial',
  plan_name text not null default 'Starter',
  plan_price numeric(12,2) not null default 0,
  subscription_active_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.ecosystems to anon;
grant select, insert, update, delete on public.ecosystems to authenticated;
grant all on public.ecosystems to service_role;
alter table public.ecosystems enable row level security;
create trigger ecosystems_updated_at before update on public.ecosystems
  for each row execute function public.set_updated_at();

-- PROFILES
create table public.profiles (
  id uuid primary key,
  ecosystem_id uuid references public.ecosystems(id) on delete set null,
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  status public.account_status not null default 'active',
  reseller_discount_percent integer not null default 0
    check (reseller_discount_percent between 0 and 50),
  reseller_id uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_ecosystem_idx on public.profiles(ecosystem_id);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- USER ROLES
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  ecosystem_id uuid references public.ecosystems(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
create index user_roles_user_idx on public.user_roles(user_id);
grant select, insert, update, delete on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

-- AUDIT LOGS
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid references public.ecosystems(id) on delete cascade,
  actor_id uuid,
  actor_name text not null default '',
  action text not null,
  target text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_ecosystem_idx on public.audit_logs(ecosystem_id, created_at desc);
grant select, insert on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;

-- BOOTSTRAP ALLOWLIST (email -> privileged role, applied on first sign-up)
create table public.bootstrap_roles (
  email text primary key,
  role public.app_role not null,
  ecosystem_id uuid references public.ecosystems(id) on delete cascade,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.bootstrap_roles to authenticated;
grant all on public.bootstrap_roles to service_role;
alter table public.bootstrap_roles enable row level security;

-- SECURITY DEFINER HELPERS
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.is_super_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = 'super_admin');
$$;

create or replace function public.current_ecosystem(_user_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select ecosystem_id from public.profiles where id = _user_id;
$$;

create or replace function public.is_ecosystem_admin(_user_id uuid, _ecosystem_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = 'admin' and ecosystem_id = _ecosystem_id
  );
$$;

-- POLICIES: ecosystems
create policy "Public can read shops with an active signup link"
  on public.ecosystems for select to anon using (signup_enabled);
create policy "Members can read their own ecosystem"
  on public.ecosystems for select to authenticated
  using (id = public.current_ecosystem(auth.uid()) or public.is_super_admin(auth.uid()) or signup_enabled);
create policy "Admins can update their ecosystem"
  on public.ecosystems for update to authenticated
  using (public.is_ecosystem_admin(auth.uid(), id) or public.is_super_admin(auth.uid()))
  with check (public.is_ecosystem_admin(auth.uid(), id) or public.is_super_admin(auth.uid()));
create policy "Super admins manage ecosystems"
  on public.ecosystems for insert to authenticated
  with check (public.is_super_admin(auth.uid()));
create policy "Super admins delete ecosystems"
  on public.ecosystems for delete to authenticated
  using (public.is_super_admin(auth.uid()));

-- POLICIES: profiles
create policy "Read own profile"
  on public.profiles for select to authenticated using (id = auth.uid());
create policy "Admins read profiles in their ecosystem"
  on public.profiles for select to authenticated
  using (ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), ecosystem_id));
create policy "Super admins read all profiles"
  on public.profiles for select to authenticated using (public.is_super_admin(auth.uid()));
create policy "Insert own profile"
  on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Update own profile"
  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Admins update profiles in their ecosystem"
  on public.profiles for update to authenticated
  using (ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), ecosystem_id))
  with check (ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), ecosystem_id));
create policy "Super admins update all profiles"
  on public.profiles for update to authenticated
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- POLICIES: user_roles
create policy "Read own roles"
  on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "Admins read roles in their ecosystem"
  on public.user_roles for select to authenticated
  using (ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), ecosystem_id));
create policy "Super admins read all roles"
  on public.user_roles for select to authenticated using (public.is_super_admin(auth.uid()));
create policy "Admins grant customer or reseller roles in their ecosystem"
  on public.user_roles for insert to authenticated
  with check (
    role in ('customer','reseller')
    and ecosystem_id is not null
    and public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );
create policy "Admins remove customer or reseller roles in their ecosystem"
  on public.user_roles for delete to authenticated
  using (
    role in ('customer','reseller')
    and ecosystem_id is not null
    and public.is_ecosystem_admin(auth.uid(), ecosystem_id)
  );
create policy "Super admins insert roles"
  on public.user_roles for insert to authenticated with check (public.is_super_admin(auth.uid()));
create policy "Super admins update roles"
  on public.user_roles for update to authenticated
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "Super admins delete roles"
  on public.user_roles for delete to authenticated using (public.is_super_admin(auth.uid()));

-- POLICIES: audit_logs
create policy "Admins read audit logs in their ecosystem"
  on public.audit_logs for select to authenticated
  using (ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), ecosystem_id));
create policy "Super admins read all audit logs"
  on public.audit_logs for select to authenticated using (public.is_super_admin(auth.uid()));
create policy "Authenticated can write audit entries as themselves"
  on public.audit_logs for insert to authenticated with check (actor_id = auth.uid());

-- POLICIES: bootstrap_roles (super admin only visibility)
create policy "Super admins read bootstrap roles"
  on public.bootstrap_roles for select to authenticated using (public.is_super_admin(auth.uid()));

-- NEW USER HANDLER: creates profile + customer role, honouring the invite ecosystem
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _eco uuid;
  _boot public.bootstrap_roles%rowtype;
begin
  select id into _eco from public.ecosystems
  where slug = lower(nullif(new.raw_user_meta_data->>'ecosystem_slug',''))
    and signup_enabled;

  select * into _boot from public.bootstrap_roles
  where email = lower(new.email) and consumed_at is null;

  if _boot.email is not null then
    _eco := coalesce(_boot.ecosystem_id, _eco);
  end if;

  insert into public.profiles (id, ecosystem_id, full_name, email, phone)
  values (
    new.id,
    _eco,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  );

  if _boot.email is not null then
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (new.id, _boot.role, case when _boot.role = 'super_admin' then null else _eco end)
    on conflict do nothing;
    update public.bootstrap_roles set consumed_at = now() where email = _boot.email;
  else
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (new.id, 'customer', _eco)
    on conflict do nothing;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_eco, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
          'Account created', coalesce(new.email, ''));

  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- PROMOTION RPC: customer -> reseller, preserves the account row and history
create or replace function public.promote_to_reseller(_user_id uuid, _discount integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  _eco uuid;
  _actor_name text;
begin
  select ecosystem_id into _eco from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Customer not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _discount < 0 or _discount > 50 then raise exception 'Discount must be between 0 and 50'; end if;
  if not exists (select 1 from public.user_roles where user_id = _user_id and role = 'customer') then
    raise exception 'Only customers can be promoted to reseller';
  end if;

  delete from public.user_roles where user_id = _user_id and role = 'customer';
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_user_id, 'reseller', _eco) on conflict do nothing;

  update public.profiles
     set reseller_discount_percent = _discount, reseller_id = null
   where id = _user_id;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          'Promoted customer to reseller',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_role','customer','new_role','reseller','discount_percent',_discount));
end; $$;

create or replace function public.set_reseller_discount(_user_id uuid, _discount integer)
returns void language plpgsql security definer set search_path = public as $$
declare _eco uuid; _prev integer; _actor_name text;
begin
  select ecosystem_id, reseller_discount_percent into _eco, _prev from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Reseller not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _discount < 0 or _discount > 50 then raise exception 'Discount must be between 0 and 50'; end if;
  update public.profiles set reseller_discount_percent = _discount where id = _user_id;
  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'), 'Updated reseller discount',
          (select full_name from public.profiles where id = _user_id),
          jsonb_build_object('previous_percent',_prev,'new_percent',_discount));
end; $$;

-- Public lookup of a signup link target (safe columns only)
create or replace function public.get_signup_ecosystem(_slug text)
returns table (id uuid, name text, slug text, description text)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.slug, e.description
  from public.ecosystems e
  where lower(e.slug) = lower(_slug) and e.signup_enabled;
$$;
grant execute on function public.get_signup_ecosystem(text) to anon, authenticated;

create or replace function public.regenerate_signup_token(_ecosystem_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare _token text; _actor_name text;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  _token := encode(gen_random_bytes(9), 'hex');
  update public.ecosystems set signup_token = _token where id = _ecosystem_id;
  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_ecosystem_id, auth.uid(), coalesce(_actor_name,'Admin'), 'Regenerated customer signup link', '');
  return _token;
end; $$;

-- DEMO ECOSYSTEMS
insert into public.ecosystems (name, slug, description, contact_email, subscription_status, plan_name, plan_price, subscription_active_until)
values
  ('Sagada Wave', 'sagada-wave', 'Hotspot vouchers, credits and rewards for the Sagada highlands.', 'hello@sagadawave.ph', 'active', 'Growth', 1499, now() + interval '60 days'),
  ('Highland Link', 'highland-link', 'Community WiFi for the mountain province.', 'support@highlandlink.ph', 'trial', 'Starter', 0, now() + interval '14 days'),
  ('Coastal Net', 'coastal-net', 'Beachfront hotspot vouchers and prepaid credits.', 'team@coastalnet.ph', 'past_due', 'Growth', 1499, now() - interval '5 days');
