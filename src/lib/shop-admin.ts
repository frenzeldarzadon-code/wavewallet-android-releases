/**
 * Shop admin assignment (platform owner only).
 *
 * Assigning an admin never touches money: the previous admin keeps their
 * membership and wallet and simply steps down to customer, while the new admin
 * is promoted for that one shop. The database records the old admin, the new
 * admin, the operator and the timestamp in the audit trail and notifies the
 * person who was assigned.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ShopAdminInfo {
  userId: string | null;
  name: string | null;
  email: string | null;
  assignedAt: string | null;
}

export async function fetchShopAdmin(ecosystemId: string): Promise<ShopAdminInfo> {
  const { data: eco } = await supabase
    .from("ecosystems")
    .select("admin_assigned_at")
    .eq("id", ecosystemId)
    .maybeSingle();
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("ecosystem_id", ecosystemId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const assignedAt = (eco?.admin_assigned_at as string | null) ?? null;
  if (!data?.user_id) return { userId: null, name: null, email: null, assignedAt };
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", data.user_id)
    .maybeSingle();
  return {
    userId: data.user_id,
    name: profile?.full_name ?? null,
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
