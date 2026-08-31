/**
 * Live Voucher Monitoring — pure translation layer.
 *
 * The connected Omada controller is the single source of truth. Nothing here
 * invents, caches or extrapolates network state: every value shown on a
 * monitoring card is derived from the exact fields the controller returned for
 * that voucher, and anything the controller did not report reads as unknown
 * rather than as a zero.
 *
 * Verified voucher row shape on Controller 6.2.14.11:
 *   { code, status 0|1|2, duration (minutes), durationType 0|1,
 *     timeLeftSec, timeUsedSec?, trafficLimit (MB, 0/absent = unlimited),
 *     trafficLimitEnable?, trafficUsed (bytes), trafficUnused (bytes),
 *     startTime, endTime, expirationTime? }
 */

export type MonitorState = "unused" | "in_use" | "expired";

export interface MonitorCard {
  code: string;
  /** Only the last four characters are ever shown in the card heading. */
  masked: string;
  state: MonitorState;
  /** Exactly UNUSED / IN-USE / EXPIRED. */
  statusLabel: "UNUSED" | "IN-USE" | "EXPIRED";
  /** UNUSED: the voucher's configured allowance. */
  time: string | null;
  /** True when Omada's duration type consumes time by usage (pausable). */
  pausable: boolean;
  consumableData: string | null;
  /** IN-USE / EXPIRED: what the controller currently reports. */
  runningTime: string | null;
  remainingTime: string | null;
  dataUsed: string | null;
  dataLeft: string | null;
  /** EXPIRED only: the reason derived from the controller's own fields. */
  expiredReason: string | null;
  productName: string | null;
}

export type Row = Record<string, unknown>;

const NO_LIMIT = "No limit";
const UNLIMITED = "Unlimited";

