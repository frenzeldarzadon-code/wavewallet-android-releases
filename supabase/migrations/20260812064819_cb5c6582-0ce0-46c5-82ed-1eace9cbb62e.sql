-- =========================================================
-- SUBSCRIPTION LIFECYCLE
-- =========================================================
create type public.subscription_state as enum (
  'pending', 'awaiting_approval', 'active', 'rejected', 'expired', 'suspended'
);

alter table public.ecosystems
  add column subscription_state public.subscription_state not null default 'pending',
  add column grace_period_days integer not null default 5,
  add column current_period_end timestamptz,
  add column payment_reference text,
  add column submitted_at timestamptz,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid;

update public.ecosystems
set subscription_state = case
      when subscription_status::text = 'active' then 'active'::public.subscription_state
      when subscription_status::text = 'trial' then 'active'::public.subscription_state
      when subscription_status::text = 'past_due' then 'expired'::public.subscription_state
      when subscription_status::text = 'suspended' then 'suspended'::public.subscription_state
      when subscription_status::text = 'cancelled' then 'expired'::public.subscription_state
      else 'pending'::public.subscription_state
    end,
    current_period_end = subscription_active_until;

alter table public.ecosystems drop column subscription_status;
alter table public.ecosystems drop column subscription_active_until;
drop type public.subscription_status;

-- Is this ecosystem allowed to run normal operations?
create or replace function public.subscription_ok(_ecosystem_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ecosystems e
    where e.id = _ecosystem_id
      and e.subscription_state = 'active'
      and (e.current_period_end is null
           or e.current_period_end + make_interval(days => e.grace_period_days) > now())
  );
$$;
grant execute on function public.subscription_ok(uuid) to authenticated;

-- Super-admin review of a subscription, always audit-logged.
create or replace function public.review_subscription(
  _ecosystem_id uuid,
  _state public.subscription_state,
  _period_end timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare _actor text; _prev public.subscription_state;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can review subscriptions';
  end if;
  select subscription_state into _prev from public.ecosystems where id = _ecosystem_id;
  update public.ecosystems
     set subscription_state = _state,
         current_period_end = coalesce(_period_end, current_period_end),
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = _ecosystem_id;
  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Super admin'),
          'Subscription ' || coalesce(_prev::text, 'unknown') || ' -> ' || _state::text, '');
end; $$;
grant execute on function public.review_subscription(uuid, public.subscription_state, timestamptz) to authenticated;

-- Admin submits payment proof for review.
create or replace function public.submit_subscription_payment(_ecosystem_id uuid, _reference text)
returns void language plpgsql security definer set search_path = public as $$
declare _actor text;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  update public.ecosystems
     set subscription_state = 'awaiting_approval',
         payment_reference = _reference,
         submitted_at = now()
   where id = _ecosystem_id;
  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Admin'), 'Submitted subscription payment for review', coalesce(_reference, ''));
end; $$;
grant execute on function public.submit_subscription_payment(uuid, text) to authenticated;

-- =========================================================
-- TENANT BINDING: non super admins belong to exactly one ecosystem
-- =========================================================
create or replace function public.enforce_role_tenant()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.role = 'super_admin' then
    new.ecosystem_id := null;
  elsif new.ecosystem_id is null then
    new.ecosystem_id := (select ecosystem_id from public.profiles where id = new.user_id);
    if new.ecosystem_id is null then
      raise exception 'Role % requires an ecosystem', new.role;
    end if;
  end if;
  return new;
end; $$;

create trigger user_roles_enforce_tenant
  before insert or update on public.user_roles
  for each row execute function public.enforce_role_tenant();

-- =========================================================
-- MEMBERSHIPS (read model over profiles + roles)
-- =========================================================
create view public.ecosystem_memberships
with (security_invoker = true) as
  select r.user_id,
         r.ecosystem_id,
         r.role,
         p.full_name,
         p.email,
         p.phone,
         p.status,
         p.reseller_discount_percent,
         p.joined_at
  from public.user_roles r
  join public.profiles p on p.id = r.user_id;

grant select on public.ecosystem_memberships to authenticated;
grant all on public.ecosystem_memberships to service_role;

