/**
 * Pure helpers for the WaveWallet customer captive portal.
 *
 * The shop a captive-portal visitor belongs to is ALWAYS resolved from a saved
 * mapping, never from anything the browser can choose. These helpers are shared
 * by the server (authoritative resolution) and the admin UI (preview + the exact
 * URL to paste into Omada), so both can never drift apart.
 */

export interface PortalFeatureFlags {
  /** Buy a voucher from this shop's existing Voucher Shop inside the portal. */
  allowPurchase: boolean;
  showCoins: boolean;
  showPoints: boolean;
  showVoucherStatus: boolean;
  showHistory: boolean;
  /** Keep the customer signed in on this device between hotspot sessions. */
  rememberCustomer: boolean;
}

export const DEFAULT_PORTAL_FLAGS: PortalFeatureFlags = {
  allowPurchase: true,
  showCoins: true,
  showPoints: true,
  showVoucherStatus: true,
  showHistory: false,
  rememberCustomer: true,
};

export function normalizePortalFlags(value: unknown): PortalFeatureFlags {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const pick = (key: keyof PortalFeatureFlags) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : DEFAULT_PORTAL_FLAGS[key];
  return {
    allowPurchase: pick("allowPurchase"),
    showCoins: pick("showCoins"),
    showPoints: pick("showPoints"),
    showVoucherStatus: pick("showVoucherStatus"),
    showHistory: pick("showHistory"),
    rememberCustomer: pick("rememberCustomer"),
  };
}

/** Everything Omada appends to the external-portal redirect. */
export interface PortalParams {
  mappingId: string | null;
  clientMac: string | null;
  apMac: string | null;
  ssidName: string | null;
  radioId: string | null;
  siteRef: string | null;
  redirectUrl: string | null;
}

const ALIASES: Record<keyof Omit<PortalParams, "mappingId">, string[]> = {
  clientMac: ["clientMac", "client_mac", "mac"],
  apMac: ["apMac", "ap_mac", "ap"],
  ssidName: ["ssidName", "ssid", "ssid_name"],
  radioId: ["radioId", "radio_id", "radio"],
  siteRef: ["site", "siteId", "site_id"],
  // NOTE: Omada's `t` is the redirect TIMESTAMP, never a URL. Treating it as a
  // redirect target sent customers to a bogus address after signing on.
  redirectUrl: ["redirectUrl", "redirect_url", "originUrl"],
};

function first(search: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = search[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function parsePortalParams(search: Record<string, unknown>): PortalParams {
  return {
    mappingId: first(search, ["wwPortal", "ww_portal", "portal"]),
    clientMac: normalizeMac(first(search, ALIASES.clientMac)),
    apMac: normalizeMac(first(search, ALIASES.apMac)),
    ssidName: first(search, ALIASES.ssidName),
    radioId: first(search, ALIASES.radioId),
    siteRef: first(search, ALIASES.siteRef),
    redirectUrl: first(search, ALIASES.redirectUrl),
  };
}

/** Omada reports MACs in several separators; compare them in one shape. */
export function normalizeMac(value: string | null): string | null {
  if (!value) return null;
  const hex = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12) return value.toUpperCase();
  return (hex.match(/.{2}/g) ?? []).join("-");
}

export interface MappingCandidate {
  id: string;
  ecosystemId: string;
  siteId: string;
  siteName: string | null;
  portalId: string;
  portalName: string | null;
  ssidInfo: string | null;
  enabled: boolean;
}

export type MappingResolution =
  | { ok: true; mapping: MappingCandidate }
  | { ok: false; reason: string };

/**
 * Picks the ONE mapping this visitor belongs to.
 *
 * An explicit mapping id always wins. Otherwise the site (and network name when
 * Omada sent one) must identify exactly one enabled mapping — an ambiguous
 * match is refused rather than guessed, because guessing would put a customer
 * in the wrong shop.
 */
export function resolveMapping(
  mappings: MappingCandidate[],
  params: Pick<PortalParams, "mappingId" | "siteRef" | "ssidName">,
): MappingResolution {
  const enabled = mappings.filter((m) => m.enabled);
  if (params.mappingId) {
    const exact = enabled.find((m) => m.id === params.mappingId);
    if (exact) return { ok: true, mapping: exact };
    const disabled = mappings.find((m) => m.id === params.mappingId);
    return {
      ok: false,
      reason: disabled
        ? "This hotspot portal is currently switched off by the shop."
        : "This hotspot portal is not connected to a WaveWallet shop.",
    };
  }
  if (!params.siteRef) {
    return {
      ok: false,
      reason:
        "This link does not identify a hotspot portal. Ask the operator to use the WaveWallet portal URL shown in their Omada setup.",
    };
  }
  let candidates = enabled.filter((m) => m.siteId === params.siteRef);
  if (candidates.length === 0) {
    return { ok: false, reason: "No WaveWallet shop is connected to this hotspot site." };
  }
  if (candidates.length > 1 && params.ssidName) {
    const bySsid = candidates.filter(
      (m) => (m.ssidInfo ?? "").toLowerCase() === params.ssidName!.toLowerCase(),
    );
    if (bySsid.length > 0) candidates = bySsid;
  }
  if (candidates.length !== 1) {
    return {
      ok: false,
      reason:
        "More than one portal of this site is connected to WaveWallet. Ask the operator to use the exact portal URL shown for each portal in their WaveWallet setup.",
    };
  }
  return { ok: true, mapping: candidates[0]! };
}

/** The exact external-portal URL an admin pastes into ONE Omada portal. */
export function portalUrlFor(origin: string, mappingId: string): string {
  return `${origin.replace(/\/+$/, "")}/portal?wwPortal=${mappingId}`;
}

/**
 * Access length of a product, taken from the shop's own saved Omada voucher
 * calibration. There is no separate portal duration field and no default: a
 * product without a calibration cannot put a device online.
 */
export function durationMinutesFromCalibration(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as Record<string, unknown>)["duration"];
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes);
}

/** "45 minutes", "3 hours", "2 days" — always from the real calibrated value. */
export function formatAccessDuration(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
