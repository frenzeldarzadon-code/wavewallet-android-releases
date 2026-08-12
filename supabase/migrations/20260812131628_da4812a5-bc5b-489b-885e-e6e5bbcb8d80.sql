-- 1. Demo/QA marker so demo owners never count as the real production owner.
alter table public.profiles add column if not exists is_demo boolean not null default false;
update public.profiles set is_demo = true where lower(email) like '%@wavewallet.demo';

-- 2. Single-row bootstrap claim table. The primary key makes the claim atomic:
--    two concurrent claims cannot both insert.
create table if not exists public.platform_bootstrap (
  id boolean primary key default true,
  claimed_email text not null,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  super_admin_id uuid,
  source text,
  constraint platform_bootstrap_singleton check (id)
);

grant all on public.platform_bootstrap to service_role;
alter table public.platform_bootstrap enable row level security;
-- No policies: reachable only through SECURITY DEFINER functions / service role.

create policy "Platform owner can read bootstrap record"
  on public.platform_bootstrap for select to authenticated
  using (public.is_super_admin(auth.uid()));

-- 3. Eligibility helpers.
create or replace function public.real_super_admin_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'super_admin'
      and coalesce(p.is_demo, false) = false
  );
$$;

create or replace function public.super_admin_bootstrap_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (not public.real_super_admin_exists())
     and not exists (select 1 from public.platform_bootstrap where completed_at is not null);
$$;

grant execute on function public.super_admin_bootstrap_available() to anon, authenticated, service_role;
revoke execute on function public.real_super_admin_exists() from anon, authenticated;
grant execute on function public.real_super_admin_exists() to service_role;

-- 4. Atomic claim. Service role only: the browser can never call it.
create or replace function public.claim_super_admin_bootstrap(_email text, _source text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  _claimed timestamptz;
begin
  if _email is null or _email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email address is required';
  end if;

  -- Abandoned claims (signup never completed) expire after 60 minutes.
  delete from public.platform_bootstrap
   where completed_at is null and claimed_at < now() - interval '60 minutes';

  if public.real_super_admin_exists() then
    raise exception 'Initial platform owner setup has already been completed';
  end if;

  insert into public.platform_bootstrap (id, claimed_email, source)
  values (true, lower(trim(_email)), _source)
  returning claimed_at into _claimed;

  return _claimed;
exception
  when unique_violation then
    raise exception 'Initial platform owner setup has already been started or completed';
end;
$$;

revoke execute on function public.claim_super_admin_bootstrap(text, text) from anon, authenticated, public;
grant execute on function public.claim_super_admin_bootstrap(text, text) to service_role;

-- Releases an unfinished claim when the signup call itself failed.
create or replace function public.release_super_admin_bootstrap(_email text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.platform_bootstrap
   where completed_at is null and lower(claimed_email) = lower(trim(_email));
$$;

revoke execute on function public.release_super_admin_bootstrap(text) from anon, authenticated, public;
grant execute on function public.release_super_admin_bootstrap(text) to service_role;

-- 5. Signup trigger: grant super_admin only for a matching, unexpired claim.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _eco uuid;
  _inv public.admin_invitations%rowtype;
  _role public.app_role := 'customer';
  _bs public.platform_bootstrap%rowtype;
  _demo boolean := coalesce((new.raw_user_meta_data->>'demo')::boolean, false);
begin
  select id into _eco
  from public.ecosystems
  where slug = lower(nullif(new.raw_user_meta_data->>'ecosystem_slug',''))
    and signup_enabled;

  -- Initial platform-owner bootstrap: one pending claim, matched by email.
  select * into _bs
  from public.platform_bootstrap
  where completed_at is null
    and lower(claimed_email) = lower(new.email)
    and claimed_at > now() - interval '60 minutes'
  for update;

  -- An invitation is only honoured when the authenticated email matches it exactly.
  select * into _inv
  from public.admin_invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  if _bs.id is not null and not _demo then
    _role := 'super_admin';
    _eco := null;
  elsif _inv.id is not null then
    _role := _inv.role;
    _eco := case when _inv.role = 'super_admin' then null else _inv.ecosystem_id end;
  elsif _eco is null then
    raise exception 'Sign-up requires a valid ecosystem invite link';
  end if;

  insert into public.profiles (id, ecosystem_id, full_name, email, phone, is_demo)
  values (
    new.id,
    _eco,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    _demo
  );

  insert into public.user_roles (user_id, role, ecosystem_id)
  values (new.id, _role, _eco)
  on conflict do nothing;

  if _bs.id is not null and not _demo then
    update public.platform_bootstrap
       set completed_at = now(), super_admin_id = new.id
     where id = true;

    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (null, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
            'Initial Super Admin created', lower(new.email),
            jsonb_build_object('source', _bs.source, 'claimed_at', _bs.claimed_at,
                               'completed_at', now(), 'method', 'initial_bootstrap'));
  end if;

  if _inv.id is not null and (_bs.id is null or _demo) then
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
$function$;