/**
 * Universe users who belong to no shop yet, plus the safety checks the platform
 * owner sees before assigning or deleting one of those accounts.
 */
import { supabase } from "@/integrations/supabase/client";

export interface UnassignedUser {
  user_id: string;
  full_name: string;
  handle: string | null;
  email: string | null;
  phone: string | null;
  avatar_path: string | null;
  joined_at: string;
  credit_total: number;
  points_total: number;
}

export interface DeletionCheck {
  eligible: boolean;
  credit_total: number;
  points_total: number;
  social_purchased: number;
  reason: string;
}

function fail(message: string): never {
  throw new Error(message);
}

export async function fetchUnassignedUsers(search?: string): Promise<UnassignedUser[]> {
  const q = (search ?? "").trim();
  const { data, error } = await supabase.rpc(
    "platform_unassigned_users",
    q ? { _search: q } : {},
  );
  if (error) fail(error.message);
  return (data ?? []) as UnassignedUser[];
}

export async function assignMemberToShop(userId: string, ecosystemId: string) {
  const { error } = await supabase.rpc("superadmin_assign_member_to_shop", {
    _user: userId,
    _ecosystem_id: ecosystemId,
  });
  if (error) fail(error.message);
}

/**
 * `override` is the platform-owner exemption: every non-financial rule (operator
 * role, account age, shop membership) is waived, while zero balances and "no
 * money in flight" stay mandatory — the database enforces both.
 */
export async function fetchDeletionCheck(
  userId: string,
  override = false,
): Promise<DeletionCheck> {
  const { data, error } = await supabase.rpc("platform_user_deletion_check", {
    _user: userId,
    _override: override,
  });
  if (error) fail(error.message);
  const row = ((data ?? []) as DeletionCheck[])[0];
  return (
    row ?? {
      eligible: false,
      credit_total: 0,
      points_total: 0,
      social_purchased: 0,
      reason: "Member not found or already removed.",
    }
  );
}

/** Plain-language summary of why an account may or may not be removed. */
export function deletionSummary(check: DeletionCheck): string {
  return check.reason || "The safety check did not return a reason.";
}
