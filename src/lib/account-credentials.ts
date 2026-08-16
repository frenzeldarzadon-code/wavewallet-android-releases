/**
 * Credential management helpers — operator side and self-service side.
 *
 * SECURITY: no password is ever stored, returned, logged or audited by this
 * module. Passwords live only inside the authentication provider as salted
 * hashes; the only supported operation is *setting* a new one.
 */
import { requireOnline } from "@/lib/offline-guard";
import { supabase } from "@/integrations/supabase/client";
import { normalizeHandle } from "@/lib/profile";
import { newPasswordIssue } from "@/lib/password-policy";

export interface MemberShopAccount {
  ecosystem_id: string;
  ecosystem_name: string;
  role: string;
  membership_state: string;
  credit_balance: number;
  points_balance: number;
}

/** Per-shop wallets/roles behind one member row (Super Admin only, enforced in the database). */
export async function fetchMemberShopAccounts(userId: string): Promise<MemberShopAccount[]> {
  const { data, error } = await supabase.rpc("super_member_accounts", { _user: userId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MemberShopAccount[]).map((r) => ({
    ...r,
    credit_balance: Number(r.credit_balance ?? 0),
    points_balance: Number(r.points_balance ?? 0),
  }));
}

/** Username (@handle) rules shared by the operator editor and self-service. */
export function usernameIssue(value: string): string | null {
  const h = normalizeHandle(value);
  if (!h) return "Enter a username.";
  if (!/^[a-z0-9_.]{3,20}$/.test(h)) {
    return "Usernames are 3–20 letters, numbers, dots or underscores.";
  }
  return null;
}

/**
 * Operator-side username change. Authorization, global uniqueness and the
 * audit entry are all decided by the database.
 */
export async function setMemberUsername(userId: string, handle: string): Promise<string> {
  const problem = usernameIssue(handle);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase.rpc("admin_set_member_handle", {
    _target: userId,
    _handle: normalizeHandle(handle),
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? normalizeHandle(handle);
}

/**
 * Self-service password change. The current password is re-verified against
 * the auth provider first, so a walk-up on an unlocked device cannot silently
 * take over the account.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
  confirm: string,
): Promise<void> {
  requireOnline();
  const problem = newPasswordIssue(newPassword, confirm);
  if (problem) throw new Error(problem);
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) throw new Error("You are not signed in.");
  if (currentPassword === newPassword) {
    throw new Error("Choose a password different from your current one.");
  }
  const { error: reauth } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (reauth) throw new Error("Your current password is incorrect.");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}
