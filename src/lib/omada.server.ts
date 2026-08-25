/**
 * Read-only Omada Open API client, scoped to ONE tenant's own controller.
 *
 * Credentials are always passed in by the caller after it has authorised the
 * signed-in admin for that shop. Nothing here reads global/shared secrets and
 * nothing here writes to the Omada controller or to WaveWallet tables.
 *
 * TLS verification is never bypassed: the controller must present a
 * certificate valid for its own hostname.
 */

export interface OmadaConfig {
  baseUrl: string;
  omadacId: string;
  clientId: string;
  clientSecret: string;
  siteName?: string | null;
}

export interface ProbeStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface ProbeReport {
  ok: boolean;
  /** Resolved site id when the configured site name was found. */
  siteId: string | null;
  steps: ProbeStep[];
  error: string | null;
}

const TIMEOUT_MS = 12_000;

/** Never let a secret leak into an error message shown to an operator. */
function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length > 3) out = out.split(s).join("«redacted»");
  }
  return out.slice(0, 400);
}

async function jsonFetch(
  url: string,
  init: RequestInit,
  secrets: string[],
): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = text.slice(0, 4000);
    try {
      body = JSON.parse(text);
    } catch {
      /* keep truncated text */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: scrub(e instanceof Error ? e.message : String(e), secrets),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Omada wraps every Open API answer as { errorCode, msg, result }. */
function omadaResult(body: unknown): { code: number | null; msg: string; result: unknown } {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    return {
      code: typeof b["errorCode"] === "number" ? (b["errorCode"] as number) : null,
      msg: typeof b["msg"] === "string" ? (b["msg"] as string) : "",
      result: b["result"] ?? null,
    };
  }
  return { code: null, msg: "", result: null };
}

function normaliseBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * Connection check for one shop's controller: reachability, client-credentials
 * authentication and (optionally) visibility of the configured site.
 */
export async function checkOmadaConnection(config: OmadaConfig): Promise<ProbeReport> {
  const secrets = [config.clientSecret, config.clientId];
  const base = normaliseBase(config.baseUrl);
  const steps: ProbeStep[] = [];

  const info = await jsonFetch(`${base}/api/info`, { method: "GET" }, secrets);
  if (!info.ok) {
    const detail = info.error
      ? `Could not reach the controller: ${info.error}. A certificate error here means the controller's HTTPS certificate is not valid for that address.`
      : `HTTP ${info.status}`;
    steps.push({ step: "Controller reachable (HTTPS)", ok: false, detail });
    return { ok: false, siteId: null, steps, error: detail };
  }
  const infoRes = omadaResult(info.body).result as Record<string, unknown> | null;
  steps.push({
    step: "Controller reachable (HTTPS)",
    ok: true,
    detail: `Controller version ${String(infoRes?.["controllerVer"] ?? "unknown")}`,
  });

  const token = await jsonFetch(
    `${base}/openapi/authorize/token?grant_type=client_credentials`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        omadacId: config.omadacId,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    },
    secrets,
  );
  const tokenRes = omadaResult(token.body);
  const accessToken =
    tokenRes.result && typeof tokenRes.result === "object"
      ? ((tokenRes.result as Record<string, unknown>)["accessToken"] as string | undefined)
      : undefined;
  if (!accessToken) {
    const detail = `Authentication failed: ${scrub(tokenRes.msg || `HTTP ${token.status}`, secrets)}`;
    steps.push({ step: "API authentication (client credentials)", ok: false, detail });
    return { ok: false, siteId: null, steps, error: detail };
  }
  steps.push({
    step: "API authentication (client credentials)",
    ok: true,
    detail: "Access token issued.",
  });

  const sites = await jsonFetch(
    `${base}/openapi/v1/${config.omadacId}/sites?page=1&pageSize=100`,
    { method: "GET", headers: { Authorization: `AccessToken=${accessToken}` } },
    secrets,
  );
  const sitesRes = omadaResult(sites.body);
  const rows =
    sitesRes.result && typeof sitesRes.result === "object"
      ? ((sitesRes.result as Record<string, unknown>)["data"] as
          | Array<Record<string, unknown>>
          | undefined)
      : undefined;

  const wanted = (config.siteName ?? "").trim();
  const match = wanted
    ? rows?.find((r) => String(r["name"] ?? "").toLowerCase() === wanted.toLowerCase())
    : rows?.[0];
  const siteId = match ? String(match["siteId"] ?? match["id"] ?? "") : "";

  steps.push({
    step: wanted ? `Site access ("${wanted}")` : "Site access",
    ok: Boolean(siteId),
    detail: siteId
      ? `Visible. ${rows?.length ?? 0} site(s) available to this API application.`
      : `Site not visible to this API application. ${scrub(sitesRes.msg || `HTTP ${sites.status}`, secrets)}`,
  });

  return {
    ok: Boolean(siteId),
    siteId: siteId || null,
    steps,
    error: siteId ? null : "The configured site is not visible to this API application.",
  };
}
