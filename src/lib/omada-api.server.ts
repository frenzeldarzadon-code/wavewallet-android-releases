/**
 * Authenticated, tenant-scoped Omada Open API session.
 *
 * Every call is made with ONE shop's own stored controller credentials. The
 * access token is cached (encrypted) on that shop's row and reused until it is
 * about to expire, and it is re-established automatically when the controller
 * rejects it. TLS verification is never bypassed and no secret or token is ever
 * returned to the browser.
 */

const TIMEOUT_MS = 15_000;
const TOKEN_SKEW_MS = 60_000;

export interface OmadaSession {
  ecosystemId: string;
  base: string;
  omadacId: string;
  siteId: string;
  token: string;
}

export class OmadaError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "auth" | "api" | "not_configured" = "api",
  ) {
    super(message);
    this.name = "OmadaError";
  }
}

function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length > 3) out = out.split(s).join("«redacted»");
  return out.slice(0, 400);
}

function normaliseBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function rawFetch(url: string, init: RequestInit, secrets: string[]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
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
      error: scrub(e instanceof Error ? e.message : String(e), secrets),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Omada answers as { errorCode, msg, result }. */
export function omadaEnvelope(body: unknown): {
  code: number | null;
  msg: string;
  result: unknown;
} {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    return {
      code: typeof b["errorCode"] === "number" ? b["errorCode"] : null,
      msg: typeof b["msg"] === "string" ? b["msg"] : "",
      result: b["result"] ?? null,
    };
  }
  return { code: null, msg: "", result: null };
}

type AdminClient = { from: (table: string) => any };

const COLUMNS =
  "ecosystem_id, base_url, omadac_id, client_id, client_secret_ciphertext, site_name, site_id, access_token_ciphertext, token_expires_at";

async function authenticate(
  base: string,
  omadacId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ token: string; expiresAt: Date }> {
  const secrets = [clientSecret, clientId];
  const res = await rawFetch(
    `${base}/openapi/authorize/token?grant_type=client_credentials`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        omadacId,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
    secrets,
  );
  if (res.error) throw new OmadaError(`Controller not reachable: ${res.error}`, "unreachable");
  const parsed = omadaEnvelope(res.body);
  const result = parsed.result as Record<string, unknown> | null;
  const token = result?.["accessToken"];
  if (typeof token !== "string" || !token) {
    throw new OmadaError(
      `Omada authentication failed: ${scrub(parsed.msg || `HTTP ${res.status}`, secrets)}`,
      "auth",
    );
  }
  const expiresIn = Number(result?.["expiresIn"] ?? 0);
  return {
    token,
    expiresAt: new Date(
      Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000),
    ),
  };
}

/**
 * Resolves a usable API session for one shop: valid token + resolved site id.
 * Throws a typed OmadaError the UI can present without leaking anything.
 */
export async function openOmadaSession(
  supabaseAdmin: AdminClient,
  ecosystemId: string,
): Promise<OmadaSession> {
  const { decryptSecret, encryptSecret } = await import("./omada-crypto.server");
  const { data: row, error } = await supabaseAdmin
    .from("omada_connections")
    .select(COLUMNS)
    .eq("ecosystem_id", ecosystemId)
    .maybeSingle();
  if (error) throw new OmadaError(error.message, "api");
  if (!row) throw new OmadaError("This shop has no Omada controller connected.", "not_configured");

  const clientSecret = decryptSecret(row.client_secret_ciphertext as string);
  const base = normaliseBase(row.base_url as string);
  const omadacId = row.omadac_id as string;

  let token: string | null = null;
  const expiry = row.token_expires_at ? new Date(row.token_expires_at as string) : null;
  if (row.access_token_ciphertext && expiry && expiry.getTime() - TOKEN_SKEW_MS > Date.now()) {
    try {
      token = decryptSecret(row.access_token_ciphertext as string);
    } catch {
      token = null;
    }
  }
  let fresh = false;
  if (!token) {
    const issued = await authenticate(base, omadacId, row.client_id as string, clientSecret);
    token = issued.token;
    fresh = true;
    await supabaseAdmin
      .from("omada_connections")
      .update({
        access_token_ciphertext: encryptSecret(issued.token),
        token_expires_at: issued.expiresAt.toISOString(),
      })
      .eq("ecosystem_id", ecosystemId);
  }

  const resolveSite = async (accessToken: string): Promise<string | null> => {
    const res = await rawFetch(
      `${base}/openapi/v1/${omadacId}/sites?page=1&pageSize=100`,
      { method: "GET", headers: { Authorization: `AccessToken=${accessToken}` } },
      [clientSecret, accessToken],
    );
    if (res.error) throw new OmadaError(`Controller not reachable: ${res.error}`, "unreachable");
    if (!res.ok) return null;
    const rows = (omadaEnvelope(res.body).result as Record<string, unknown> | null)?.["data"] as
      | Array<Record<string, unknown>>
      | undefined;
    const wanted = String(row.site_name ?? "").trim();
    const match = wanted
      ? rows?.find((r) => String(r["name"] ?? "").toLowerCase() === wanted.toLowerCase())
      : rows?.[0];
    return match ? String(match["siteId"] ?? match["id"] ?? "") || null : null;
  };

  let siteId = await resolveSite(token);
  if (!siteId && !fresh) {
    // The cached session may have been revoked — re-establish it once, silently.
    const issued = await authenticate(base, omadacId, row.client_id as string, clientSecret);
    token = issued.token;
    await supabaseAdmin
      .from("omada_connections")
      .update({
        access_token_ciphertext: encryptSecret(issued.token),
        token_expires_at: issued.expiresAt.toISOString(),
      })
      .eq("ecosystem_id", ecosystemId);
    siteId = await resolveSite(token);
  }
  if (!siteId) {
    throw new OmadaError(
      "Connected, but no site is visible to this Omada API application.",
      "auth",
    );
  }

  if (siteId !== row.site_id) {
    await supabaseAdmin
      .from("omada_connections")
      .update({ site_id: siteId })
      .eq("ecosystem_id", ecosystemId);
  }

  return { ecosystemId, base, omadacId, siteId, token };
}

/** One authenticated Open API call inside a tenant's own site scope. */
export async function omadaSiteCall<T = unknown>(
  session: OmadaSession,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${session.base}/openapi/v1/${session.omadacId}/sites/${session.siteId}${path}`;
  const res = await rawFetch(
    url,
    {
      ...init,
      headers: {
        Authorization: `AccessToken=${session.token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    },
    [session.token],
  );
  if (res.error) throw new OmadaError(`Controller not reachable: ${res.error}`, "unreachable");
  const parsed = omadaEnvelope(res.body);
  if (!res.ok || (parsed.code !== null && parsed.code !== 0)) {
    const detail = parsed.msg || `HTTP ${res.status}`;
    throw new OmadaError(
      `Omada refused the request: ${detail}`,
      res.status === 401 || res.status === 403 ? "auth" : "api",
    );
  }
  return parsed.result as T;
}
