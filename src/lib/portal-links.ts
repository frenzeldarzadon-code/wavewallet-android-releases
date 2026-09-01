/**
 * Shop-specific auth links used by the captive portal.
 *
 * The captive portal already resolved the shop SERVER-SIDE from the Omada
 * mapping. These links only carry that shop's public 7-digit Shop ID plus the
 * in-app path to come back to, so signing in or signing up keeps the customer
 * in the SAME shop and the SAME hotspot session. Nothing here can select a
 * different tenant: the portal session, not the link, decides the shop.
 */
import { shopSignInLink, shopSignupLink } from "@/lib/shop-directory";

/** The path that brings the customer back to this exact hotspot session. */
export function portalReturnPath(sessionId: string, pathname = "/portal"): string {
  return `${pathname}?wwSession=${encodeURIComponent(sessionId)}`;
}

export interface PortalAuthLinks {
  signIn: string;
  signUp: string;
}

/**
 * Same-origin links for this shop. Returns null when the shop has no public
 * Shop ID (legacy shops), so the caller can fall back to its own wording.
 */
export function portalAuthLinks(
  shopCode: string | null,
  returnTo: string,
): PortalAuthLinks | null {
  const code = (shopCode ?? "").trim();
  if (!code) return null;
  return {
    signIn: shopSignInLink("", code, returnTo),
    signUp: shopSignupLink("", code, returnTo),
  };
}
