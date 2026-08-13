/**
 * Super Admin platform-wide member directory.
 *
 * Backed by `super_list_members`, which returns nothing at all unless the
 * caller is a super admin — the authorization decision lives in the database,
 * never in this module.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/wavewallet";

export interface PlatformMember {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  email: string;
  phone: string;
  status: string;
  role: Role;
  ecosystem_id: string | null;
  ecosystem_name: string | null;
  credit_balance: number;
  points_balance: number;
  joined_at: string;
}

export interface PlatformMemberFilters {
  query?: string;
  ecosystemId?: string | null;
  role?: Role | null;
  limit?: number;
  offset?: number;
}

/** Roles a Super Admin may pick in the directory filter. */
export const DIRECTORY_ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "reseller", label: "Reseller" },
  { value: "subreseller", label: "Subreseller" },
  { value: "customer", label: "Customer" },
];

/** Acting-as is never offered for platform owners or shop owners. */
export function canActAsMember(member: Pick<PlatformMember, "role" | "status">): boolean {
  if (member.status !== "active") return false;
  return member.role === "reseller" || member.role === "subreseller" || member.role === "customer";
}

export async function listPlatformMembers(
  filters: PlatformMemberFilters = {},
): Promise<PlatformMember[]> {
  const args: {
    _query?: string;
    _ecosystem_id?: string;
    _role?: string;
    _limit: number;
    _offset: number;
  } = { _limit: filters.limit ?? 100, _offset: filters.offset ?? 0 };
  const q = filters.query?.trim();
  if (q) args._query = q;
  if (filters.ecosystemId) args._ecosystem_id = filters.ecosystemId;
  if (filters.role) args._role = filters.role;

  const { data, error } = await supabase.rpc("super_list_members", args);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PlatformMember[];
}
