create or replace function public.can_review_applications(_user_id uuid, _ecosystem_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public, pg_temp'
as $$
  SELECT public.is_super_admin(_user_id)
      OR public.is_ecosystem_admin(_user_id, _ecosystem_id);
$$;

drop policy if exists "Approvers read applications for their shop" on public.membership_applications;
create policy "Approvers read applications for their shop"
  on public.membership_applications
  for select
  to authenticated
  using (
    public.shop_requires_membership_approval(ecosystem_id)
    and public.can_review_applications(auth.uid(), ecosystem_id)
  );
