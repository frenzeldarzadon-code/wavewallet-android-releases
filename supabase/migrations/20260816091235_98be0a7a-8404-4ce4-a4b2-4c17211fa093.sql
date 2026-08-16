-- Hide asker contact details from public guide reads.
revoke select on public.guide_questions from anon, authenticated;
grant select (id, question, answer, answered_at, status, created_at) on public.guide_questions to anon, authenticated;

create or replace function public.guide_questions_admin()
returns setof public.guide_questions
language sql
stable
security definer
set search_path = public
as $$
  select * from public.guide_questions
   where public.is_super_admin(auth.uid())
   order by created_at desc
   limit 200
$$;

revoke all on function public.guide_questions_admin() from public, anon;
grant execute on function public.guide_questions_admin() to authenticated;