-- =========================================================
-- CREDIT WALLETS + IMMUTABLE LEDGER
-- =========================================================
create table public.credit_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.credit_accounts to authenticated;
grant all on public.credit_accounts to service_role;
alter table public.credit_accounts enable row level security;

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.credit_accounts(id) on delete cascade,
  user_id uuid not null,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  direction text not null check (direction in ('credit','debit')),
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null,
  reason text not null,
  reference text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
grant select on public.credit_ledger to authenticated;
grant all on public.credit_ledger to service_role;
alter table public.credit_ledger enable row level security;
create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
create index credit_ledger_ecosystem_idx on public.credit_ledger (ecosystem_id, created_at desc);

-- =========================================================
-- POINTS WALLETS + LEDGER
-- =========================================================
create table public.points_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  balance integer not null default 0,
  held integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.points_accounts to authenticated;
grant all on public.points_accounts to service_role;
alter table public.points_accounts enable row level security;

create table public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.points_accounts(id) on delete cascade,
  user_id uuid not null,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  direction text not null check (direction in ('credit','debit')),
  amount integer not null check (amount > 0),
  balance_after integer not null,
  reason text not null,
  reference text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
grant select on public.points_ledger to authenticated;
grant all on public.points_ledger to service_role;
alter table public.points_ledger enable row level security;
create index points_ledger_user_idx on public.points_ledger (user_id, created_at desc);
create index points_ledger_ecosystem_idx on public.points_ledger (ecosystem_id, created_at desc);

-- Ledgers are append-only: no updates, no deletes, ever.
create or replace function public.block_ledger_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Ledger entries are immutable';
end; $$;

create trigger credit_ledger_immutable
  before update or delete on public.credit_ledger
  for each row execute function public.block_ledger_mutation();
create trigger points_ledger_immutable
  before update or delete on public.points_ledger
  for each row execute function public.block_ledger_mutation();

-- Balances are a projection of the ledger, never written directly by clients.
create or replace function public.apply_credit_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare _bal numeric(14,2);
begin
  select balance into _bal from public.credit_accounts where id = new.account_id for update;
  if _bal is null then raise exception 'Credit account not found'; end if;
  _bal := _bal + case when new.direction = 'credit' then new.amount else -new.amount end;
  if _bal < 0 then raise exception 'Insufficient credits'; end if;
  update public.credit_accounts set balance = _bal, updated_at = now() where id = new.account_id;
  new.balance_after := _bal;
  return new;
end; $$;

create trigger credit_ledger_apply
  before insert on public.credit_ledger
  for each row execute function public.apply_credit_entry();

create or replace function public.apply_points_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare _bal integer;
begin
  select balance into _bal from public.points_accounts where id = new.account_id for update;
  if _bal is null then raise exception 'Points account not found'; end if;
  _bal := _bal + case when new.direction = 'credit' then new.amount else -new.amount end;
  if _bal < 0 then raise exception 'Insufficient points'; end if;
  update public.points_accounts set balance = _bal, updated_at = now() where id = new.account_id;
  new.balance_after := _bal;
  return new;
end; $$;

create trigger points_ledger_apply
  before insert on public.points_ledger
  for each row execute function public.apply_points_entry();

-- Wallets are provisioned automatically for every ecosystem member.
create or replace function public.ensure_wallets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ecosystem_id is not null then
    insert into public.credit_accounts (user_id, ecosystem_id)
    values (new.id, new.ecosystem_id) on conflict (user_id) do nothing;
    insert into public.points_accounts (user_id, ecosystem_id)
    values (new.id, new.ecosystem_id) on conflict (user_id) do nothing;
  end if;
  return new;
end; $$;

create trigger profiles_ensure_wallets
  after insert or update of ecosystem_id on public.profiles
  for each row execute function public.ensure_wallets();

insert into public.credit_accounts (user_id, ecosystem_id)
  select id, ecosystem_id from public.profiles where ecosystem_id is not null
  on conflict (user_id) do nothing;
insert into public.points_accounts (user_id, ecosystem_id)
  select id, ecosystem_id from public.profiles where ecosystem_id is not null
  on conflict (user_id) do nothing;

