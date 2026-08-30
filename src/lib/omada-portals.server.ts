/**
 * Captive-portal capabilities of ONE tenant's own Omada controller.
 *
 * Nothing here is guessed. The controller publishes its own OpenAPI document
 * behind the same access token the rest of the integration already uses, so the
 * portal-listing and client-authorization endpoints are DISCOVERED from that
 * document. When the document is unavailable, a small set of endpoints that
 * Omada actually publishes in its Northbound Open API is probed read-only; a
 * write endpoint is never invented. If neither route can be verified the
 * capability is reported as unsupported with an explicit reason — WaveWallet
 * never reports a fake success.
 */
import { OmadaError, omadaEnvelope, omadaSiteCall, type OmadaSession } from "./omada-api.server";
import { loadOmadaSpec } from "./omada-vouchers.server";

const TIMEOUT_MS = 15_000;

export interface PortalCapabilities {
  controllerVersion: string | null;
  apiVersion: string | null;
  /** Portals of the selected site can be listed. */
  listSupported: boolean;
  listPath: string | null;
  /** A client can be put online through the controller. */
  authorizeSupported: boolean;
  authorizePath: string | null;
  /** How the authorize path is scoped: site-relative or controller-relative. */
  authorizeScope: "site" | "controller" | null;
  /** Human-readable reason when something is not available. */
  limitation: string | null;
  /** Every discovery step, shown verbatim to the admin. */
  notes: string[];
}

export interface OmadaPortal {
  id: string;
  name: string;
  ssids: string[];
  raw: Record<string, string | number | boolean | null>;
}

/* ------------------------------------------------------------------ *
 * Low-level                                                           *
 * ------------------------------------------------------------------ */

async function rawGet(url: string, token: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `AccessToken=${token}`, accept: "application/json" },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text.slice(0, 8000);
    try {
      body = JSON.parse(text);
    } catch {
      /* keep truncated text */
    }
    return { ok: res.ok, status: res.status, body, error: null as string | null };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null as unknown,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls the first array of objects out of an Omada `result` envelope. */
export function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result.filter((r) => r && typeof r === "object") as Array<
    Record<string, unknown>
  >;
  if (result && typeof result === "object") {
    for (const key of ["data", "list", "portals", "records"]) {
      const value = (result as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value.filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>;
      }
    }
  }
  return [];
}

function flat(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else out[k] = JSON.stringify(v).slice(0, 300);
  }
  return out;
}

/** Normalises one controller portal row into the shape the admin picks from. */
export function toPortal(row: Record<string, unknown>): OmadaPortal | null {
  const id = ["id", "portalId", "_id", "portalIdStr"]
    .map((k) => row[k])
    .find((v) => typeof v === "string" && v) as string | undefined;
  if (!id) return null;
  const name =
    (["name", "portalName", "title"].map((k) => row[k]).find((v) => typeof v === "string" && v) as
      | string
      | undefined) ?? id;
  const ssidRaw = row["ssidList"] ?? row["ssids"] ?? row["ssidName"] ?? row["ssidInfo"];
  const ssids: string[] = [];
  if (Array.isArray(ssidRaw)) {
    for (const entry of ssidRaw) {
      if (typeof entry === "string") ssids.push(entry);
      else if (entry && typeof entry === "object") {
        const n = (entry as Record<string, unknown>)["ssidName"] ?? (entry as Record<string, unknown>)["name"];
        if (typeof n === "string") ssids.push(n);
      }
    }
  } else if (typeof ssidRaw === "string" && ssidRaw) {
    ssids.push(ssidRaw);
  }
  return { id, name, ssids, raw: flat(row) };
}

/* ------------------------------------------------------------------ *
 * Discovery                                                           *
 * ------------------------------------------------------------------ */

const PORTAL_LIST = /\/(setting|hotspot)\/portals$/;
const AUTHORIZE =
  /(extportal\/auth|hotspot\/auth|clients\/\{[^}]+\}\/authorize|authorize\/client|portal\/auth)$/i;

/** Candidate read-only portal listings that Omada publishes for v5/v6 controllers. */
const PROBE_LIST_PATHS = ["/setting/portals", "/hotspot/portals"];

export async function readInfo(session: OmadaSession) {
  const res = await rawGet(`${session.base}/api/info`, session.token);
  const result = omadaEnvelope(res.body).result as Record<string, unknown> | null;
  return {
    controllerVersion: typeof result?.["controllerVer"] === "string" ? (result["controllerVer"] as string) : null,
    apiVersion: result?.["apiVer"] === undefined || result?.["apiVer"] === null ? null : String(result["apiVer"]),
  };
}

/**
 * Works out what this controller can actually do for a WaveWallet captive
 * portal. Every branch records why, so the admin sees the real state.
 */
