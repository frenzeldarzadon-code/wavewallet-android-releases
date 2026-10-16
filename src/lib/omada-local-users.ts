/**
 * Omada hotspot local users — pure, browser-safe rules.
 *
 * Verified against the live Omada Controller 6.2.14.11 (Open API v1, no
 * published OpenAPI document), read-only and with empty request bodies only:
 *   GET  /hotspot/localusers?page=&pageSize=   → list (result.data, totalRows)
 *   POST /hotspot/localusers                   → create (full object required)
 *   POST /hotspot/localusers/{id}              → update (full object required)
 *   PUT / PATCH                                 → 405 (not supported)
 * Units observed on a live record: `trafficLimit` is MB (MiB), `trafficUsed`
 * is bytes, `expirationTime` is epoch milliseconds, rate limits are Kbps.
 *
 * SAFETY BOUNDARY: ONE WAVE only lists, creates, raises a data cap, or moves an
 * expiry LATER. It never deletes, disables, unauthorizes, disconnects, or
 * resets usage. Omada stays the authority for every login and access decision.
 */

export const LOCAL_USERS_PATH = "/hotspot/localusers";
export const MIB = 1024 * 1024;
export const DAY_MS = 86_400_000;
export const MAX_ADD_GB = 10_000;
export const MAX_EXTEND_DAYS = 3_650;

/** Fields the controller computes; never echoed back on update. */
const READ_ONLY_KEYS = new Set(["id", "used", "overtime", "trafficLeft", "trafficUsed", "portalNames"]);

/** Keys a ONE WAVE request may never carry (usage resets, access control). */
export const FORBIDDEN_BODY_KEYS = [
  "trafficUsed",
  "used",
  "resetTraffic",
  "reset",
  "resetUsage",
  "unauthorize",
  "disconnect",
  "block",
  "kick",
];

export type LocalUserRow = Record<string, unknown>;

export interface LocalUserView {
  id: string;
  userName: string;
  enabled: boolean;
  expiresAt: number | null;
  expired: boolean;
  limited: boolean;
  limitBytes: number | null;
  usedBytes: number | null;
  remainingBytes: number | null;
  maxUsers: number | null;
  downKbps: number | null;
  upKbps: number | null;
  portalCount: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Browser view of one controller row. The password is never included. */
export function toLocalUserView(row: LocalUserRow, now = Date.now()): LocalUserView {
  const limited = row["trafficLimitEnable"] === true;
  const limitMb = num(row["trafficLimit"]);
  const usedBytes = num(row["trafficUsed"]);
  const limitBytes = limited && limitMb !== null ? limitMb * MIB : null;
  const rate = (row["rateLimit"] as Record<string, unknown> | undefined)?.["customRateLimit"] as
    | Record<string, unknown>
    | undefined;
  const expiresAt = num(row["expirationTime"]);
  return {
    id: String(row["id"] ?? ""),
    userName: String(row["userName"] ?? ""),
    enabled: row["enable"] === true,
    expiresAt,
    expired: expiresAt !== null && expiresAt <= now,
    limited,
    limitBytes,
    usedBytes: limited ? (usedBytes ?? 0) : usedBytes,
    remainingBytes: limitBytes === null ? null : Math.max(0, limitBytes - (usedBytes ?? 0)),
    maxUsers: num(row["maxUsers"]),
    downKbps: rate?.["downLimitEnable"] === true ? num(rate["downLimit"]) : null,
    upKbps: rate?.["upLimitEnable"] === true ? num(rate["upLimit"]) : null,
    portalCount: Array.isArray(row["portals"]) ? (row["portals"] as unknown[]).length : 0,
  };
}

/** The current record minus controller-computed fields — nothing else is dropped. */
function preserved(current: LocalUserRow): LocalUserRow {
  const out: LocalUserRow = {};
  for (const [k, v] of Object.entries(current)) if (!READ_ONLY_KEYS.has(k)) out[k] = v;
  return out;
}

/**
 * Raise the data cap by `addGb` on top of the CURRENT cap. Unused data is kept
 * because the used counter is never sent and the cap only ever grows.
 * Unlimited users are refused: giving them a cap would restrict their access.
 */
export function buildAddQuotaBody(current: LocalUserRow, addGb: number): LocalUserRow {
  if (!Number.isFinite(addGb) || addGb <= 0) throw new Error("Enter how many GB to add (more than 0).");
  if (addGb > MAX_ADD_GB) throw new Error(`You can add at most ${MAX_ADD_GB} GB at a time.`);
  if (current["trafficLimitEnable"] !== true) {
    throw new Error("This user has unlimited data on Omada, so there is nothing to add to.");
  }
  const limitMb = num(current["trafficLimit"]);
  if (limitMb === null || limitMb < 0) throw new Error("Omada did not report this user's data cap.");
  const next = limitMb + Math.round(addGb * 1024);
  if (next <= limitMb) throw new Error("The new data cap must be larger than the current one.");
  return { ...preserved(current), trafficLimit: next };
}

export type ExpiryChange = { mode: "extend"; days: number } | { mode: "set"; at: number };

/** New expiry: never earlier than the current one, never in the past. */
export function nextExpiry(currentMs: number | null, change: ExpiryChange, now = Date.now()): number {
  const current = currentMs ?? now;
  if (change.mode === "extend") {
    if (!Number.isFinite(change.days) || change.days <= 0 || change.days > MAX_EXTEND_DAYS) {
      throw new Error(`Enter between 1 and ${MAX_EXTEND_DAYS} days.`);
    }
    return Math.max(current, now) + Math.round(change.days * DAY_MS);
  }
  if (!Number.isFinite(change.at) || change.at <= now) throw new Error("Pick a date in the future.");
  if (change.at < current) {
    throw new Error("The new date can't be earlier than the current expiry — ONE WAVE only extends.");
  }
  return change.at;
}

export function buildExpiryBody(current: LocalUserRow, change: ExpiryChange, now = Date.now()): LocalUserRow {
  return { ...preserved(current), expirationTime: nextExpiry(num(current["expirationTime"]), change, now) };
}

export interface NewLocalUser {
  userName: string;
  password: string;
  portals: string[];
  expiresAt: number;
  quotaGb?: number | null;
  maxUsers?: number | null;
  downKbps?: number | null;
  upKbps?: number | null;
}

/** Create body using only the fields the controller itself demanded. */
export function buildCreateBody(input: NewLocalUser, now = Date.now()): LocalUserRow {
  const userName = input.userName.trim();
  if (!/^[A-Za-z0-9._@-]{1,32}$/.test(userName)) {
    throw new Error("Username: 1–32 letters, numbers, dot, dash, underscore or @.");
  }
  if (input.password.length < 1 || input.password.length > 32) throw new Error("Password: 1–32 characters.");
  if (!input.portals.length) throw new Error("Pick at least one portal.");
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now) throw new Error("Expiry must be in the future.");
  const quota = input.quotaGb ?? null;
  if (quota !== null && (!Number.isFinite(quota) || quota <= 0 || quota > MAX_ADD_GB)) {
    throw new Error(`Data cap: between 1 and ${MAX_ADD_GB} GB, or leave empty for unlimited.`);
  }
  const maxUsers = input.maxUsers ?? 1;
  if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 999) throw new Error("Devices: 1–999.");
  const down = input.downKbps ?? null;
  const up = input.upKbps ?? null;
  const body: LocalUserRow = {
    enable: true,
    userName,
    password: input.password,
    bindingType: 0,
    portals: input.portals,
    expirationTime: input.expiresAt,
    maxUsers,
    rateLimit: {
      mode: 0,
      customRateLimit: {
        downLimitEnable: down !== null && down > 0,
        downLimit: down !== null && down > 0 ? Math.round(down) : 0,
        upLimitEnable: up !== null && up > 0,
        upLimit: up !== null && up > 0 ? Math.round(up) : 0,
      },
    },
    trafficLimitEnable: quota !== null,
  };
  if (quota !== null) {
    body["trafficLimit"] = Math.round(quota * 1024);
    body["trafficLimitFrequency"] = 0;
  }
  return body;
}

