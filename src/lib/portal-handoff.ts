/**
 * Post-authentication hand-off from an Omada captive portal to WaveWallet.
 *
 * A generated portal never names its shop in a link. Once the controller has
 * really authenticated the client, the page asks WaveWallet for a short-lived,
 * signed hand-off token. The shop, site and portal inside that token are
 * resolved SERVER-SIDE from the saved mapping, so a customer cannot edit a URL
 * to land in another shop. This module holds the pure parts, shared by the
 * signer, the entry page and the tests.
 */

/** A hand-off stays usable long enough to survive a slow first connection. */
export const HANDOFF_TTL_MS = 30 * 60 * 1000;

/** Replay guard: one authentication, a handful of page opens, never a link to share. */
export const MAX_HANDOFF_USES = 5;

export interface HandoffClaims {
  /** Row id in portal_handoffs — the replay counter. */
  jti: string;
  ecosystemId: string;
  mappingId: string;
  portalId: string | null;
  siteId: string | null;
  expiresAt: number;
}

/** The one WaveWallet endpoint every shop's portal redirects to. */
export function handoffEntryUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/wifi?h=${encodeURIComponent(token)}`;
}

export function handoffClaimsValid(value: unknown, now = Date.now()): value is HandoffClaims {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<HandoffClaims>;
  return (
    typeof c.jti === "string" &&
    c.jti.length > 0 &&
    typeof c.ecosystemId === "string" &&
    c.ecosystemId.length > 0 &&
    typeof c.mappingId === "string" &&
    c.mappingId.length > 0 &&
    typeof c.expiresAt === "number" &&
    Number.isFinite(c.expiresAt) &&
    c.expiresAt > now
  );
}

/** What the entry page is allowed to know. Never a token, credential or MAC. */
export interface HandoffShopContext {
  shopName: string;
  shopSlug: string | null;
  shopDescription: string | null;
  portalName: string | null;
}

export type HandoffResolution =
  | { ok: true; shop: HandoffShopContext }
  | { ok: false; reason: string };

export const HANDOFF_EXPIRED =
  "This Wi-Fi link has expired. Open WaveWallet and sign in to your shop as usual.";
