-- 1. Membership view runs with the caller's own permissions, so profiles/user_roles RLS applies.
alter view public.ecosystem_memberships set (security_invoker = true);
revoke all on public.ecosystem_memberships from anon;
grant select on public.ecosystem_memberships to authenticated;

-- 2. Profiles: nobody but a platform owner may move an account between ecosystems,
--    and a member may not edit their own privileged fields.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id <> old.id then
    raise exception 'A profile id cannot be reassigned';
  end if;

  if new.ecosystem_id is distinct from old.ecosystem_id
     and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can move an account to another ecosystem';
  end if;

  if auth.uid() = new.id and not public.is_super_admin(auth.uid()) then
    new.reseller_discount_percent := old.reseller_discount_percent;
    new.reseller_id := old.reseller_id;
    new.status := old.status;
  end if;

  return new;
end;
$$;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
before update on public.profiles
for each row execute function public.guard_profile_update();

-- Roles are never client-writable outside the audited RPCs.
drop policy if exists "Admins grant customer or reseller roles in their ecosystem" on public.user_roles;
drop policy if exists "Admins remove customer or reseller roles in their ecosystem" on public.user_roles;
revoke insert, update, delete on public.user_roles from authenticated;

-- 3. Wallets and ledgers: read-only for every client; writes only inside SECURITY DEFINER code.
revoke insert, update, delete on public.credit_accounts from authenticated, anon;
revoke insert, update, delete on public.points_accounts from authenticated, anon;
revoke insert, update, delete on public.credit_ledger from authenticated, anon;
revoke insert, update, delete on public.points_ledger from authenticated, anon;
grant select on public.credit_accounts, public.points_accounts,
                public.credit_ledger, public.points_ledger to authenticated;

create policy "Super admins read all credit accounts" on public.credit_accounts
  for select to authenticated using (public.is_super_admin(auth.uid()));
create policy "Super admins read all points accounts" on public.points_accounts
  for select to authenticated using (public.is_super_admin(auth.uid()));
create policy "Super admins read all credit ledger" on public.credit_ledger
  for select to authenticated using (public.is_super_admin(auth.uid()));
create policy "Super admins read all points ledger" on public.points_ledger
  for select to authenticated using (public.is_super_admin(auth.uid()));

-- 4. Invitations become the single admin-onboarding path; the legacy allowlist goes away.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _eco uuid;
  _inv public.admin_invitations%rowtype;
  _role public.app_role := 'customer';
begin
  select id into _eco
  from public.ecosystems
  where slug = lower(nullif(new.raw_user_meta_data->>'ecosystem_slug',''))
    and signup_enabled;

  -- An invitation is only honoured when the authenticated email matches it exactly.
  select * into _inv
  from public.admin_invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  if _inv.id is not null then
    _role := _inv.role;
    _eco := case when _inv.role = 'super_admin' then null else _inv.ecosystem_id end;
  elsif _eco is null then
    raise exception 'Sign-up requires a valid ecosystem invite link';
  end if;

  insert into public.profiles (id, ecosystem_id, full_name, email, phone)
  values (
    new.id,
    _eco,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  );

  insert into public.user_roles (user_id, role, ecosystem_id)
  values (new.id, _role, _eco)
  on conflict do nothing;

  if _inv.id is not null then
    update public.admin_invitations
       set status = 'accepted', accepted_at = now()
     where id = _inv.id;

    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_eco, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
            'Accepted ' || _role::text || ' invitation', lower(new.email),
            jsonb_build_object('invitation_id', _inv.id, 'invited_by', _inv.invited_by));
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_eco, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
          'Account created', coalesce(new.email, ''));

  return new;
end;
$$;

create or replace function public.invite_admin(_email text, _ecosystem_id uuid, _role public.app_role default 'admin')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare _id uuid; _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can invite operators';
  end if;
  if _role not in ('admin','super_admin') then
    raise exception 'Only admin or super admin invitations are supported here';
  end if;
  if _role = 'admin' and _ecosystem_id is null then
    raise exception 'An admin invitation must target exactly one ecosystem';
  end if;
  if exists (select 1 from public.profiles where lower(email) = lower(_email)) then
    raise exception 'That email already has an account';
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();

  update public.admin_invitations
     set status = 'revoked'
   where lower(email) = lower(_email) and status = 'pending';

  insert into public.admin_invitations (email, ecosystem_id, role, invited_by, invited_by_name)
  values (lower(_email), case when _role = 'super_admin' then null else _ecosystem_id end,
          _role, auth.uid(), coalesce(_actor, 'Super admin'))
  returning id into _id;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target)
  values (_ecosystem_id, auth.uid(), coalesce(_actor, 'Super admin'),
          'Invited ' || _role::text, lower(_email));
  return _id;
end;
$$;

drop table if exists public.bootstrap_roles;

-- 5. Operational status for the signed-in admin (UX only; RLS still authorizes data).
create or replace function public.my_operational_status()
returns table (
  ecosystem_id uuid,
  subscription_state public.subscription_state,
  current_period_end timestamptz,
  grace_period_days integer,
  operational boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         e.subscription_state,
         e.current_period_end,
         e.grace_period_days,
         public.is_super_admin(auth.uid()) or public.subscription_ok(e.id)
  from public.ecosystems e
  where e.id = public.current_ecosystem(auth.uid())
$$;
revoke execute on function public.my_operational_status() from public, anon;
grant execute on function public.my_operational_status() to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.invite_admin(text, uuid, public.app_role) from public, anon;
grant execute on function public.invite_admin(text, uuid, public.app_role) to authenticated;