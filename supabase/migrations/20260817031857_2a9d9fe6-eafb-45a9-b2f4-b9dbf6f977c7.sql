alter table public.earnings_reconciliation_adjustments enable row level security;

revoke all on public.earnings_reconciliation_adjustments from anon, authenticated;
grant select on public.earnings_reconciliation_adjustments to authenticated;
grant all on public.earnings_reconciliation_adjustments to service_role;

drop policy if exists "Platform owner reads earnings corrections" on public.earnings_reconciliation_adjustments;
create policy "Platform owner reads earnings corrections"
on public.earnings_reconciliation_adjustments
for select
to authenticated
using (public.is_super_admin(auth.uid()));