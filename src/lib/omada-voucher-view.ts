/**
 * Translates ONE authoritative Omada voucher row into the customer-facing view.
 *
 * Omada stays the source of truth: nothing here invents, caches or corrects
 * network data. This module only decides which of the controller's fields are
 * meaningful to a person at the counter and renders them in plain words. Raw
 * identifiers, byte counters, second counters and internal limit fields are
 * deliberately dropped so the Status Checker never leaks controller internals.
 */

export type VoucherState = "unused" | "in_use" | "expired" | "unknown";

export interface VoucherDeviceView {
  /** Device/client MAC as reported by Omada — the device identity. */
  mac: string | null;
  deviceName: string | null;
  state: VoucherState;
  remainingTime: string | null;
  remainingData: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  price: string | null;
}

export interface VoucherView {
  code: string;
  state: VoucherState;
  stateLabel: string;
  price: string | null;
  devices: VoucherDeviceView[];
}

const LABELS: Record<VoucherState, string> = {
  unused: "Unused",
  in_use: "In-use",
  expired: "Expired",
  unknown: "Unknown",
};

export const stateLabel = (s: VoucherState) => LABELS[s];

type Row = Record<string, unknown>;

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

/** Omada publishes status as 0 unused / 1 in use / 2 expired. */
export function voucherState(raw: unknown): VoucherState {
  const n = num(raw);
  if (n === 0) return "unused";
  if (n === 1) return "in_use";
  if (n === 2) return "expired";
  const text = String(raw ?? "").toLowerCase();
  if (text.includes("unused") || text === "valid") return "unused";
  if (text.includes("use")) return "in_use";
  if (text.includes("expire")) return "expired";
  return "unknown";
}

/** Omada timestamps are epoch milliseconds (sometimes seconds). */
export function formatMoment(raw: unknown): string | null {
  const n = num(raw);
  if (n === null || n <= 0) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return null;
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : new Date(parsed).toLocaleString();
  }
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toLocaleString();
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds <= 0) return "None left";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d} day${d === 1 ? "" : "s"}`);
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m && !d) parts.push(`${m} min`);
  if (parts.length === 0) parts.push("under a minute");
  return parts.join(" ");
}

export function formatData(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes <= 0) return "None left";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatPrice(row: Row): string | null {
  const price = num(pick(row, ["unitPrice", "price", "amount"]));
  if (price === null) return null;
  const currency = String(pick(row, ["currency"]) ?? "").trim();
  const money = price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return currency ? `${currency} ${money}` : `₱${money}`;
}

function remainingTimeOf(row: Row, parent: Row): string | null {
  const left = num(pick(row, ["timeLeftSec", "remainingTime", "timeLeft", "leftTime"]));
  if (left !== null) return formatDuration(left);
  const limit = num(pick(parent, ["duration", "durationLimit", "timeLimit", "durationSec"]));
  const used = num(pick(row, ["timeUsedSec", "usedTime", "timeUsed"]));
  if (limit === null) return null;
  const limitSec = limit > 100000 ? Math.round(limit / 1000) : limit * (limit < 1000 ? 60 : 1);
  return formatDuration(Math.max(0, limitSec - (used ?? 0)));
}

function remainingDataOf(row: Row, parent: Row): string | null {
  const left = num(pick(row, ["trafficLeft", "remainingTraffic", "trafficUnusedBytes"]));
  if (left !== null) return formatData(left);
  const limit = num(pick(parent, ["trafficLimit", "trafficLimitBytes", "dataLimit"]));
  if (limit === null || limit <= 0) return "Unlimited";
  const used = num(pick(row, ["trafficUsed", "trafficUsedBytes", "usedTraffic"])) ?? 0;
  return formatData(Math.max(0, limit - used));
}

function macOf(row: Row): string | null {
  const raw = pick(row, ["mac", "clientMac", "deviceMac", "macAddress"]);
  const text = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return text ? text : null;
}

function nameOf(row: Row): string | null {
  const raw = pick(row, ["name", "deviceName", "clientName", "hostName", "hostname"]);
  const text = typeof raw === "string" ? raw.trim() : "";
  return text ? text : null;
}

function deviceRows(row: Row): Row[] {
  for (const value of Object.values(row)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const objects = value.filter((v): v is Row => Boolean(v) && typeof v === "object");
    if (objects.length > 0 && objects.some((o) => macOf(o) !== null)) return objects;
  }
  return [];
}

/**
 * Builds the view for one Omada voucher. A voucher may be used by several
 * devices; each one keeps its own complete set of details.
 */
export function toVoucherView(code: string, row: Row): VoucherView {
  const state = voucherState(pick(row, ["status", "state"]));
  const price = formatPrice(row);
  const expiry = pick(row, ["expirationTime", "expireTime", "endTime", "expiredTime"]);

  const rows = deviceRows(row);
  const source: Row[] = rows.length > 0 ? rows : state === "unused" ? [] : [row];

  const devices = source.map<VoucherDeviceView>((d) => ({
    mac: macOf(d),
    deviceName: nameOf(d),
    state: rows.length > 0 ? voucherState(pick(d, ["status", "state"]) ?? pick(row, ["status"])) : state,
    remainingTime: remainingTimeOf(d, row),
    remainingData: remainingDataOf(d, row),
    startedAt: formatMoment(
      pick(d, ["beginTime", "startTime", "inUseTime", "firstSeen", "usedTime", "createdTime"]) ??
        pick(row, ["beginTime", "startTime", "inUseTime", "createdTime"]),
    ),
    expiresAt: formatMoment(pick(d, ["expirationTime", "expireTime", "endTime"]) ?? expiry),
    price,
  }));

  return { code: code.toUpperCase(), state, stateLabel: LABELS[state], price, devices };
}
