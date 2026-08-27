/**
 * Translates the authoritative Omada voucher + authorized-client data into the
 * customer-facing Status Checker view.
 *
 * Omada stays the source of truth: nothing here invents, caches or corrects
 * network data. Verified against Controller 6.2.14.11:
 *   - voucher row:  { code, status 0|1|2, timeLeftSec, trafficUnused (bytes),
 *                     trafficLimit (MB, 0 = unlimited), startTime, endTime }
 *   - voucher group: { unitPrice, currency, duration, trafficLimit }
 *   - authorized client: { mac, name, hostName, authInfo:[{authType:3, info:<voucher code>}] }
 * Raw identifiers, byte/second counters and internal limits are deliberately
 * dropped so the checker never leaks controller internals.
 */

/** Only these three states are ever shown to a person. */
export type VoucherState = "unused" | "in_use" | "expired";

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
  /** Fields the hotspot authorization record itself reported, when present. */
  ipAddress: string | null;
  networkName: string | null;
  authorizedAt: string | null;
  deviceData: string | null;
  /** The controller's own validity flag for this authorization. */
  stillValid: boolean | null;
}


export interface VoucherView {
  code: string;
  state: VoucherState;
  stateLabel: string;
  price: string | null;
  remainingTime: string | null;
  remainingData: string | null;
  /** Authoritative voucher-level totals the controller already counted. */
  dataUsed: string | null;
  timeUsed: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  devices: VoucherDeviceView[];
  /** True when the voucher is in use/expired but no device is currently authorized. */
  devicesUnavailable: boolean;
}

const LABELS: Record<VoucherState, string> = {
  unused: "Unused",
  in_use: "In-use",
  expired: "Expired",
};

export const stateLabel = (s: VoucherState) => LABELS[s];

export type Row = Record<string, unknown>;

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

/**
 * Omada publishes voucher status as 0 unused / 1 in use / 2 expired.
 * Anything the controller does not express as one of those is reported as
 * `null` so the caller can say "status unavailable" instead of "Unknown".
 */
