/**
 * TP-Link Omada EXTERNAL PORTAL API (Hotspot) client — server only.
 *
 * This is the API the controller actually exposes for putting a captive-portal
 * client online, as published by TP-Link for Omada controller v6.2.10+:
 *
 *   1. POST {base}/{omadacId}/api/v2/hotspot/login   {name, password}
 *      -> session cookie + `result.token` (the CSRF token)
 *   2. POST {base}/{omadacId}/api/v2/hotspot/extPortal/auth
 *      with the session cookie and `Csrf-Token` header, body:
 *      {clientMac, clientIp, apMac, ssidName, radioId, time, authType: 4}
 *      (wired clients use gatewayMac + vid instead of apMac/ssidName/radioId)
 *
 * The credentials belong to a HOTSPOT OPERATOR account of one shop's own
 * controller. They are stored encrypted with the same key as the Open API
 * client secret and are never returned to the browser. The Open API
 * client-credentials token cannot authorize a portal client; that is a
 * different API surface entirely.
 */
import { OmadaError } from "./omada-api.server";

const TIMEOUT_MS = 15_000;

export interface HotspotCredentials {
  ecosystemId: string;
  base: string;
  omadacId: string;
  operatorUser: string;
  operatorPassword: string;
}

export interface HotspotAuthInput {
  clientMac: string;
  clientIp?: string | null;
  apMac?: string | null;
  ssidName?: string | null;
  radioId?: string | null | number;
  gatewayMac?: string | null;
  vid?: string | null | number;
  /** Authorisation length in milliseconds. */
  timeMs: number;
}

interface HotspotSession {
  cookie: string;
  csrf: string;
  createdAt: number;
}

/** Short-lived, in-process only. Never persisted, never sent to a browser. */
const sessions = new Map<string, HotspotSession>();
const SESSION_TTL_MS = 20 * 60_000;

function normaliseBase(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

function envelope(text: string): { code: number | null; msg: string; result: unknown } {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    return {
      code: typeof body["errorCode"] === "number" ? body["errorCode"] : null,
      msg: typeof body["msg"] === "string" ? body["msg"] : "",
      result: body["result"] ?? null,
    };
  } catch {
    // The controller serves its web app when a request reaches the hotspot API
    // without a valid operator session, so HTML means "not logged in".
    return { code: null, msg: "", result: null };
  }
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    const setCookie =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
    return { status: res.status, text, setCookie };
  } finally {
    clearTimeout(timer);
  }
}

function cookieHeader(setCookie: string[]): string {
  return setCookie
    .map((c) => c.split(";")[0]?.trim())
    .filter((c): c is string => Boolean(c))
    .join("; ");
}

/** Logs in as the shop's hotspot operator and keeps the cookie + CSRF token. */
async function login(creds: HotspotCredentials): Promise<HotspotSession> {
  const base = normaliseBase(creds.base);
  let res: Awaited<ReturnType<typeof post>>;
  try {
    res = await post(`${base}/${creds.omadacId}/api/v2/hotspot/login`, {
      name: creds.operatorUser,
      password: creds.operatorPassword,
    });
  } catch (e) {
    throw new OmadaError(
      `Controller not reachable: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
      "unreachable",
    );
  }
  const env = envelope(res.text);
  const token = (env.result as Record<string, unknown> | null)?.["token"];
  if (env.code !== 0 || typeof token !== "string" || !token) {
    throw new OmadaError(
      env.msg
        ? `The Wi-Fi controller rejected this shop's hotspot operator sign-in: ${env.msg}`
        : "This shop's hotspot operator sign-in was rejected by the Wi-Fi controller.",
      "auth",
    );
  }
  const session: HotspotSession = {
    cookie: cookieHeader(res.setCookie),
    csrf: token,
    createdAt: Date.now(),
  };
  sessions.set(creds.ecosystemId, session);
  return session;
}

