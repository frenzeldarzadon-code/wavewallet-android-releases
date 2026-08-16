-- ============================================================
-- 1. Shop kind + review markers
-- ============================================================
alter table public.ecosystems
  add column if not exists shop_kind text not null default 'subscription',
  add column if not exists is_review boolean not null default false,
  add column if not exists review_ends_at timestamptz;

-- Every shop that exists today keeps its Legacy behaviour untouched.
update public.ecosystems set shop_kind = 'legacy' where shop_kind is distinct from 'legacy';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ecosystems_shop_kind_check') then
    alter table public.ecosystems
      add constraint ecosystems_shop_kind_check check (shop_kind in ('legacy','subscription'));
  end if;
end $$;

-- ============================================================
-- 2. Subscription plan catalog (configurable, never hard-coded)
-- ============================================================
create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  tagline text,
  description text not null default '',
  who_for text,
  wifi_use_case text,
  upgrade_hint text,
  monthly_price numeric(12,2) not null default 0 check (monthly_price >= 0),
  coin_allocation numeric(14,2) not null default 0 check (coin_allocation >= 0),
  billing_period text not null default 'monthly' check (billing_period in ('monthly','quarterly','yearly')),
  price_configurable boolean not null default false,
  recommended boolean not null default false,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.subscription_plans to anon, authenticated;
grant all on public.subscription_plans to service_role;
alter table public.subscription_plans enable row level security;

drop policy if exists "Active plans are public" on public.subscription_plans;
create policy "Active plans are public" on public.subscription_plans
  for select to anon, authenticated using (active);

drop policy if exists "Platform owner manages plans" on public.subscription_plans;
create policy "Platform owner manages plans" on public.subscription_plans
  for all to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

insert into public.subscription_plans
  (code, name, tagline, description, who_for, wifi_use_case, upgrade_hint,
   monthly_price, coin_allocation, price_configurable, recommended, display_order)
values
  ('starter','Starter','Small WiFi voucher shops',
   'A complete WaveWallet shop with 1,000 Coins of revolving internal cashflow. The monthly price is your subscription expense; the Coins are the shop cashflow that circulates inside your WiFi voucher ecosystem.',
   'Store owners selling WiFi vouchers directly to customers, with no reseller network yet.',
   'Enough revolving capacity when only a modest amount of Coin value needs to be circulating at the same time.',
   'Upgrade when your customers or first resellers need more Coins circulating simultaneously.',
   50, 1000, false, false, 10),
  ('basic','Basic','Growing customer base',
   'Adds room for a wider customer base and the first steps of a distribution network with 2,500 Coins of revolving cashflow.',
   'Shops with a growing WiFi customer base and early Coin distribution to a few helpers.',
   'Supports more simultaneous voucher purchases and small-scale distribution.',
   'Upgrade when resellers start holding Coins of their own.',
   100, 2500, false, false, 20),
  ('standard','Standard','Beginning reseller activity',
   '5,000 Coins of revolving cashflow for a shop whose resellers are becoming active.',
   'WiFi voucher businesses with active customers and reseller operations starting.',
   'Keeps enough Coin value with Admin and resellers at the same time.',
   'Upgrade when several resellers are active or subresellers appear.',
   150, 5000, true, false, 30),
  ('advanced','Advanced','Active reseller network',
   '10,000 Coins of revolving cashflow for higher voucher volume and a real reseller/subreseller network.',
   'Shops with multiple active resellers, larger customer networks and beginning subreseller networks.',
   'Supports higher simultaneous Coin movement across several distribution levels.',
   'Upgrade for multi-location or very high simultaneous Coin movement.',
   200, 10000, false, false, 40),
  ('large','Large Deployment','Multi-location deployments',
   '500,000 Coins of revolving cashflow for large WiFi voucher deployments. Price is agreed with WaveWallet.',
   'Large deployments with many resellers, subresellers and multiple locations.',
   'Large simultaneous Coin movement across many distribution branches.',
   'Contact WaveWallet to size the plan to your deployment.',
   0, 500000, true, false, 50)
on conflict (code) do nothing;

-- ============================================================
-- 3. Shop subscription state + audit trail
-- ============================================================
create table if not exists public.shop_subscriptions (
  ecosystem_id uuid primary key references public.ecosystems(id) on delete cascade,
  plan_id uuid references public.subscription_plans(id),
  state text not null default 'review'
    check (state in ('review','active','expiring_soon','expired','frozen','closed')),
  allocation_total numeric(14,2) not null default 0,
  demo_seed_credits numeric(14,2) not null default 1000,
  period_start timestamptz,
  period_end timestamptz,
  review_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.shop_subscriptions to authenticated;
grant all on public.shop_subscriptions to service_role;
alter table public.shop_subscriptions enable row level security;

drop policy if exists "Members read their shop subscription" on public.shop_subscriptions;
create policy "Members read their shop subscription" on public.shop_subscriptions
  for select to authenticated
  using (public.is_super_admin(auth.uid()) or public.has_membership(auth.uid(), ecosystem_id));

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  event_type text not null,
  previous_plan_id uuid references public.subscription_plans(id),
  new_plan_id uuid references public.subscription_plans(id),
  amount_php numeric(12,2),
  allocation_granted numeric(14,2) not null default 0,
  additional_allocation numeric(14,2) not null default 0,
  proration_days_remaining integer,
  proration_daily_value numeric(12,4),
  proration_unused_value numeric(12,2),
  payment_reference text,
  verification_status text,
  period_start timestamptz,
  period_end timestamptz,
  tx_id text,
  actor_id uuid,
  actor_name text,
  notes text,
  created_at timestamptz not null default now()
);

