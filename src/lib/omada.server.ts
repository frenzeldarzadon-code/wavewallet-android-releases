/**
 * Read-only Omada Open API probe (proof of concept).
 *
 * This module is server-only and completely isolated from WaveWallet's
 * voucher products, Code Inventory, wallets and every other production path.
 * It never creates, modifies or deletes anything — in Omada or in WaveWallet.
 *
 * Credentials come exclusively from server secrets (Project Settings → Secrets)
 * and are never returned, logged or echoed anywhere.
 */

export interface ProbeStep {
  step: string;
  ok: boolean;
  detail: string;
  /** Small, non-sensitive JSON snapshot of the response shape, when useful. */
  sample?: string;
}

export interface ProbeReport {
  configured: boolean;
  missing: string[];
  steps: ProbeStep[];
}

const TIMEOUT_MS = 12_000;

/** Never let a secret leak into an error message shown to an operator. */
function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length > 3) out = out.split(s).join("«redacted»");
  }
  return out.slice(0, 600);
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
      code: typeof b['errorCode'] === "number" ? (b['errorCode'] as number) : null,
      msg: typeof b['msg'] === "string" ? (b['msg'] as string) : "",
      result: b['result'] ?? null,
    };
  }
  return { code: null, msg: "", result: null };
}

/** JSON-encodes a small shape snapshot so the payload stays serializable. */
function snapshot(value: unknown): string {
  return JSON.stringify(value ?? null).slice(0, 1200);
}

