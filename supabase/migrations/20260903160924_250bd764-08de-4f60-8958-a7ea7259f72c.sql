drop policy if exists "Published guide sections are public" on public.guide_sections;
drop policy if exists "Published FAQs are public" on public.guide_faqs;

create policy "Published guide sections are public"
  on public.guide_sections for select to anon
  using (published);
create policy "Members read published sections, owner reads all"
  on public.guide_sections for select to authenticated
  using (published or public.is_super_admin(auth.uid()));

create policy "Published FAQs are public"
  on public.guide_faqs for select to anon
  using (published);
create policy "Members read published FAQs, owner reads all"
  on public.guide_faqs for select to authenticated
  using (published or public.is_super_admin(auth.uid()));