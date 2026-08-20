/**
 * Where a member goes after authenticating.
 *
 * Members who belong to shops open a shop, not the Universe: their last-used
 * shop when there is one, the only shop when they have exactly one, and the
 * My Shops screen when several shops exist and nothing was used yet. The
 * Universe stays reachable from navigation at all times.
 */
import { fetchMyMemberships, switchEcosystem, switchableMemberships } from "@/lib/memberships";
import { joinShopByCode } from "@/lib/shop-directory";
import { homeFor, landingForMemberships } from "@/lib/session";
import type { Role } from "@/lib/wavewallet";

const PENDING_KEY = "wavewallet.pendingShopCode";

/** A Shop ID captured at sign-up but not yet joinable (email not confirmed). */
export function rememberPendingShopCode(code: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(PENDING_KEY, code);
}

export function takePendingShopCode(): string | null {
  if (typeof window === "undefined") return null;
  const code = window.localStorage.getItem(PENDING_KEY);
  if (code) window.localStorage.removeItem(PENDING_KEY);
  return code;
}

/**
 * Resolves the landing destination, joining a remembered shop first and
 * switching the active shop when needed. Every check is re-run by the database.
 */
export async function destinationAfterAuth(role: Role): Promise<string> {
  if (role === "super_admin") return homeFor(role);

  const pending = takePendingShopCode();
  if (pending) {
    await joinShopByCode(pending).catch(() => undefined);
  }

  const memberships = switchableMemberships(await fetchMyMemberships());
  const landing = landingForMemberships(
    memberships.map((m) => ({ ecosystemId: m.ecosystemId, role: m.role, isActive: m.isActive })),
  );
  if (landing.switchTo) await switchEcosystem(landing.switchTo).catch(() => undefined);
  return landing.to;
}
