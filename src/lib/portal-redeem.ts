/**
 * Pure helpers for handing a Voucher Shop code back to the controller's OWN
 * portal page, where Omada's native voucher form redeems it.
 *
 * WaveWallet never calls /portal/auth itself: the controller only accepts
 * that request from the connecting client's own browser (verified against the
 * live controller, which answers HTTP 500 to any other caller). So after a
 * purchase — or manual entry on the wallet-hosted page — the browser is sent
 * back to the exact portal page it came from, carrying a single-use connect
 * ticket, NEVER the code. The generated page exchanges the ticket and submits
 * the controller's own form, so redemption is Omada's own authentication.
 *
 * Everything here is pure so it can be tested without a database.
 */

/** How long a connect ticket stays valid. Short: it is a one-trip value. */
export const REDEEM_TTL_MS = 10 * 60_000;

/** WaveWallet's own link parameters; never part of the Omada client context. */
const WW_LINK_PARAMS = new Set(["wwRedeem", "wwSession", "wwPortal", "wwIntent"]);

/**
 * Keeps only what the controller itself put on the redirect: string values,
 * bounded in size and count, with WaveWallet's own parameters removed.
 */
export function sanitizePortalContext(
  search: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!search || typeof search !== "object") return out;
  for (const [key, value] of Object.entries(search)) {
    if (WW_LINK_PARAMS.has(key)) continue;
    if (typeof value !== "string" || !value) continue;
    if (key.length > 64 || value.length > 512) continue;
    if (Object.keys(out).length >= 40) break;
    out[key] = value;
  }
  return out;
}

/**
 * The page address a customized portal reported about itself is only trusted
 * when it points at the SAME host as the shop's saved controller connection
 * (any port: Omada often serves the portal and the API on different ports).
 * Anything else could send the customer — and their connect ticket — to a
 * page the shop does not own.
 */
export function portalPageUrlAllowed(
  pageUrl: string | null | undefined,
  baseUrl: string | null | undefined,
): boolean {
  if (!pageUrl || !baseUrl) return false;
  try {
    const page = new URL(pageUrl);
    const base = new URL(baseUrl);
    if (page.protocol !== "http:" && page.protocol !== "https:") return false;
    return page.hostname.toLowerCase() === base.hostname.toLowerCase();
  } catch {
    return false;
  }
}

export interface PortalSessionContext {
  clientMac: string | null;
  apMac: string | null;
  ssid: string | null;
  radioId: string | null;
  siteRef: string | null;
  redirectUrl: string | null;
}

export interface ReturnUrlInput {
  /** The controller portal page's own address, when the page reported one. */
  pageUrl: string | null;
  /** The shop's saved controller address; the fallback destination. */
  baseUrl: string | null;
  /** The original Omada redirect context, verbatim. */
  rawQuery: Record<string, unknown> | null;
  /** Parsed session fields, used only when no verbatim context was kept. */
  session: PortalSessionContext;
  /** The single-use connect ticket. Never the voucher code. */
  token: string;
}

/**
 * Builds the address that returns the customer to the controller's own portal
 * page with their connect ticket. The original Omada context is carried back
 * UNCHANGED so the page loads exactly as the controller first served it; only
 * `wwRedeem` is added. Returns null when no safe destination exists.
 */
export function buildPortalReturnUrl(input: ReturnUrlInput): string | null {
  const params = new URLSearchParams();
  const raw = input.rawQuery && typeof input.rawQuery === "object" ? input.rawQuery : null;
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (WW_LINK_PARAMS.has(key)) continue;
      if (typeof value !== "string" || !value) continue;
      params.set(key, value);
    }
  }
  if (Array.from(params.keys()).length === 0) {
    // No verbatim context (older session): rebuild the names Omada itself uses.
    const s = input.session;
    if (s.clientMac) params.set("clientMac", s.clientMac);
    if (s.apMac) params.set("apMac", s.apMac);
    if (s.ssid) params.set("ssidName", s.ssid);
    if (s.radioId !== null && s.radioId !== "") params.set("radioId", String(s.radioId));
    if (s.siteRef) params.set("site", s.siteRef);
    if (s.redirectUrl) params.set("originUrl", s.redirectUrl);
  }
  params.set("wwRedeem", input.token);

  if (portalPageUrlAllowed(input.pageUrl, input.baseUrl)) {
    try {
      const page = new URL(input.pageUrl as string);
      const merged = new URLSearchParams(page.search);
      for (const key of WW_LINK_PARAMS) merged.delete(key);
      params.forEach((value, key) => merged.set(key, value));
      page.search = merged.toString();
      page.hash = "";
      return page.toString();
    } catch {
      /* fall through to the base-url form below */
    }
  }

  if (!input.baseUrl) return null;
  try {
    const base = new URL(input.baseUrl);
    const path = base.pathname.replace(/\/+$/, "");
    return `${base.origin}${path}/portal?${params.toString()}`;
  } catch {
    return null;
  }
}