function pick(row: Row, keys: string[]): unknown {
  for (const key of Object.keys(row)) {
    if (keys.some((k) => k.toLowerCase() === key.toLowerCase())) {
      const value = row[key];
      if (value !== null && value !== undefined && value !== "") return value;
    }
  }
  return undefined;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function monitorState(raw: unknown): MonitorState | null {
  const n = num(raw);
  if (n === 0) return "unused";
  if (n === 1) return "in_use";
  if (n === 2) return "expired";
  const text = String(raw ?? "").toLowerCase();
  if (text.includes("unused")) return "unused";
  if (text.includes("expire")) return "expired";
  if (text.includes("use")) return "in_use";
  return null;
}

const LABELS: Record<MonitorState, MonitorCard["statusLabel"]> = {
  unused: "UNUSED",
  in_use: "IN-USE",
  expired: "EXPIRED",
};

/** Compact captive-portal friendly duration: "1h 24m", "2d 3h", "45m". */
export function compactDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return s === 0 ? "0m" : "under a minute";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit <= 1 ? 0 : 1)} ${units[unit]}`;
}

/** Omada reports the configured cap in whole megabytes. */
export function formatMegabytes(mb: number | null): string | null {
  if (mb === null) return null;
  return formatBytes(mb * 1024 * 1024);
}

/** Traffic cap in MB; 0/absent/disabled means the controller set no cap. */
export function trafficLimitMb(voucher: Row, group: Row | null): number | null {
  const enabled = pick(voucher, ["trafficLimitEnable"]) ?? pick(group ?? {}, ["trafficLimitEnable"]);
  if (enabled === false || enabled === 0 || enabled === "false") return null;
  const limit = num(pick(voucher, ["trafficLimit"]) ?? pick(group ?? {}, ["trafficLimit"]));
  if (limit === null || limit <= 0) return null;
  return limit;
}

/** Configured duration in seconds; null when the controller caps no time. */
export function durationSeconds(voucher: Row, group: Row | null): number | null {
  const minutes = num(pick(voucher, ["duration", "durationMinutes"]) ?? pick(group ?? {}, ["duration"]));
  if (minutes === null || minutes <= 0) return null;
  return minutes * 60;
}

/** Omada durationType 1 = "consume time by usage", i.e. a pausable allowance. */
export function isPausable(voucher: Row, group: Row | null): boolean {
  const type = num(pick(voucher, ["durationType"]) ?? pick(group ?? {}, ["durationType"]));
  return type === 1;
}

function usedSeconds(voucher: Row): number | null {
  const direct = num(pick(voucher, ["timeUsedSec", "timeUsed", "usedTime"]));
  if (direct !== null) return direct;
  // Fall back to the controller's own timestamps, never to a local countdown.
  const start = num(pick(voucher, ["startTime", "beginTime", "inUseTime"]));
  if (start === null || start <= 0) return null;
  const startMs = start < 1e12 ? start * 1000 : start;
  const end = num(pick(voucher, ["endTime", "expirationTime"]));
  const endMs = end !== null && end > 0 ? (end < 1e12 ? end * 1000 : end) : Date.now();
  const state = monitorState(pick(voucher, ["status", "state"]));
  const until = state === "expired" && end !== null && end > 0 ? endMs : Date.now();
  return Math.max(0, Math.floor((until - startMs) / 1000));
}

function usedBytes(voucher: Row, limitMb: number | null): number | null {
  const direct = num(pick(voucher, ["trafficUsed", "trafficUsage"]));
  if (direct !== null) return direct;
  const unused = num(pick(voucher, ["trafficUnused", "trafficLeft", "remainingTraffic"]));
  if (unused === null || limitMb === null) return null;
  return Math.max(0, limitMb * 1024 * 1024 - unused);
}

/**
 * Why the controller considers this voucher finished. Derived from the
 * controller's own counters only; when they cannot distinguish a cause the
 * card says so truthfully instead of guessing.
 */
export function expiryReason(voucher: Row, group: Row | null): string {
  const limitMb = trafficLimitMb(voucher, group);
  const unused = num(pick(voucher, ["trafficUnused", "trafficLeft", "remainingTraffic"]));
  if (limitMb !== null && unused !== null && unused <= 0) {
    return "Expired because the data limit was reached";
  }
  const timeLeft = num(pick(voucher, ["timeLeftSec", "timeLeft", "remainingTime"]));
  if (durationSeconds(voucher, group) !== null && timeLeft !== null && timeLeft <= 0) {
    return "Expired because the time limit was reached";
  }
  const end = num(pick(voucher, ["endTime", "expirationTime", "expireTime"]));
  if (end !== null && end > 0) {
    const endMs = end < 1e12 ? end * 1000 : end;
    if (endMs <= Date.now()) return "Expired because the voucher expired";
  }
  return "Expired according to Omada";
}

/**
 * Builds one monitoring card from the controller's voucher row.
 * Returns null when Omada's status value cannot be read, so the caller reports
 * a controller problem instead of showing a made-up state.
 */
export function toMonitorCard(
  code: string,
  voucher: Row,
  group: Row | null = null,
  productName: string | null = null,
): MonitorCard | null {
  const state = monitorState(pick(voucher, ["status", "state"]));
  if (!state) return null;

  const limitMb = trafficLimitMb(voucher, group);
  const duration = durationSeconds(voucher, group);
  const timeLeft = num(pick(voucher, ["timeLeftSec", "timeLeft", "remainingTime"]));
  const unused = num(pick(voucher, ["trafficUnused", "trafficLeft", "remainingTraffic"]));
  const used = usedBytes(voucher, limitMb);
  const running = usedSeconds(voucher);
  const clean = code.trim().toUpperCase();

  return {
    code: clean,
    masked: clean.length > 4 ? `••••${clean.slice(-4)}` : clean,
    state,
    statusLabel: LABELS[state],
    time: duration === null ? UNLIMITED : compactDuration(duration),
    pausable: isPausable(voucher, group),
    consumableData: limitMb === null ? UNLIMITED : formatMegabytes(limitMb),
    runningTime: state === "unused" ? null : compactDuration(running),
    remainingTime:
      state === "unused" ? null : duration === null ? NO_LIMIT : compactDuration(timeLeft),
    dataUsed: state === "unused" ? null : formatBytes(used),
    dataLeft: state === "unused" ? null : limitMb === null ? NO_LIMIT : formatBytes(unused),
    expiredReason: state === "expired" ? expiryReason(voucher, group) : null,
    productName,
  };
}

/* ------------------------------------------------------------------ */
/* Monitoring list composition                                         */
/* ------------------------------------------------------------------ */

export interface MonitorRecord {
  code: string;
  source: "manual" | "purchase";
  monitoring: boolean;
  productName?: string | null;
}

export interface OwnedCode {
  code: string;
  productName?: string | null;
}

/**
 * The customer's monitoring list: every voucher this customer actually bought
 * in this shop, plus the ones they added by hand, minus the ones they switched
 * off. A purchased voucher needs no monitoring row to appear, which is what
 * makes automatic purchase linking idempotent by construction — replaying the
 * same purchase can never produce a second entry.
 */
export function monitoringList(owned: OwnedCode[], records: MonitorRecord[]): OwnedCode[] {
  const byCode = new Map<string, MonitorRecord>();
  for (const r of records) byCode.set(r.code.trim().toUpperCase(), r);

  const out: OwnedCode[] = [];
  const seen = new Set<string>();
  const add = (code: string, productName: string | null | undefined) => {
    const clean = code.trim().toUpperCase();
    if (!clean || seen.has(clean)) return;
    const record = byCode.get(clean);
    if (record && !record.monitoring) return;
    seen.add(clean);
    out.push({ code: clean, productName: productName ?? record?.productName ?? null });
  };

  for (const o of owned) add(o.code, o.productName);
  for (const r of records) if (r.monitoring) add(r.code, r.productName);
  return out;
}

/** Local-user monitoring view; all values come straight from the controller. */
export interface LocalUserView {
  username: string;
  expiresAt: string | null;
  dataRemaining: string;
}

export function toLocalUserView(row: Row): LocalUserView | null {
  const username = String(pick(row, ["name", "userName", "username"]) ?? "").trim();
  if (!username) return null;
  const limitMb = trafficLimitMb(row, null);
  const unused = num(pick(row, ["trafficUnused", "trafficLeft", "remainingTraffic"]));
  const end = num(pick(row, ["expirationTime", "endTime", "expireTime"]));
  let expiresAt: string | null = null;
  if (end !== null && end > 0 && end < 4.1e12) {
    expiresAt = new Date(end < 1e12 ? end * 1000 : end).toLocaleString();
  }
  return {
    username,
    expiresAt,
    dataRemaining: limitMb === null ? UNLIMITED : (formatBytes(unused) ?? UNLIMITED),
  };
}