export async function discoverPortalCapabilities(
  session: OmadaSession,
): Promise<PortalCapabilities> {
  const info = await readInfo(session);
  const caps: PortalCapabilities = {
    controllerVersion: info.controllerVersion,
    apiVersion: info.apiVersion,
    listSupported: false,
    listPath: null,
    authorizeSupported: false,
    authorizePath: null,
    authorizeScope: null,
    limitation: null,
    notes: [],
  };
  caps.notes.push(
    `Controller ${info.controllerVersion ?? "unknown"} (Open API v${info.apiVersion ?? "?"}).`,
  );

  const spec = await loadOmadaSpec(session);
  if (spec) {
    const paths = (spec["paths"] as Record<string, Record<string, unknown>>) ?? {};
    for (const [path, ops] of Object.entries(paths)) {
      if (!caps.listPath && PORTAL_LIST.test(path) && ops["get"]) {
        caps.listPath = path;
        caps.listSupported = true;
      }
      if (!caps.authorizePath && AUTHORIZE.test(path) && (ops["post"] || ops["put"])) {
        caps.authorizePath = path;
        caps.authorizeSupported = true;
        caps.authorizeScope = path.includes("/sites/{siteId}") ? "site" : "controller";
      }
    }
    caps.notes.push(
      `Read the controller's own API document (${Object.keys(paths).length} documented paths).`,
    );
  } else {
    caps.notes.push(
      "The controller did not publish its API document to this API application; falling back to read-only probing.",
    );
  }

  if (!caps.listSupported) {
    for (const path of PROBE_LIST_PATHS) {
      const res = await rawGet(
        `${session.base}/openapi/v1/${session.omadacId}/sites/${session.siteId}${path}`,
        session.token,
      );
      const env = omadaEnvelope(res.body);
      if (res.ok && (env.code === null || env.code === 0)) {
        caps.listSupported = true;
        caps.listPath = `/openapi/v1/{omadacId}/sites/{siteId}${path}`;
        caps.notes.push(`Portal listing verified live at ${path}.`);
        break;
      }
      caps.notes.push(`No portal listing at ${path} (${env.msg || `HTTP ${res.status}`}).`);
    }
  }

  if (!caps.listSupported) {
    caps.limitation =
      "This controller does not expose its captive portals to the Open API application, so a portal cannot be selected. Grant the API client site-setting permission on the controller, then test again.";
  } else if (!caps.authorizeSupported) {
    caps.limitation =
      "Portals can be read, but this controller did not publish a client-authorization endpoint to this API application. Customers can still buy a voucher in the portal and enter it in the hotspot login page; automatic sign-on stays disabled rather than reporting a false success.";
  }
  return caps;
}

/** The portals of ONE site, exactly as the controller reports them. */
export async function listSitePortals(
  session: OmadaSession,
  caps: PortalCapabilities,
): Promise<OmadaPortal[]> {
  if (!caps.listSupported || !caps.listPath) {
    throw new OmadaError(caps.limitation ?? "Portal listing is not available on this controller.", "api");
  }
  const suffix = caps.listPath.replace(/^.*\{siteId\}/, "");
  const result = await omadaSiteCall(session, suffix);
  const portals = rowsOf(result)
    .map(toPortal)
    .filter((p): p is OmadaPortal => Boolean(p));
  return portals;
}

/* ------------------------------------------------------------------ *
 * Authorization                                                       *
 * ------------------------------------------------------------------ */

export interface AuthorizeInput {
  clientMac: string;
  apMac: string | null;
  ssidName: string | null;
  radioId: string | null;
  /** Access duration in milliseconds, derived from the purchased product. */
  durationMs: number;
  /** The real voucher code bought from the shop's own Voucher Shop. */
  voucherCode?: string | null;
}

export interface AuthorizeOutcome {
  ok: boolean;
  detail: string;
}

/**
 * Puts the CURRENT client online for the purchased duration. Throws a typed
 * OmadaError when the capability was never verified — the caller must surface
 * that honestly instead of pretending the customer is connected.
 */
export async function authorizePortalClient(
  session: OmadaSession,
  caps: PortalCapabilities,
  input: AuthorizeInput,
): Promise<AuthorizeOutcome> {
  if (!caps.authorizeSupported || !caps.authorizePath) {
    throw new OmadaError(
      caps.limitation ??
        "This controller did not publish a client-authorization endpoint, so WaveWallet cannot put the device online automatically.",
      "api",
    );
  }
  const body: Record<string, unknown> = {
    clientMac: input.clientMac,
    time: Math.max(60_000, Math.round(input.durationMs)),
    authType: input.voucherCode ? 2 : 4,
  };
  if (input.apMac) body["apMac"] = input.apMac;
  if (input.ssidName) body["ssidName"] = input.ssidName;
  if (input.radioId !== null && input.radioId !== undefined && input.radioId !== "") {
    body["radioId"] = Number(input.radioId);
  }
  if (input.voucherCode) body["voucherCode"] = input.voucherCode;

  if (caps.authorizeScope === "site") {
    const suffix = caps.authorizePath.replace(/^.*\{siteId\}/, "");
    await omadaSiteCall(session, suffix, { method: "POST", body: JSON.stringify(body) });
    return { ok: true, detail: "The controller accepted the authorization." };
  }

  const url = `${session.base}${caps.authorizePath
    .replace("{omadacId}", session.omadacId)
    .replace("{siteId}", session.siteId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `AccessToken=${session.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = text.slice(0, 2000);
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const env = omadaEnvelope(parsed);
    if (!res.ok || (env.code !== null && env.code !== 0)) {
      throw new OmadaError(
        `The controller refused the authorization: ${env.msg || `HTTP ${res.status}`}`,
        "api",
      );
    }
    return { ok: true, detail: "The controller accepted the authorization." };
  } catch (e) {
    if (e instanceof OmadaError) throw e;
    throw new OmadaError(
      `Controller not reachable: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
      "unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
}