/** Keys only — never values — so we can learn the response shape safely. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === "object") return Object.keys(value as object).sort();
  return typeof value;
}

export async function runOmadaProbe(): Promise<ProbeReport> {
  const baseRaw = process.env['OMADA_BASE_URL'];
  const clientId = process.env['OMADA_CLIENT_ID'];
  const clientSecret = process.env['OMADA_CLIENT_SECRET'];
  const siteName = process.env['OMADA_SITE_NAME'] ?? "Sagada Wave V2";

  const missing = [
    ...(baseRaw ? [] : ["OMADA_BASE_URL"]),
    ...(clientId ? [] : ["OMADA_CLIENT_ID"]),
    ...(clientSecret ? [] : ["OMADA_CLIENT_SECRET"]),
  ];
  if (missing.length) return { configured: false, missing, steps: [] };

  const secrets = [clientSecret!, clientId!];
  const base = baseRaw!.replace(/\/+$/, "");
  const steps: ProbeStep[] = [];

  // 1) Connectivity + TLS. Also yields the controller version and omadacId.
  const info = await jsonFetch(`${base}/api/info`, { method: "GET" }, secrets);
  if (!info.ok) {
    steps.push({
      step: "Controller reachable (TLS)",
      ok: false,
      detail: info.error
        ? `Request failed: ${info.error}. A TLS error here usually means the controller uses a self-signed certificate, which the server runtime cannot accept.`
        : `HTTP ${info.status}`,
    });
    return { configured: true, missing: [], steps };
  }
  const infoRes = omadaResult(info.body).result as Record<string, unknown> | null;
  const omadacId =
    (process.env['OMADA_OMADAC_ID'] as string | undefined) ??
    (typeof infoRes?.['omadacId'] === "string" ? (infoRes['omadacId'] as string) : undefined);
  steps.push({
    step: "Controller reachable (TLS)",
    ok: true,
    detail: `HTTP ${info.status}; controller version ${String(infoRes?.['controllerVer'] ?? "unknown")}`,
    sample: snapshot({ omadacIdPresent: Boolean(omadacId), keys: shapeOf(infoRes) }),
  });

  if (!omadacId) {
    steps.push({
      step: "Controller id (omadacId)",
      ok: false,
      detail: "Could not read omadacId from /api/info. Set OMADA_OMADAC_ID as a secret.",
    });
    return { configured: true, missing: [], steps };
  }

  // 2) Client-credentials authentication. The token is never returned.
  const token = await jsonFetch(
    `${base}/openapi/authorize/token?grant_type=client_credentials`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ omadacId, client_id: clientId, client_secret: clientSecret }),
    },
    secrets,
  );
  const tokenRes = omadaResult(token.body);
  const accessToken =
    tokenRes.result && typeof tokenRes.result === "object"
      ? ((tokenRes.result as Record<string, unknown>)['accessToken'] as string | undefined)
      : undefined;
  steps.push({
    step: "API authentication (client credentials)",
    ok: Boolean(accessToken),
    detail: accessToken
      ? "Access token issued."
      : `errorCode ${String(tokenRes.code)} ${scrub(tokenRes.msg || `HTTP ${token.status}`, secrets)}`,
  });
  if (!accessToken) return { configured: true, missing: [], steps };

  const authHeaders = { Authorization: `AccessToken=${accessToken}` };

  // 3) Site visibility — confirm the API app really sees Sagada Wave V2.
  const sites = await jsonFetch(
    `${base}/openapi/v1/${omadacId}/sites?page=1&pageSize=100`,
    { method: "GET", headers: authHeaders },
    secrets,
  );
  const sitesRes = omadaResult(sites.body);
  const rows =
    sitesRes.result && typeof sitesRes.result === "object"
      ? ((sitesRes.result as Record<string, unknown>)['data'] as
          | Array<Record<string, unknown>>
          | undefined)
      : undefined;
  const match = rows?.find(
    (r) => String(r['name'] ?? "").toLowerCase() === siteName.toLowerCase(),
  );
  const siteId =
    (process.env['OMADA_SITE_ID'] as string | undefined) ??
    (match ? String(match['siteId'] ?? match['id'] ?? "") : "");
  steps.push({
    step: `Site access ("${siteName}")`,
    ok: Boolean(siteId),
    detail: siteId
      ? `Visible. ${rows?.length ?? 0} site(s) returned to this API application.`
      : `Not found. errorCode ${String(sitesRes.code)} ${scrub(sitesRes.msg || `HTTP ${sites.status}`, secrets)}`,
    sample: snapshot({ siteNames: rows?.map((r) => String(r['name'] ?? "")).slice(0, 10) }),
  });
  if (!siteId) return { configured: true, missing: [], steps };

  // 4) Read-only voucher group listing. Nothing is created or changed.
  const groups = await jsonFetch(
    `${base}/openapi/v1/${omadacId}/sites/${siteId}/hotspot/voucher-groups?page=1&pageSize=10`,
    { method: "GET", headers: authHeaders },
    secrets,
  );
  const groupsRes = omadaResult(groups.body);
  const groupRows =
    groupsRes.result && typeof groupsRes.result === "object"
      ? ((groupsRes.result as Record<string, unknown>)['data'] as
          | Array<Record<string, unknown>>
          | undefined)
      : undefined;
  steps.push({
    step: "Read voucher groups",
    ok: Boolean(groupRows),
    detail: groupRows
      ? `${groupRows.length} group(s) read.`
      : `errorCode ${String(groupsRes.code)} ${scrub(groupsRes.msg || `HTTP ${groups.status}`, secrets)} — the voucher path may differ on this build; the controller's own API Docs page is authoritative.`,
    sample: snapshot({ groupShape: shapeOf(groupRows) }),
  });

  // 5) Read one voucher from the first group, to learn the status fields.
  const firstGroupId = groupRows?.[0]
    ? String(groupRows[0]['id'] ?? groupRows[0]['groupId'] ?? "")
    : "";
  if (firstGroupId) {
    const vouchers = await jsonFetch(
      `${base}/openapi/v1/${omadacId}/sites/${siteId}/hotspot/voucher-groups/${firstGroupId}/vouchers?page=1&pageSize=1`,
      { method: "GET", headers: authHeaders },
      secrets,
    );
    const vRes = omadaResult(vouchers.body);
    const vRows =
      vRes.result && typeof vRes.result === "object"
        ? ((vRes.result as Record<string, unknown>)['data'] as
            | Array<Record<string, unknown>>
            | undefined)
        : undefined;
    steps.push({
      step: "Read one voucher (status fields)",
      ok: Boolean(vRows),
      detail: vRows
        ? `${vRows.length} voucher record read.`
        : `errorCode ${String(vRes.code)} ${scrub(vRes.msg || `HTTP ${vouchers.status}`, secrets)}`,
      // Field names only — no voucher codes are returned to the caller.
      sample: snapshot({ voucherFields: shapeOf(vRows) }),
    });
  }

  return { configured: true, missing: [], steps };
}