async function sessionFor(creds: HotspotCredentials, forceFresh: boolean): Promise<HotspotSession> {
  const cached = sessions.get(creds.ecosystemId);
  if (!forceFresh && cached && Date.now() - cached.createdAt < SESSION_TTL_MS) return cached;
  return login(creds);
}

/** Body exactly as the external-portal API documents it. Pure, so it is tested. */
export function buildExtPortalBody(input: HotspotAuthInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    clientMac: input.clientMac,
    // The documented external-portal authorisation type. There is no separate
    // "voucher" type here: the voucher is validated by WaveWallet's own Voucher
    // Shop (or by the customer's manual entry against Omada), and this call only
    // grants the resulting access window.
    authType: 4,
    time: Math.max(60_000, Math.round(input.timeMs)),
  };
  if (input.clientIp) body["clientIp"] = input.clientIp;
  if (input.gatewayMac) {
    body["gatewayMac"] = input.gatewayMac;
    if (input.vid !== null && input.vid !== undefined && input.vid !== "") body["vid"] = Number(input.vid);
    return body;
  }
  if (input.apMac) body["apMac"] = input.apMac;
  if (input.ssidName) body["ssidName"] = input.ssidName;
  if (input.radioId !== null && input.radioId !== undefined && input.radioId !== "") {
    body["radioId"] = Number(input.radioId);
  }
  return body;
}

/**
 * Puts ONE client online through the external-portal API. Retries once with a
 * fresh operator session when the controller rejects the cached one.
 */
export async function authorizeExternalPortalClient(
  creds: HotspotCredentials,
  input: HotspotAuthInput,
): Promise<{ ok: true; detail: string }> {
  const base = normaliseBase(creds.base);
  const url = `${base}/${creds.omadacId}/api/v2/hotspot/extPortal/auth`;
  const body = buildExtPortalBody(input);

  const attempt = async (fresh: boolean) => {
    const session = await sessionFor(creds, fresh);
    let res: Awaited<ReturnType<typeof post>>;
    try {
      res = await post(url, body, { "Csrf-Token": session.csrf, cookie: session.cookie });
    } catch (e) {
      throw new OmadaError(
        `Controller not reachable: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
        "unreachable",
      );
    }
    return { env: envelope(res.text), status: res.status };
  };

  let { env, status } = await attempt(false);
  // No JSON envelope, or an explicit "not logged in" code: the operator session
  // expired. Establish a new one and try exactly once more.
  if (env.code === null || env.code === -1200 || env.code === -30109) {
    sessions.delete(creds.ecosystemId);
    ({ env, status } = await attempt(true));
  }
  if (env.code === 0) return { ok: true, detail: "The controller accepted the authorization." };
  throw new OmadaError(
    `The Wi-Fi controller refused to put this device online: ${env.msg || `HTTP ${status}`}`,
    "api",
  );
}

/** Reads and decrypts one shop's hotspot operator credentials. */
export async function loadHotspotCredentials(
  supabaseAdmin: { from: (t: string) => any },
  ecosystemId: string,
): Promise<HotspotCredentials | null> {
  const { data: row } = await supabaseAdmin
    .from("omada_connections")
    .select("base_url, omadac_id, hotspot_operator_user, hotspot_operator_secret_ciphertext")
    .eq("ecosystem_id", ecosystemId)
    .maybeSingle();
  if (!row) return null;
  const user = (row.hotspot_operator_user as string | null) ?? "";
  const cipher = (row.hotspot_operator_secret_ciphertext as string | null) ?? "";
  if (!user || !cipher) return null;
  const { decryptSecret } = await import("./omada-crypto.server");
  return {
    ecosystemId,
    base: String(row.base_url ?? ""),
    omadacId: String(row.omadac_id ?? ""),
    operatorUser: user,
    operatorPassword: decryptSecret(cipher),
  };
}

/** Test-only: clears the in-process operator sessions. */
export function resetHotspotSessions() {
  sessions.clear();
}
