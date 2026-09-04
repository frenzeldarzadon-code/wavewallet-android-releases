/**
 * Universe ↔ Shop Dashboard.
 *
 * Universe is the customer portal for every member. A Shop Dashboard exists
 * only for memberships that carry a management role (admin, reseller,
 * subreseller): those are the roles with tools that cannot live in Universe —
 * sellers, inventory, storefront design, shop operations. Ordinary customer
 * memberships never open a dashboard, so a plain member is never shown a
 * misleading switch. Pure helpers; the database authorizes every switch.
 */
import { switchableMemberships, type Membership } from "@/lib/memberships";
import { homeFor } from "@/lib/session";
import type { Role } from "@/lib/wavewallet";

export const MANAGEMENT_ROLES: readonly Role[] = ["admin", "reseller", "subreseller"];

export const isManagementRole = (role: Role): boolean => MANAGEMENT_ROLES.includes(role);

/** Approved, non-suspended memberships that carry a management role. */
export function managedMemberships(list: Membership[]): Membership[] {
  return switchableMemberships(list).filter((m) => isManagementRole(m.role));
}

/** Where the Shop Dashboard of one membership opens. */
export const dashboardPathFor = (role: Role): string => homeFor(role);

export type ShopDashboardEntry =
  | { kind: "none" }
  | { kind: "single"; membership: Membership }
  | { kind: "choose"; memberships: Membership[] };

/**
 * How the "Switch to Shop Dashboard" control behaves: hidden without any
 * managed shop, direct with exactly one, a selector when several are managed.
 */
export function shopDashboardEntry(list: Membership[]): ShopDashboardEntry {
  const managed = managedMemberships(list);
  if (managed.length === 0) return { kind: "none" };
  if (managed.length === 1) return { kind: "single", membership: managed[0]! };
  return { kind: "choose", memberships: managed };
}

/** Human label for the workspace a role opens. */
export function dashboardLabelFor(role: Role): string {
  return role === "admin" ? "Shop admin" : role === "reseller" ? "Reseller" : "Subreseller";
}
