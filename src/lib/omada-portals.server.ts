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
  authorizeScope: "site" | "controller" | "hotspot" | null;
  /** HTTP method the controller accepts on the authorize path. */
  authorizeMethod: "GET" | "POST" | null;

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

async function rawPostJson(url: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = text.slice(0, 2000);
    try {
      parsed = JSON.parse(text);
    } catch {
      /* HTML means the controller served its web app instead of the API */
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch {
    return { ok: false, status: 0, body: null as unknown };
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

const PORTAL_LIST = /\/(setting\/portals|hotspot\/portals|portals)$/;
const AUTHORIZE = /(extportal\/auth)$/i;

/**
 * Read-only portal listings Omada actually serves. `/portals` is the site-scoped
 * listing of the Open API v1 (controller 5.x/6.x); the two `setting`/`hotspot`
 * spellings are kept for older builds. Order matters: the first that answers a
 * clean envelope wins.
 */
const PROBE_LIST_PATHS = ["/portals", "/setting/portals", "/hotspot/portals"];

/**
 * There is NO client-authorization endpoint in the Open API v1 surface.
 *
 * `/openapi/v1/{omadacId}/sites/{siteId}/clients/authorize` merely matches the
 * client-detail route `/clients/{clientMac}` with the literal MAC "authorize",
 * so the controller answers `-41011 This client does not exist.` — for ANY
 * request, including one carrying a real, connected client's MAC. Treating that
 * reply as proof of support made WaveWallet call a non-existent endpoint on
 * every purchase. Client authorization is only available through the documented
 * External Portal API, which needs a Hotspot Operator sign-in.
 */
const EXT_PORTAL_LOGIN = (base: string, omadacId: string) =>
  `${base}/${omadacId}/api/v2/hotspot/login`;
const EXT_PORTAL_AUTH_PATH = "/{omadacId}/api/v2/hotspot/extPortal/auth";


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
export interface DiscoverOptions {
  /** Whether this shop saved a Hotspot Operator sign-in for the portal API. */
  hotspotOperatorConfigured?: boolean;
}

export async function discoverPortalCapabilities(
  session: OmadaSession,
  opts?: DiscoverOptions,
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
    authorizeMethod: null,
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
      // Client authorization is deliberately NOT taken from this document: the
      // Open API surface has no such route, and the only endpoint that works is
      // the External Portal API probed further below.
      void AUTHORIZE;

    }
    caps.notes.push(
      `Read the controller's own API document (${Object.keys(paths).length} documented paths).`,
    );
  } else {
    caps.notes.push(
      "This controller does not publish an API document, so the endpoints below were verified live against it.",
    );
  }

  const sitePrefix = `${session.base}/openapi/v1/${session.omadacId}/sites/${session.siteId}`;

  if (!caps.listSupported) {
    for (const path of PROBE_LIST_PATHS) {
      const res = await rawGet(`${sitePrefix}${path}`, session.token);
      const env = omadaEnvelope(res.body);
      if (res.ok && (env.code === null || env.code === 0)) {
        caps.listSupported = true;
        caps.listPath = `/openapi/v1/{omadacId}/sites/{siteId}${path}`;
        caps.notes.push(
          `Portal listing verified live at ${path} (${rowsOf(env.result).length} portal(s) on the probed site).`,
        );
        break;
      }
      caps.notes.push(
        `No portal listing at ${path} (${env.msg || `HTTP ${res.status}`}${
          env.code !== null && env.code !== 0 ? ` / code ${env.code}` : ""
        }).`,
      );
    }
  }

  // Client authorization: the documented External Portal API. The probe only
  // checks that the hotspot login ROUTE exists and answers a JSON envelope; it
  // never signs in with real credentials here and never touches a client.
  {
    const res = await rawPostJson(EXT_PORTAL_LOGIN(session.base, session.omadacId), {});
    const env = omadaEnvelope(res.body);
    const routeExists = env.code !== null;
    if (!routeExists) {
      caps.notes.push(
        "This controller did not answer the external-portal hotspot API, so devices cannot be put online automatically.",
      );
    } else if (!opts?.hotspotOperatorConfigured) {
      caps.notes.push(
        "The external-portal hotspot API is available, but this shop has not saved a Hotspot Operator sign-in yet.",
      );
    } else {
      caps.authorizeSupported = true;
      caps.authorizeScope = "hotspot";
      caps.authorizeMethod = "POST";
      caps.authorizePath = EXT_PORTAL_AUTH_PATH;
      caps.notes.push(
        "Client authorization uses the external-portal hotspot API with this shop's own Hotspot Operator sign-in.",
      );
    }
  }


  if (!caps.listSupported) {
    caps.limitation =
      "This controller answered every known portal-listing endpoint with an error, so no portal can be listed. " +
      "Check that the Omada Open API application used by this shop has View (read) permission on this site, then test again. " +
      "The exact controller replies are listed above.";
  } else if (!caps.authorizeSupported) {
    caps.limitation =
      "Portals can be read, but WaveWallet cannot put a device online automatically yet. " +
      "Automatic sign-on uses the controller's external-portal hotspot API, which needs this shop's own Hotspot Operator username and password saved in the Omada connection settings. " +
      "Until then, customers can still buy a voucher in the portal and enter the code on the hotspot login page — WaveWallet never reports a false success.";
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
    if (caps.authorizeMethod === "GET") {
      // 6.x takes the authorization as query parameters on a GET route.
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) query.set(k, String(v));
      await omadaSiteCall(session, `${suffix}?${query.toString()}`);
    } else {
      await omadaSiteCall(session, suffix, { method: "POST", body: JSON.stringify(body) });
    }
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