export function voucherState(raw: unknown): VoucherState | null {
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

/** Omada timestamps are epoch milliseconds; unset/never is 0 or a sentinel. */
export function formatMoment(raw: unknown): string | null {
  const n = num(raw);
  if (n !== null) {
    if (n <= 0 || n > 4.1e12) return null; // 0 = not started, huge = "no expiry"
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toLocaleString();
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toLocaleString();
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

function formatPrice(voucher: Row, group: Row | null): string | null {
  const price = num(pick(voucher, ["unitPrice", "price"]) ?? pick(group ?? {}, ["unitPrice", "price"]));
  if (price === null) return null;
  const currency = String(pick(group ?? {}, ["currency"]) ?? pick(voucher, ["currency"]) ?? "").trim();
  const money = price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return currency && currency !== "PHP" ? `${currency} ${money}` : `₱${money}`;
}

function usedDataOf(voucher: Row): string | null {
  const used = num(pick(voucher, ["trafficUsed", "trafficUsage"]));
  return used === null ? null : used <= 0 ? "None yet" : formatData(used);
}

function usedTimeOf(voucher: Row): string | null {
  const used = num(pick(voucher, ["timeUsedSec", "timeUsed"]));
  if (used === null) return null;
  if (used <= 0) return "None yet";
  return formatDuration(used);
}

function remainingTimeOf(voucher: Row): string | null {
  const left = num(pick(voucher, ["timeLeftSec", "remainingTime", "timeLeft"]));
  return left === null ? null : formatDuration(left);
}

function remainingDataOf(voucher: Row): string | null {
  const limit = num(pick(voucher, ["trafficLimit"]));
  if (limit !== null && limit <= 0) return "Unlimited";
  const left = num(pick(voucher, ["trafficUnused", "trafficLeft", "remainingTraffic"]));
  return left === null ? null : formatData(left);
}

/** Omada tags a client's authorization source; 3 is a hotspot voucher. */
const VOUCHER_AUTH_TYPE = 3;

function macOf(row: Row): string | null {
  const raw = pick(row, ["mac", "clientMac", "deviceMac", "macAddress"]);
  const text = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return text ? text : null;
}

function nameOf(row: Row): string | null {
  const raw = pick(row, ["hostName", "name", "deviceName", "clientName", "hostname"]);
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  // Omada falls back to the MAC as the name; that is not a useful device name.
  return text.toUpperCase() === macOf(row) ? null : text;
}

/**
 * Every record whose voucher authorization matches this code.
 *
 * Handles both shapes: a hotspot authorization record (`voucherCode`, the
 * authoritative source) and a live client row (`authInfo[{authType,info}]`).
 */
export function clientsForVoucher(clients: Row[], code: string): Row[] {
  const wanted = code.trim().toUpperCase();
  return clients.filter((client) => {
    const direct = pick(client, ["voucherCode"]);
    if (direct !== undefined) {
      const type = num(pick(client, ["authType"]));
      if (type !== null && type !== VOUCHER_AUTH_TYPE) return false;
      return String(direct).trim().toUpperCase() === wanted;
    }
    const info = client["authInfo"];
    if (!Array.isArray(info)) return false;
    return info.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const e = entry as Row;
      const type = num(e["authType"]);
      const value = String(e["info"] ?? "").trim().toUpperCase();
      return (type === null || type === VOUCHER_AUTH_TYPE) && value === wanted;
    });
  });
}

function deviceTrafficOf(row: Row): string | null {
  const download = num(pick(row, ["download", "trafficDown"])) ?? 0;
  const upload = num(pick(row, ["upload", "trafficUp"])) ?? 0;
  const total = download + upload;
  return total > 0 ? formatData(total) : null;
}

/**
 * Builds the view for one Omada voucher. A voucher may be used by several
 * devices; each authorized device is returned separately with its own details.
 * Returns null when the controller's status value cannot be mapped, so the
 * caller reports a controller problem rather than a made-up state.
 */
export function toVoucherView(
  code: string,
  voucher: Row,
  group: Row | null = null,
  clients: Row[] = [],
): VoucherView | null {
  const state = voucherState(pick(voucher, ["status", "state"]));
  if (!state) return null;

  const price = formatPrice(voucher, group);
  const remainingTime = remainingTimeOf(voucher);
  const remainingData = remainingDataOf(voucher);
  const dataUsed = usedDataOf(voucher);
  const timeUsed = usedTimeOf(voucher);
  const startedAt = formatMoment(pick(voucher, ["startTime", "beginTime", "inUseTime"]));
  const expiresAt = formatMoment(pick(voucher, ["endTime", "expirationTime", "expireTime"]));

  // An unused voucher has no authorization records; anything else lists every
  // device the controller authorized, whether or not it is online right now.
  const matched = state === "unused" ? [] : clientsForVoucher(clients, code);
  const devices = matched.map<VoucherDeviceView>((client) => {
    const valid = client["valid"];
    return {
      mac: macOf(client),
      deviceName: nameOf(client),
      state,
      remainingTime,
      remainingData,
      startedAt,
      expiresAt,
      price,
      ipAddress: (pick(client, ["ip", "ipAddress"]) as string | undefined) ?? null,
      networkName: (pick(client, ["ssid", "networkName"]) as string | undefined) ?? null,
      authorizedAt: formatMoment(pick(client, ["start", "startTime", "connectTime"])),
      deviceData: deviceTrafficOf(client),
      stillValid: typeof valid === "boolean" ? valid : null,
    };
  });

  return {
    code: code.trim().toUpperCase(),
    state,
    stateLabel: LABELS[state],
    price,
    remainingTime,
    remainingData,
    dataUsed,
    timeUsed,
    startedAt,
    expiresAt,
    devices,
    devicesUnavailable: state !== "unused" && devices.length === 0,
  };
}