-- Wallet policies: own wallet, ecosystem admins, super admins.
create policy "Read own credit account" on public.credit_accounts
  for select to authenticated using (user_id = auth.uid());
create policy "Admins read ecosystem credit accounts" on public.credit_accounts
  for select to authenticated
  using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create policy "Read own credit ledger" on public.credit_ledger
  for select to authenticated using (user_id = auth.uid());
create policy "Admins read ecosystem credit ledger" on public.credit_ledger
  for select to authenticated
  using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create policy "Read own points account" on public.points_accounts
  for select to authenticated using (user_id = auth.uid());
create policy "Admins read ecosystem points accounts" on public.points_accounts
  for select to authenticated
  using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

create policy "Read own points ledger" on public.points_ledger
  for select to authenticated using (user_id = auth.uid());
create policy "Admins read ecosystem points ledger" on public.points_ledger
  for select to authenticated
  using (public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));

-- =========================================================
-- ADMIN INVITATIONS
-- =========================================================
create table public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ecosystem_id uuid references public.ecosystems(id) on delete cascade,
  role public.app_role not null default 'admin',
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid,
  invited_by_name text,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index admin_invitations_pending_email_idx
  on public.admin_invitations (lower(email)) where status = 'pending';
grant select on public.admin_invitations to authenticated;
grant all on public.admin_invitations to service_role;
alter table public.admin_invitations enable row level security;

create policy "Super admins read invitations" on public.admin_invitations
  for select to authenticated using (public.is_super_admin(auth.uid()));

create or replace function public.invite_admin(
  _email text,
  _ecosystem_id uuid,
  _role public.app_role default 'admin'
) returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid; _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can invite operators';
  end if;
  if _role not in ('admin','super_admin') then
    raise exception 'Only admin or super admin invitations are supported here';
  end if;
  if _role = 'admin' and _ecosystem_id is null then
    raise exception 'An admin invitation must target one ecosystem';
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();

  update public.admin_invitations
     set status = 'revoked'
   where lower(email) = lower(_email) and status = 'pending';

  insert into public.admin_invitations (email, ecosystem_id, role, invited_by, invited_by_name)
  values (lower(_email), case when _role = 'super_admin' then null else _ecosystem_id end,
          _role, auth.uid(), coalesce(_actor, 'Super admin'))
  returning id into _id;

  -- Grant on first sign-up through the existing allowlist path.
  delete from public.bootstrap_roles where email = lower(_email) and consumed_at is null;
  insert into public.bootstrap_roles (email, role, ecosystem_id)
  values (lower(_email), _role, case when _role = 'super_admin' then null else _ecosystem_id end);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Super admin'),
          'Invited ' || _role::text, lower(_email));
  return _id;
end; $$;
grant execute on function public.invite_admin(text, uuid, public.app_role) to authenticated;

create or replace function public.revoke_admin_invitation(_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _email text; _eco uuid; _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can revoke invitations';
  end if;
  select email, ecosystem_id into _email, _eco from public.admin_invitations where id = _id;
  update public.admin_invitations set status = 'revoked' where id = _id and status = 'pending';
  delete from public.bootstrap_roles where email = _email and consumed_at is null;
  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_eco, auth.uid(), coalesce(_actor, 'Super admin'), 'Revoked operator invitation', coalesce(_email, ''));
end; $$;
grant execute on function public.revoke_admin_invitation(uuid) to authenticated;

-- Mark invitations accepted when the invited person signs up.
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
    update public.admin_invitations
       set status = 'accepted', accepted_at = now()
     where lower(email) = lower(new.email) and status = 'pending';
  else
    if _eco is null then
      raise exception 'Sign-up requires a valid ecosystem invite link';
    end if;
    insert into public.user_roles (user_id, role, ecosystem_id)
    values (new.id, 'customer', _eco)
    on conflict do nothing;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_eco, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
          'Account created', coalesce(new.email, ''));

  return new;
end; $$;

-- Expire stale invitations on read paths.
create or replace function public.expire_stale_invitations()
returns void language sql security definer set search_path = public as $$
  update public.admin_invitations
     set status = 'expired'
   where status = 'pending' and expires_at < now();
$$;
grant execute on function public.expire_stale_invitations() to authenticated;