grant select on public.subscription_events to authenticated;
grant all on public.subscription_events to service_role;
alter table public.subscription_events enable row level security;

drop policy if exists "Members read their subscription history" on public.subscription_events;
create policy "Members read their subscription history" on public.subscription_events
  for select to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), ecosystem_id));

create index if not exists subscription_events_shop_idx
  on public.subscription_events (ecosystem_id, created_at desc);

-- ============================================================
-- 4. Demo (review shop) ledger — completely separate namespace
-- ============================================================
create table if not exists public.demo_wallets (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  member_key text not null,
  display_name text not null,
  role text not null check (role in ('admin','reseller','subreseller','customer')),
  parent_key text,
  balance numeric(14,2) not null default 0 check (balance >= 0),
  points numeric(14,2) not null default 0 check (points >= 0),
  created_at timestamptz not null default now(),
  unique (ecosystem_id, member_key)
);

create table if not exists public.demo_ledger (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  member_key text not null,
  direction text not null check (direction in ('credit','debit')),
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null default 0,
  entry_kind text not null default 'demo',
  reason text not null default '',
  tx_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.demo_vouchers (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  name text not null,
  description text not null default '',
  price numeric(14,2) not null check (price > 0),
  stock integer not null default 100,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists demo_ledger_shop_idx on public.demo_ledger (ecosystem_id, created_at desc);

grant select, insert, update, delete on public.demo_wallets to authenticated;
grant select, insert, update, delete on public.demo_ledger to authenticated;
grant select, insert, update, delete on public.demo_vouchers to authenticated;
grant all on public.demo_wallets, public.demo_ledger, public.demo_vouchers to service_role;

alter table public.demo_wallets enable row level security;
alter table public.demo_ledger enable row level security;
alter table public.demo_vouchers enable row level security;

drop policy if exists "Review shop admin uses demo wallets" on public.demo_wallets;
create policy "Review shop admin uses demo wallets" on public.demo_wallets
  for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), ecosystem_id))
  with check (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), ecosystem_id));

drop policy if exists "Review shop admin uses demo ledger" on public.demo_ledger;
create policy "Review shop admin uses demo ledger" on public.demo_ledger
  for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), ecosystem_id))
  with check (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), ecosystem_id));

drop policy if exists "Review shop admin uses demo vouchers" on public.demo_vouchers;
create policy "Review shop admin uses demo vouchers" on public.demo_vouchers
  for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), ecosystem_id))
  with check (public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), ecosystem_id));

-- ============================================================
-- 5. Public guide content (centrally editable, stable URL)
-- ============================================================
create table if not exists public.guide_sections (
  id uuid primary key default gen_random_uuid(),
  section_key text not null unique,
  heading text not null,
  subheading text,
  body text not null default '',
  image_url text,
  display_order integer not null default 0,
  published boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guide_faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  display_order integer not null default 0,
  published boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guide_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  contact text,
  answer text,
  answered_at timestamptz,
  status text not null default 'pending' check (status in ('pending','published','rejected')),
  created_at timestamptz not null default now()
);

grant select on public.guide_sections to anon, authenticated;
grant select on public.guide_faqs to anon, authenticated;
grant select on public.guide_questions to anon, authenticated;
grant insert, update, delete on public.guide_sections to authenticated;
grant insert, update, delete on public.guide_faqs to authenticated;
grant update on public.guide_questions to authenticated;
grant all on public.guide_sections, public.guide_faqs, public.guide_questions to service_role;

alter table public.guide_sections enable row level security;
alter table public.guide_faqs enable row level security;
alter table public.guide_questions enable row level security;

drop policy if exists "Published guide sections are public" on public.guide_sections;
create policy "Published guide sections are public" on public.guide_sections
  for select to anon, authenticated using (published or public.is_super_admin(auth.uid()));

drop policy if exists "Platform owner edits guide sections" on public.guide_sections;
create policy "Platform owner edits guide sections" on public.guide_sections
  for all to authenticated
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

drop policy if exists "Published FAQs are public" on public.guide_faqs;
create policy "Published FAQs are public" on public.guide_faqs
  for select to anon, authenticated using (published or public.is_super_admin(auth.uid()));

drop policy if exists "Platform owner edits FAQs" on public.guide_faqs;
create policy "Platform owner edits FAQs" on public.guide_faqs
  for all to authenticated
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- Visitor questions: only answered + published rows are readable; submission
-- goes through a rate-limited function, never a direct insert.
drop policy if exists "Answered questions are public" on public.guide_questions;
create policy "Answered questions are public" on public.guide_questions
  for select to anon, authenticated
  using ((status = 'published' and answer is not null) or public.is_super_admin(auth.uid()));

drop policy if exists "Platform owner moderates questions" on public.guide_questions;
create policy "Platform owner moderates questions" on public.guide_questions
  for update to authenticated
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));