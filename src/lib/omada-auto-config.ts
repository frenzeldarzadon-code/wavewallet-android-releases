/**
 * Pure helpers for AUTOMATIC Omada external-portal configuration.
 *
 * WaveWallet only claims a portal is configured automatically when the
 * controller itself proves it: every write is followed by reading the portal
 * back, and only a read-back that really shows the External Portal Server with
 * WaveWallet's own address counts as success. Anything else is reported as
 * "automatic setup is not available on this controller" together with the exact
 * manual steps — never as a silent success.
 */

/** Omada's authentication type for "External Portal Server". */
export const EXTERNAL_PORTAL_AUTH_TYPE = 4;

export interface AutoConfigStep {
  step: string;
  ok: boolean;
  detail: string;
}

export type AutoConfigStatus =
  | "configured"
  | "already_configured"
  | "unsupported"
  | "failed";

/** One attempt shape for the controller's ExternalServerPortalSetting object. */
export interface ExternalPortalVariant {
  label: string;
  externalPortal: Record<string, unknown>;
}

/** Splits a full WaveWallet portal URL the way Omada stores it. */
export function splitPortalUrl(url: string): { host: string; path: string; scheme: string } {
  const scheme = url.startsWith("http://") ? "http" : "https";
  const rest = url.replace(/^https?:\/\//, "");
  const slash = rest.indexOf("/");
  return {
    scheme,
    host: slash === -1 ? rest : rest.slice(0, slash),
    path: slash === -1 ? "" : rest.slice(slash),
  };
}

/**
 * The candidate payload shapes we are willing to try, most specific first.
 * Controllers differ in whether they want the bare host or host + path, so the
 * variants are attempted in order and each one is verified by reading back.
 */
export function externalPortalVariants(url: string): ExternalPortalVariant[] {
  const { host, path, scheme } = splitPortalUrl(url);
  return [
    {
      label: "hostname + path",
      externalPortal: { hostType: 2, serverUrl: `${host}${path}`, scheme },
    },
    { label: "hostname", externalPortal: { hostType: 2, serverUrl: host, scheme } },
    { label: "server address", externalPortal: { hostType: 1, serverUrl: host } },
  ];
}

/**
 * Builds the update body for ONE portal: the portal's current settings are kept
 * as they are, and only the authentication type and external-portal address are
 * changed. Nothing the admin configured in Omada (name, SSIDs, timeouts) is
 * invented or dropped here.
 */
export function buildExternalPortalPatch(
  current: Record<string, unknown>,
  variant: ExternalPortalVariant,
): Record<string, unknown> {
  const keep = [
    "name",
    "enable",
    "ssidList",
    "networkList",
    "authTimeout",
    "httpsRedirectEnable",
    "landingPage",
    "landingUrlScheme",
    "landingUrl",
    "rateLimit",
    "expirationTime",
  ];
  const body: Record<string, unknown> = {};
  for (const key of keep) if (current[key] !== undefined) body[key] = current[key];
  body["authType"] = EXTERNAL_PORTAL_AUTH_TYPE;
  body["externalPortal"] = variant.externalPortal;
  return body;
}

/** Restores exactly the settings that were read before WaveWallet touched them. */
export function buildRestorePatch(snapshot: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (key === "id" || value === undefined || value === null) continue;
    body[key] = value;
  }
  return body;
}

/**
 * Did the controller really store WaveWallet's external portal?
 *
 * The read-back must show BOTH the External Portal Server auth type and an
 * address that points at this exact WaveWallet portal URL. A controller that
 * answers "Success" but stores something else is treated as unsupported.
 */
export function readbackMatchesExternalPortal(
  readback: Record<string, unknown> | null,
  url: string,
): boolean {
  if (!readback) return false;
  if (Number(readback["authType"]) !== EXTERNAL_PORTAL_AUTH_TYPE) return false;
  const ext = readback["externalPortal"];
  if (!ext || typeof ext !== "object") return false;
  const { host } = splitPortalUrl(url);
  const stored = Object.values(ext as Record<string, unknown>)
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  return stored.includes(host.toLowerCase());
}

/** The exact manual steps an operator follows when the API cannot do it. */
export function manualPortalSteps(url: string, portalName: string | null): string[] {
  const portal = portalName ? `"${portalName}"` : "the portal you connected here";
  return [
    `Open your Omada controller and go to Site Settings → Authentication → Portal, then open ${portal}.`,
    "Set Authentication Type to “External Portal Server”.",
    `Paste this exact address as the External Portal Server URL: ${url}`,
    "Under Pre-Authentication Access (Free Authentication Policy), allow the WaveWallet address so customers can open the page before they are online.",
    "Save the portal in Omada, then press Test here to confirm WaveWallet can see it.",
  ];
}

/** Short, non-technical summary of an automatic-configuration attempt. */
export function summarizeAutoConfig(status: AutoConfigStatus): string {
  switch (status) {
    case "configured":
      return "WaveWallet set this portal up in Omada automatically.";
    case "already_configured":
      return "This portal already points at WaveWallet in Omada.";
    case "unsupported":
      return "This controller does not allow WaveWallet to change the portal. Follow the manual steps below.";
    default:
      return "Automatic setup did not complete. Your portal was left exactly as it was.";
  }
}
