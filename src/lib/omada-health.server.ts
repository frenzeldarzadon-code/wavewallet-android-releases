/**
 * Tenant-scoped Omada health monitoring.
 *
 * What this does:
 *  - periodically checks ONE shop's own controller (reachability + API session)
 *  - classifies the outcome as healthy / unreachable / auth_failed / degraded
 *  - retries transient failures with bounded exponential backoff
 *  - caches the API access token (encrypted) and reuses it until shortly before
 *    it expires, so a healthy controller is not asked for a new token each time
 *  - records last success, last failure + reason, offline-since and recovery time
 *
 * What this deliberately does NOT do:
 *  - it never restarts anything on the operator's server. WaveWallet has no
 *    server-management connector (no SSH/systemd/agent), so a controller that is
 *    genuinely down must be restarted at server level by its owner.
 *  - it never disables or alters WaveWallet vouchers/data because Omada is down.
 *  - it never bypasses TLS verification and never returns secrets or tokens.
 */

export type OmadaHealthState = "unknown" | "healthy" | "unreachable" | "auth_failed" | "degraded";

export interface OmadaHealthOutcome {
  state: OmadaHealthState;
  reason: string | null;
  /** Site id resolved during this check, when available. */
  siteId: string | null;
  /** Token that may be cached for reuse (already validated in this check). */
  token: { value: string; expiresAt: Date } | null;
  /** True when the cached token was reused and no new token was requested. */
  reusedToken: boolean;
}

export interface OmadaHealthRow {
  ecosystem_id: string;
  base_url: string;
  omadac_id: string;
  client_id: string;
  client_secret_ciphertext: string;
  site_name: string | null;
  access_token_ciphertext: string | null;
  token_expires_at: string | null;
  health_state: string;
  consecutive_failures: number;
  offline_since: string | null;
}

/** Healthy controllers are polled at a calm cadence. */
export const HEALTHY_INTERVAL_MS = 10 * 60_000;
/** First retry after a failure, then doubled per consecutive failure. */
export const BACKOFF_BASE_MS = 60_000;
/** Backoff never grows past this, so recovery is still detected promptly. */
export const BACKOFF_MAX_MS = 30 * 60_000;
/** Beyond this much continuous downtime the admin sees a hard warning. */
export const OFFLINE_WARNING_MS = 30 * 60_000;

const TIMEOUT_MS = 12_000;
/** Refresh a cached token this long before it actually expires. */
const TOKEN_SKEW_MS = 60_000;

/** Exponential backoff with a ceiling; `failures` is the count *after* this check. */
export function backoffDelayMs(failures: number): number {
  if (failures <= 0) return HEALTHY_INTERVAL_MS;
  const delay = BACKOFF_BASE_MS * 2 ** (failures - 1);
  return Math.min(delay, BACKOFF_MAX_MS);
}

/** True when a shop has been down long enough to warn its admin. */
export function offlineTooLong(offlineSince: string | null, now = Date.now()): boolean {
  if (!offlineSince) return false;
  return now - new Date(offlineSince).getTime() >= OFFLINE_WARNING_MS;
}

function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length > 3) out = out.split(s).join("«redacted»");
  }
  return out.slice(0, 300);
}

function normaliseBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function httpFailure(status: number, fallback: string): string {
  if (status === 526) {
    return "TLS certificate validation failed between the HTTPS gateway and the Omada controller (HTTP 526). Configure an API hostname with a valid certificate and chain.";
  }
  return fallback;
}

