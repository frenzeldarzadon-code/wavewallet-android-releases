-- Shop membership is authoritative: ecosystem_memberships, not profiles.ecosystem_id.
create or replace function public.shop_members(_ecosystem_id uuid)
returns table (
  id uuid,
  full_name text,
  email text,
  phone text,
  handle text,
  avatar_path text,
  joined_at timestamptz,
  status text,
  membership_state text,
  role text,
  reseller_id uuid,
  reseller_discount_percent numeric,
  reseller_commission_percent numeric,
  sale_commission_percent numeric,
  deleted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.email,
    p.phone,
    coalesce(m.handle, p.handle),
    p.avatar_path,
    coalesce(m.joined_at, p.joined_at),
    m.status::text,
    m.membership_state::text,
    m.role::text,
    m.reseller_id,
    coalesce(m.reseller_discount_percent, 0)::numeric,
    m.reseller_commission_percent::numeric,
    m.sale_commission_percent::numeric,
    p.deleted_at
  from public.ecosystem_memberships m
  join public.profiles p on p.id = m.user_id
  where m.ecosystem_id = _ecosystem_id
    and m.membership_state = 'active'
    and (
      public.is_super_admin(auth.uid())
      or public.is_ecosystem_admin(auth.uid(), _ecosystem_id)
      or public.is_ecosystem_admin(public.effective_uid(), _ecosystem_id)
    )
    and not public.is_super_admin(p.id)
    and p.deleted_at is null;
$$;

revoke all on function public.shop_members(uuid) from public, anon;
grant execute on function public.shop_members(uuid) to authenticated;

-- Legacy mirror backfill: every active membership gets its per-shop user_roles row.
insert into public.user_roles (user_id, role, ecosystem_id)
select m.user_id, m.role, m.ecosystem_id
from public.ecosystem_memberships m
where m.membership_state = 'active'
  and m.status = 'active'
on conflict (user_id, ecosystem_id, role) do nothing;