grant select, insert, update on public.member_presence to authenticated;

drop policy if exists "Members manage own presence" on public.member_presence;
create policy "Members manage own presence"
on public.member_presence
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());