async function jsonFetch(url: string, init: RequestInit, secrets: string[]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = text.slice(0, 2000);
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

function omadaResult(body: unknown): { code: number | null; msg: string; result: unknown } {
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

/**
 * Omada answers an expired/revoked access token with HTTP 200 and a negative
 * envelope error code, so the HTTP status alone must never be trusted.
 */
export function isOmadaTokenError(code: number | null): boolean {
  return code === -44112 || code === -44113 || code === -44106 || code === -1200;
}


export interface OmadaHealthInput {
  baseUrl: string;
  omadacId: string;
  clientId: string;
  clientSecret: string;
  siteName: string | null;
  /** Previously issued token, if still valid. */
  cachedToken: string | null;
  cachedTokenExpiresAt: string | null;
}

/**
 * One health check for one controller. Cheap when things are fine: reachability
 * plus a single authenticated read, reusing the cached token when it is fresh.
 */
export async function probeOmadaHealth(input: OmadaHealthInput): Promise<OmadaHealthOutcome> {
  const secrets = [input.clientSecret, input.clientId];
  const base = normaliseBase(input.baseUrl);

  const info = await jsonFetch(`${base}/api/info`, { method: "GET" }, secrets);
  if (!info.ok) {
    return {
      state: "unreachable",
      reason: info.error
        ? `Controller not reachable: ${info.error}`
        : httpFailure(info.status, `Controller answered HTTP ${info.status}`),
      siteId: null,
      token: null,
      reusedToken: false,
    };
  }

  // Reuse a cached token while it is comfortably valid.
  let token = input.cachedToken;
  let tokenExpiry = input.cachedTokenExpiresAt ? new Date(input.cachedTokenExpiresAt) : null;
  let reusedToken = Boolean(
    token && tokenExpiry && tokenExpiry.getTime() - TOKEN_SKEW_MS > Date.now(),
  );
  if (!reusedToken) {
    token = null;
    tokenExpiry = null;
  }

  const authenticate = async (): Promise<string | null> => {
    const res = await jsonFetch(
      `${base}/openapi/authorize/token?grant_type=client_credentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          omadacId: input.omadacId,
          client_id: input.clientId,
          client_secret: input.clientSecret,
        }),
      },
      secrets,
    );
    const parsed = omadaResult(res.body);
    if (!res.ok) {
      const reason = httpFailure(res.status, "");
      if (reason) throw new Error(reason);
    }
    const result = parsed.result as Record<string, unknown> | null;
    const value = result?.["accessToken"];
    if (typeof value !== "string" || !value) {
      return null;
    }
    const expiresIn = Number(result?.["expiresIn"] ?? 0);
    tokenExpiry = new Date(Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000));
    return value;
  };

  if (!token) {
    try {
      token = await authenticate();
    } catch (error) {
      return {
        state: "unreachable",
        reason: error instanceof Error ? error.message : "Controller API is unreachable.",
        siteId: null,
        token: null,
        reusedToken: false,
      };
    }
    if (!token) {
      return {
        state: "auth_failed",
        reason: "Authentication failed. The Omada Client ID/Secret or Omada ID may have changed.",
        siteId: null,
        token: null,
        reusedToken: false,
      };
    }
  }

  const readSites = (accessToken: string) =>
    jsonFetch(
      `${base}/openapi/v1/${input.omadacId}/sites?page=1&pageSize=100`,
      { method: "GET", headers: { Authorization: `AccessToken=${accessToken}` } },
      secrets,
    );

  let sites = await readSites(token);
  // A cached token can be revoked early; re-establish the session once, silently.
  if (!sites.ok && reusedToken) {
    let fresh: string | null = null;
    try {
      fresh = await authenticate();
    } catch (error) {
      return {
        state: "unreachable",
        reason: error instanceof Error ? error.message : "Controller API is unreachable.",
        siteId: null,
        token: null,
        reusedToken: false,
      };
    }
    if (!fresh) {
      return {
        state: "auth_failed",
        reason: "The stored API session expired and re-authentication failed.",
        siteId: null,
        token: null,
        reusedToken: false,
      };
    }
    token = fresh;
    reusedToken = false;
    sites = await readSites(token);
  }

  if (!sites.ok) {
    return {
      state: "unreachable",
      reason: sites.error
        ? `Controller API not answering: ${sites.error}`
        : `Controller API answered HTTP ${sites.status}`,
      siteId: null,
      token: token && tokenExpiry ? { value: token, expiresAt: tokenExpiry } : null,
      reusedToken,
    };
  }

  const parsed = omadaResult(sites.body);
  const rows = (parsed.result as Record<string, unknown> | null)?.["data"] as
    | Array<Record<string, unknown>>
    | undefined;
  const wanted = (input.siteName ?? "").trim();
  const match = wanted
    ? rows?.find((r) => String(r["name"] ?? "").toLowerCase() === wanted.toLowerCase())
    : rows?.[0];
  const siteId = match ? String(match["siteId"] ?? match["id"] ?? "") : "";

  const tokenOut = token && tokenExpiry ? { value: token, expiresAt: tokenExpiry } : null;
  if (!siteId) {
    return {
      state: "degraded",
      reason: wanted
        ? `Connected, but the site "${wanted}" is not visible to this API application.`
        : "Connected, but no site is visible to this API application.",
      siteId: null,
      token: tokenOut,
      reusedToken,
    };
  }

  return { state: "healthy", reason: null, siteId, token: tokenOut, reusedToken };
}

export interface HealthUpdate {
  health_state: OmadaHealthState;
  consecutive_failures: number;
  next_check_at: string;
  last_checked_at: string;
  last_success_at?: string;
  last_failure_at?: string;
  last_failure_reason: string | null;
  offline_since: string | null;
  last_recovered_at?: string;
  last_status: string;
  last_error: string | null;
  site_id?: string | null;
  access_token_ciphertext?: string | null;
  token_expires_at?: string | null;
}

/** Pure state machine: previous row + outcome -> the columns to persist. */
export function nextHealthUpdate(
  row: Pick<OmadaHealthRow, "health_state" | "consecutive_failures" | "offline_since">,
  outcome: OmadaHealthOutcome,
  now = new Date(),
): HealthUpdate {
  const iso = now.toISOString();
  const success = outcome.state === "healthy" || outcome.state === "degraded";
  const failures = success ? 0 : row.consecutive_failures + 1;
  const delay = success ? HEALTHY_INTERVAL_MS : backoffDelayMs(failures);

  const base: HealthUpdate = {
    health_state: outcome.state,
    consecutive_failures: failures,
    next_check_at: new Date(now.getTime() + delay).toISOString(),
    last_checked_at: iso,
    last_failure_reason: success ? null : outcome.reason,
    offline_since: success ? null : (row.offline_since ?? iso),
    last_status: outcome.state === "healthy" ? "connected" : success ? "degraded" : "failed",
    last_error: outcome.reason,
  };

  if (success) {
    base.last_success_at = iso;
    // Recovery = we were previously in a failing state and are now back.
    if (row.health_state === "unreachable" || row.health_state === "auth_failed") {
      base.last_recovered_at = iso;
    }
    if (outcome.siteId) base.site_id = outcome.siteId;
  } else {
    base.last_failure_at = iso;
  }

  return base;
}

type AdminClient = {
  from: (table: string) => {
    select: (cols: string) => any;
    update: (values: Record<string, unknown>) => any;
  };
};

/**
 * Run a check for one shop and persist the result. Tenant-scoped by
 * construction: it only ever touches the row of the ecosystem passed in.
 */
export async function runOmadaHealthCheck(
  supabaseAdmin: AdminClient,
  row: OmadaHealthRow,
): Promise<HealthUpdate> {
  const { decryptSecret, encryptSecret } = await import("./omada-crypto.server");

  let cachedToken: string | null = null;
  if (row.access_token_ciphertext) {
    try {
      cachedToken = decryptSecret(row.access_token_ciphertext);
    } catch {
      cachedToken = null;
    }
  }

  const outcome = await probeOmadaHealth({
    baseUrl: row.base_url,
    omadacId: row.omadac_id,
    clientId: row.client_id,
    clientSecret: decryptSecret(row.client_secret_ciphertext),
    siteName: row.site_name,
    cachedToken,
    cachedTokenExpiresAt: row.token_expires_at,
  });

  const update = nextHealthUpdate(row, outcome);

  if (outcome.token) {
    // Store the session so a healthy controller is not re-authenticated on every check.
    update.access_token_ciphertext = outcome.reusedToken
      ? row.access_token_ciphertext
      : encryptSecret(outcome.token.value);
    update.token_expires_at = outcome.token.expiresAt.toISOString();
  } else if (outcome.state === "auth_failed") {
    update.access_token_ciphertext = null;
    update.token_expires_at = null;
  }

  await supabaseAdmin
    .from("omada_connections")
    .update(update as unknown as Record<string, unknown>)
    .eq("ecosystem_id", row.ecosystem_id);

  return update;
}

const SWEEP_COLUMNS =
  "ecosystem_id, base_url, omadac_id, client_id, client_secret_ciphertext, site_name, access_token_ciphertext, token_expires_at, health_state, consecutive_failures, offline_since";

/**
 * Check every tenant whose next check is due. Each shop is isolated: a failure
 * or a slow controller in one shop never stops the others from being checked.
 */
export async function sweepDueOmadaConnections(
  supabaseAdmin: AdminClient,
  limit = 25,
): Promise<{ checked: number; results: Array<{ ecosystemId: string; state: OmadaHealthState }> }> {
  const { data, error } = await supabaseAdmin
    .from("omada_connections")
    .select(SWEEP_COLUMNS)
    .eq("monitoring_enabled", true)
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as OmadaHealthRow[];
  const results = await Promise.all(
    rows.map(async (row) => {
      try {
        const update = await runOmadaHealthCheck(supabaseAdmin, row);
        return { ecosystemId: row.ecosystem_id, state: update.health_state };
      } catch {
        return { ecosystemId: row.ecosystem_id, state: "unknown" as OmadaHealthState };
      }
    }),
  );
  return { checked: rows.length, results };
}
