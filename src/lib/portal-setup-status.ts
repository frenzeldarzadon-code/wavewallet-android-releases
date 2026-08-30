/**
 * Pure helpers describing what an admin still has to do for ONE captive-portal
 * mapping.
 *
 * WaveWallet never claims that the Omada side is configured: the external
 * portal is only ever reported as verified when the controller itself read the
 * WaveWallet address back. Everything else is either "not verified yet" or an
 * honest limitation of the controller. Nothing here is hard-coded to a tenant:
 * every value is derived from the mapping and the deployed origin.
 */

/** What the controller told us about the external-portal setting, if anything. */
export type ExternalPortalState =
  /** Read back from Omada: the portal really points at this WaveWallet URL. */
  | "verified"
  /** Read back from Omada: it does not point at WaveWallet (yet). */
  | "not_configured"
  /** The controller does not expose this setting through its supported API. */
  | "not_exposed"
  /** Never checked. */
  | "unknown";

export function externalPortalStateFrom(value: string | null | undefined): ExternalPortalState {
  switch (value) {
    case "verified":
    case "configured":
    case "already_configured":
      return "verified";
    case "not_configured":
      return "not_configured";
    case "not_exposed":
    case "unsupported":
      return "not_exposed";
    default:
      return "unknown";
  }
}

export interface PortalSetupState {
  /** WaveWallet could talk to the shop's controller on the last check. */
  controllerVerified: boolean;
  external: ExternalPortalState;
  /** True while the one-time manual Omada configuration is still outstanding. */
  needsManualSetup: boolean;
}

export function portalSetupState(input: {
  lastTestStatus: string | null;
  externalStatus: string | null;
}): PortalSetupState {
  const external = externalPortalStateFrom(input.externalStatus);
  return {
    controllerVerified: input.lastTestStatus === "passed",
    external,
    needsManualSetup: external !== "verified",
  };
}

export function externalPortalLabel(state: ExternalPortalState): string {
  switch (state) {
    case "verified":
      return "External portal verified";
    case "not_configured":
      return "One-time Omada setup required";
    case "not_exposed":
      return "One-time Omada setup required";
    default:
      return "External portal not checked yet";
  }
}

export function externalPortalExplanation(state: ExternalPortalState): string {
  switch (state) {
    case "verified":
      return "Your controller reported this portal's External Portal Server as the WaveWallet address below.";
    case "not_configured":
      return "Your controller answered, but this portal does not point at WaveWallet yet. Set it once in Omada using the instructions below.";
    case "not_exposed":
      return "This controller does not publish the External Portal Server setting through its supported API, so WaveWallet cannot read or change it. Configure it once in Omada using the instructions below.";
    default:
      return "WaveWallet has not checked this portal's External Portal Server yet. Run Test configuration.";
  }
}

/** The host an operator must allow under Pre-Authentication Access. */
export function preAuthValueFor(origin: string): string {
  if (!origin) return "";
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

export interface PortalInstructionInput {
  shopName: string | null;
  siteName: string | null;
  portalName: string | null;
  portalUrl: string;
  origin: string;
}

/**
 * The exact, dynamic steps for THIS portal. Site, portal, shop and address all
 * come from live data — no example hosts and no placeholder names.
 */
export function portalSetupInstructions(input: PortalInstructionInput): string[] {
  const site = input.siteName?.trim() || "the site you connected";
  const portal = input.portalName?.trim() || "the portal you connected";
  const shop = input.shopName?.trim() || "this shop";
  const preAuth = preAuthValueFor(input.origin);
  return [
    `Sign in to your own Omada controller and switch to the site “${site}”.`,
    `Open Site Settings → Authentication → Portal and edit the portal “${portal}”.`,
    "Set Authentication Type to “External Portal Server”.",
    `Use this exact address as the External Portal Server URL for ${shop}: ${input.portalUrl}`,
    preAuth
      ? `Under Pre-Authentication Access (Free Authentication Policy) allow ${preAuth} on ports 80 and 443, so customers can open the page before they are online.`
      : "Under Pre-Authentication Access (Free Authentication Policy) allow the WaveWallet address above, so customers can open the page before they are online.",
    "Save the portal in Omada, then come back and press Test configuration here.",
  ];
}
