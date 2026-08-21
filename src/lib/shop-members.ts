/**
 * Who belongs to a shop — read from the authoritative place.
 *
 * A person has ONE profile but MANY shop memberships. `profiles.ecosystem_id`
 * is only a mirror of whichever shop the person last acted in, so listing a
 * shop's members by that column silently hides every multi-shop member (an
 * active reseller in two shops would only ever appear in one of them).
 * `ecosystem_memberships` is the source of truth for membership, role, status,
 * parent reseller and per-shop percentages; `user_roles` is a legacy mirror.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/wavewallet";

export interface ShopMember {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  handle: string | null;
  avatar_path: string | null;
  joined_at: string;
  /** Per-shop account state, not a global flag. */
  status: "active" | "suspended";
  membership_state: "pending" | "active" | "rejected" | "removed";
  /** The role that applies INSIDE this shop. */
  role: Role;
  reseller_id: string | null;
  reseller_discount_percent: number;
  reseller_commission_percent: number | null;
  sale_commission_percent: number | null;
  deleted_at: string | null;
}

type ShopMemberRow = Omit<
  ShopMember,
  | "role"
  | "status"
  | "membership_state"
  | "reseller_discount_percent"
  | "reseller_commission_percent"
  | "sale_commission_percent"
> & {
  role: string;
  status: string;
  membership_state: string;
  reseller_discount_percent: number | string | null;
  reseller_commission_percent: number | string | null;
  sale_commission_percent: number | string | null;
};

const num = (v: number | string | null): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Normalises one row from `shop_members` into the shape the UI works with. */
export function toShopMember(row: ShopMemberRow): ShopMember {
  return {
    id: row.id,
    full_name: row.full_name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    handle: row.handle ?? null,
    avatar_path: row.avatar_path ?? null,
    joined_at: row.joined_at,
    status: (row.status === "suspended" ? "suspended" : "active") as ShopMember["status"],
    membership_state: row.membership_state as ShopMember["membership_state"],
    role: row.role as Role,
    reseller_id: row.reseller_id ?? null,
    reseller_discount_percent: num(row.reseller_discount_percent) ?? 0,
    reseller_commission_percent: num(row.reseller_commission_percent),
    sale_commission_percent: num(row.sale_commission_percent),
    deleted_at: row.deleted_at ?? null,
  };
}

/**
 * Every active member of one shop. The database re-checks that the caller
 * administers that shop, so a forged ecosystem id returns nothing.
 */
export async function fetchShopMembers(ecosystemId: string): Promise<ShopMember[]> {
  const { data, error } = await supabase.rpc("shop_members", { _ecosystem_id: ecosystemId });
  if (error) return [];
  return ((data ?? []) as unknown as ShopMemberRow[]).map(toShopMember);
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** Members whose membership in this shop is live — never a global lookup. */
export function activeMembers(rows: ShopMember[]): ShopMember[] {
  return rows.filter((m) => m.membership_state === "active" && !m.deleted_at);
}

/**
 * The selling network of one shop. Role comes from the membership, so the same
 * person can be a reseller here and a plain customer somewhere else.
 */
export function resellersOf(rows: ShopMember[]): ShopMember[] {
  return activeMembers(rows).filter(
    (m) => (m.role === "reseller" || m.role === "subreseller") && m.status === "active",
  );
}

/** The role that applies inside this shop, or null when there is no membership. */
export function shopRoleOf(rows: ShopMember[], userId: string): Role | null {
  return activeMembers(rows).find((m) => m.id === userId)?.role ?? null;
}