/**
 * The single gate every outbound local-user request passes. Only GET (list),
 * POST to the collection (create) and POST to one record (update) are allowed;
 * delete, disconnect, unauthorize, block or reset requests can't be built.
 */
export function assertSafeLocalUserRequest(
  method: string,
  path: string,
  body?: LocalUserRow,
  current?: LocalUserRow,
): void {
  const m = method.toUpperCase();
  const clean = path.split("?")[0] ?? "";
  const isCollection = clean === LOCAL_USERS_PATH;
  const isOne = /^\/hotspot\/localusers\/[A-Za-z0-9]+$/.test(clean);
  if (!isCollection && !isOne) throw new Error("Blocked: not a local-user endpoint.");
  if (m === "GET" && isCollection) return;
  if (m !== "POST") throw new Error(`Blocked: ${m} is not allowed on Omada local users.`);
  if (!body) throw new Error("Blocked: missing request body.");
  for (const key of FORBIDDEN_BODY_KEYS) {
    if (key in body) throw new Error(`Blocked: "${key}" can't be sent to Omada.`);
  }
  if (isOne) {
    if (!current) throw new Error("Blocked: updates need the freshly read record.");
    // Access status and every non-target field must match what Omada holds now.
    if (body["enable"] !== current["enable"]) throw new Error("Blocked: ONE WAVE never enables or disables users.");
    for (const [k, v] of Object.entries(current)) {
      if (READ_ONLY_KEYS.has(k) || k === "trafficLimit" || k === "expirationTime") continue;
      if (JSON.stringify(body[k]) !== JSON.stringify(v)) throw new Error(`Blocked: "${k}" would change.`);
    }
    const oldLimit = num(current["trafficLimit"]);
    const newLimit = num(body["trafficLimit"]);
    if (oldLimit !== null && (newLimit === null || newLimit < oldLimit)) {
      throw new Error("Blocked: the data cap can only go up.");
    }
    if (current["trafficLimitEnable"] !== true && body["trafficLimit"] !== current["trafficLimit"]) {
      throw new Error("Blocked: unlimited users can't be given a cap.");
    }
    const oldExp = num(current["expirationTime"]);
    const newExp = num(body["expirationTime"]);
    if (oldExp !== null && (newExp === null || newExp < oldExp)) {
      throw new Error("Blocked: expiry can only move later.");
    }
  } else if (body["enable"] !== true) {
    throw new Error("Blocked: new users are created enabled.");
  }
}

type Rpc = (fn: string, args: unknown) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Platform owner, or a server-confirmed admin of THIS shop. Everyone else is refused. */
export async function authorizeShopAdmin(rpc: Rpc, userId: string, ecosystemId: string): Promise<void> {
  if (!ecosystemId) throw new Error("A shop is required.");
  const owner = await rpc("is_super_admin", { _user_id: userId });
  if (owner.error) throw new Error(owner.error.message);
  if (owner.data === true) return;
  const admin = await rpc("is_ecosystem_admin", { _user_id: userId, _ecosystem_id: ecosystemId });
  if (admin.error) throw new Error(admin.error.message);
  if (admin.data !== true) throw new Error("Only this shop's admin can manage Omada local users.");
}
