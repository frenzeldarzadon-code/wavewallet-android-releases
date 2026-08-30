-- membership_role() is referenced by the "Shop staff read redemptions" policy on
-- public.reward_redemptions. RLS policy expressions are evaluated with the
-- CALLER's privileges, so a signed-in user without EXECUTE on the helper gets
-- "permission denied for function membership_role" on every read of that table.
-- The function is SECURITY DEFINER and only reports the caller-supplied member's
-- role, so granting EXECUTE to authenticated does not widen data access.
GRANT EXECUTE ON FUNCTION public.membership_role(uuid, uuid) TO authenticated;