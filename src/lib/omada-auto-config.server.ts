/**
 * Server-only automatic Omada portal configuration for ONE shop.
 *
 * Safety rules that must never be relaxed:
 *  - the controller's real capability is proven on a DISPOSABLE probe portal
 *    (created disabled, bound to no SSID and deleted again) before any real
 *    portal of the shop is touched;
 *  - the selected portal's current settings are read and kept before any write,
 *    and restored when the write did not produce the expected result;
 *  - success is only reported when reading the portal back really shows
 *    WaveWallet's External Portal Server address.
 */
import type { OmadaSession } from "./omada-api.server";
import { omadaEnvelope } from "./omada-api.server";
import {
  buildExternalPortalPatch,
  buildRestorePatch,
  externalPortalVariants,
  readbackMatchesExternalPortal,
  type AutoConfigStatus,
  type AutoConfigStep,
} from "./omada-auto-config";

const PROBE_NAME = "WaveWallet setup check";

function sitePath(session: OmadaSession, siteId: string): string {
  return `${session.base}/openapi/v1/${session.omadacId}/sites/${siteId}`;
}

async function call(
  session: OmadaSession,
  url: string,
  init: RequestInit = {},
): Promise<{ code: number | null; msg: string; result: unknown; status: number }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `AccessToken=${session.token}`,
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  let body: unknown = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = null;
  }
  const env = omadaEnvelope(body);
  return { ...env, status: res.status };
}

export async function readPortalConfig(
  session: OmadaSession,
  siteId: string,
  portalId: string,
): Promise<Record<string, unknown> | null> {
  const res = await call(session, `${sitePath(session, siteId)}/portal/${portalId}`);
  if (res.code !== 0 || !res.result || typeof res.result !== "object") return null;
  return res.result as Record<string, unknown>;
}

/**
 * Proves — on a throwaway portal — whether this controller really stores an
 * External Portal Server set through the API. The probe portal is always
 * removed again, including when a step fails.
 */
export async function probeExternalPortalSupport(
  session: OmadaSession,
  siteId: string,
  url: string,
): Promise<{ supported: boolean; detail: string; variantLabel: string | null }> {
  const base = sitePath(session, siteId);
  const created = await call(session, `${base}/portal`, {
    method: "POST",
    body: JSON.stringify({
      name: `${PROBE_NAME} ${Date.now().toString(36)}`,
      enable: false,
      ssidList: [],
      networkList: [],
      authType: 0,
      httpsRedirectEnable: false,
      landingPage: 1,
      authTimeout: { authTimeout: 5, customTimeout: 8, customTimeoutUnit: 2 },
      portalCustomize: {
        defaultLanguage: 0,
        logoDisplay: false,
        welcomeEnable: false,
        copyrightEnable: false,
        termsOfServiceEnable: false,
      },
    }),
  });
  const probeId = typeof created.result === "string" ? created.result : null;
  if (created.code !== 0 || !probeId) {
    return {
      supported: false,
      detail:
        "This controller does not let WaveWallet create or change portals through its API, so the portal must be set up in Omada by hand.",
      variantLabel: null,
    };
  }
  try {
    const current = (await readPortalConfig(session, siteId, probeId)) ?? {};
    for (const variant of externalPortalVariants(url)) {
      const patch = await call(session, `${base}/portal/${probeId}`, {
        method: "PATCH",
        body: JSON.stringify(buildExternalPortalPatch(current, variant)),
      });
      if (patch.code !== 0) continue;
      const readback = await readPortalConfig(session, siteId, probeId);
      if (readbackMatchesExternalPortal(readback, url)) {
        return {
          supported: true,
          detail: "This controller accepts and keeps the WaveWallet portal address.",
          variantLabel: variant.label,
        };
      }
    }
    return {
      supported: false,
      detail:
        "This controller accepts the request but does not keep an External Portal Server set from outside, so it has to be set in Omada by hand.",
      variantLabel: null,
    };
  } finally {
    await call(session, `${base}/portal/${probeId}`, { method: "DELETE" }).catch(() => undefined);
  }
}

/** Read-only check of whether pre-authentication access can be managed by API. */
export async function probePreAuthSupport(
  session: OmadaSession,
  siteId: string,
): Promise<{ supported: boolean; detail: string }> {
  const base = sitePath(session, siteId);
  for (const path of ["/free-auth-policies", "/portal/free-auth-policies", "/authentication/free-auth"]) {
    const res = await call(session, `${base}${path}?page=1&pageSize=1`);
    if (res.status !== 404 && res.code === 0) {
      return { supported: true, detail: `Pre-authentication access can be managed (${path}).` };
    }
  }
  return {
    supported: false,
    detail:
      "This controller does not publish pre-authentication access, so allow the WaveWallet address in Omada once by hand.",
  };
}

export interface AutoConfigOutcome {
  status: AutoConfigStatus;
  steps: AutoConfigStep[];
  snapshot: Record<string, unknown> | null;
}

/**
 * Configures ONE real portal of ONE shop, with snapshot + verification, and
 * puts the portal back exactly as it was when verification fails.
 */
export async function applyExternalPortal(
  session: OmadaSession,
  siteId: string,
  portalId: string,
  url: string,
): Promise<AutoConfigOutcome> {
  const steps: AutoConfigStep[] = [];
  const base = sitePath(session, siteId);

  const current = await readPortalConfig(session, siteId, portalId);
  if (!current) {
    steps.push({
      step: "Read the portal",
      ok: false,
      detail: "This portal could not be read from your controller. Nothing was changed.",
    });
    return { status: "failed", steps, snapshot: null };
  }
  steps.push({
    step: "Read the portal",
    ok: true,
    detail: `Current settings of "${String(current["name"] ?? portalId)}" saved before any change.`,
  });

  if (readbackMatchesExternalPortal(current, url)) {
    steps.push({
      step: "Already pointing at WaveWallet",
      ok: true,
      detail: "No change was needed.",
    });
    return { status: "already_configured", steps, snapshot: current };
  }

  const probe = await probeExternalPortalSupport(session, siteId, url);
  steps.push({
    step: "Controller capability",
    ok: probe.supported,
    detail: probe.detail,
  });
  if (!probe.supported) return { status: "unsupported", steps, snapshot: current };

  for (const variant of externalPortalVariants(url)) {
    const patch = await call(session, `${base}/portal/${portalId}`, {
      method: "PATCH",
      body: JSON.stringify(buildExternalPortalPatch(current, variant)),
    });
    if (patch.code !== 0) continue;
    const readback = await readPortalConfig(session, siteId, portalId);
    if (readbackMatchesExternalPortal(readback, url)) {
      steps.push({
        step: "Portal configured",
        ok: true,
        detail: `Omada now sends customers of this portal to ${url}.`,
      });
      const preAuth = await probePreAuthSupport(session, siteId);
      steps.push({ step: "Pre-authentication access", ok: preAuth.supported, detail: preAuth.detail });
      return { status: "configured", steps, snapshot: current };
    }
    // The controller reported success but stored something else: undo at once.
    await call(session, `${base}/portal/${portalId}`, {
      method: "PATCH",
      body: JSON.stringify(buildRestorePatch(current)),
    }).catch(() => undefined);
  }

  steps.push({
    step: "Portal configured",
    ok: false,
    detail: "The controller did not keep the change, so your portal was restored exactly as it was.",
  });
  return { status: "unsupported", steps, snapshot: current };
}
