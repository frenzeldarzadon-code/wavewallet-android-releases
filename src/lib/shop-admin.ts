/**
 * Shop admin assignment (platform owner only).
 *
 * The platform owner picks an existing Universe account and that person becomes
 * the shop's admin straight away — the assignment is the approval, so there is
 * no application to review and no invitation to accept. Nothing else about the
 * person moves: their Universe identity is unchanged, their roles in other
 * shops are unchanged, and every wallet stays with the shop it belongs to.
 *
 * The outgoing admin keeps their membership, wallet and history in the shop and
 * simply steps down to customer, losing only the right to manage it. The
 * database records the old admin, the new admin, the operator and the timestamp
 * in the audit trail and notifies both people.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ShopAdminInfo {
  userId: string | null;
  name: string | null;
  handle: string | null;
  avatarPath: string | null;
  email: string | null;
  assignedAt: string | null;
}

const EMPTY: ShopAdminInfo = {
  userId: null,
  name: null,
  handle: null,
  avatarPath: null,
  email: null,
  assignedAt: null,
};

export async function fetchShopAdmin(ecosystemId: string): Promise<ShopAdminInfo> {
  const { data: eco } = await supabase
    .from("ecosystems")
    .select("admin_assigned_at")
    .eq("id", ecosystemId)
    .maybeSingle();
  const assignedAt = (eco?.admin_assigned_at as string | null) ?? null;

  // The shop membership is the source of truth for a shop-scoped role; the
  // legacy role table is only a fallback for rows created before memberships.
  const { data: membership, error } = await supabase
    .from("ecosystem_memberships")
    .select("user_id")
    .eq("ecosystem_id", ecosystemId)
    .eq("role", "admin")
    .eq("membership_state", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);

  let userId = membership?.user_id ?? null;
  if (!userId) {
    const { data: legacy } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("ecosystem_id", ecosystemId)
      .eq("role", "admin")
      .maybeSingle();
    userId = legacy?.user_id ?? null;
  }
  if (!userId) return { ...EMPTY, assignedAt };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, handle, avatar_path")
    .eq("id", userId)
    .maybeSingle();
  return {
    userId,
    name: profile?.full_name ?? null,
    handle: profile?.handle ?? null,
    avatarPath: profile?.avatar_path ?? null,
    email: profile?.email ?? null,
    assignedAt,
  };
}

export async function assignShopAdmin(ecosystemId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc("assign_shop_admin", {
    _ecosystem_id: ecosystemId,
    _user_id: userId,
  });
  if (error) throw new Error(error.message);
}

/** A shop without an assigned admin is live but cannot serve members yet. */
export const adminNotice = (admin: ShopAdminInfo) =>
  admin.userId
    ? null
    : "No admin is assigned yet — this shop stays inaccessible to members until you assign one.";
