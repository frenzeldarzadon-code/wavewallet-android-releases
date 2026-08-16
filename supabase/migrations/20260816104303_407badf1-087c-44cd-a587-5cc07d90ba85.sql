-- 1. Guide questions: stop exposing the contact column publicly
DROP POLICY IF EXISTS "Answered questions are public" ON public.guide_questions;

CREATE POLICY "Platform owner reads questions"
ON public.guide_questions FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

REVOKE SELECT ON public.guide_questions FROM anon;

CREATE OR REPLACE FUNCTION public.guide_questions_public(_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, question text, answer text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.question, q.answer
  FROM public.guide_questions q
  WHERE q.status = 'published' AND q.answer IS NOT NULL
  ORDER BY q.answered_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(_limit, 20), 100));
$$;

REVOKE ALL ON FUNCTION public.guide_questions_public(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guide_questions_public(integer) TO anon, authenticated;

-- 2. Trigger routines must never be directly callable
REVOKE ALL ON FUNCTION public.guard_shop_kind_ledger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_subscription_cashout() FROM PUBLIC, anon, authenticated;

-- 3. Privileged routines must not be callable by signed-out visitors
REVOKE EXECUTE ON FUNCTION public.cash_in_auto_rule(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cash_in_conflict_snapshot(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cash_in_receiving_number(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cash_in_reference_conflict_list(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.listener_serves_destination(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.register_listener_device(text, uuid, integer, integer, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_cash_in_reference_conflict(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_cash_in_auto_approval(uuid, boolean, boolean, numeric, numeric, numeric, boolean, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_ecosystem_cash_in_number(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_app_release(boolean, text, text, date, bigint, text, text, text) FROM anon;
