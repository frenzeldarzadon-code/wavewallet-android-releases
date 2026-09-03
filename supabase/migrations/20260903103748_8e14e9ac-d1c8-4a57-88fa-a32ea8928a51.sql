drop policy if exists "Read active seller authorizations" on public.shop_seller_authorizations;
create policy "Read own or administered seller authorizations"
  on public.shop_seller_authorizations for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_ecosystem_admin(auth.uid(), ecosystem_id)
    or public.is_super_admin(auth.uid())
  );