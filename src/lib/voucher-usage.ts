/**
 * Persistent voucher use history ("Usage Tracer").
 *
 * Omada 6.2.14.11's Open API only reports clients that are authorized RIGHT
 * NOW — once a voucher expires or a device disconnects, the association is
 * gone from the controller. So every time WaveWallet reads an authoritative
 * status it also records what it observed, and later searches can still show
 * the past use. Nothing here is invented: only fields the controller actually
 * returned are stored.
 */

export type Row = Record<string, unknown>;

export interface UsageObservation {
  deviceMac: string;
  sessionKey: string;
  deviceName: string | null;
  ipAddress: string | null;
  apIdentifier: string | null;
  networkName: string | null;
  connectedAt: string | null;
  trafficBytes: number | null;
}

export interface UsageSessionView {
  id: string;
  deviceMac: string;
  deviceName: string | null;
  ipAddress: string | null;
  apIdentifier: string | null;
  networkName: string | null;
  connectedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  trafficBytes: number | null;
  voucherState: string | null;
  /** True when this device is authorized by the voucher in the live lookup. */
  current: boolean;
}

export interface AuthorizedUser {
  name: string | null;
  phone: string | null;
  soldAt: string | null;
  productName: string | null;
}

function pick(row: Row, keys: string[]): unknown {
  for (const key of Object.keys(row)) {
    if (keys.some((k) => k.toLowerCase() === key.toLowerCase())) {
      const value = row[key];
      if (value !== null && value !== undefined && value !== "") return value;
    }
  }
  return undefined;
}

function text(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return s ? s : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function moment(value: unknown): string | null {
  const n = num(value);
  if (n === null || n <= 0 || n > 4.1e12) return null;
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

/**
 * One observation of a device using a voucher, built only from the
 * controller's own client row. A device that reconnects later starts a new
 * session because its connect timestamp changes; when the controller gives no
 * connect time the voucher's own start time keeps sessions apart.
 */
export function usageObservation(client: Row, voucherStart?: unknown): UsageObservation | null {
  const mac = text(pick(client, ["mac", "clientMac", "deviceMac", "macAddress"]));
  if (!mac) return null;
  const upperMac = mac.toUpperCase();
  const name = text(pick(client, ["hostName", "name", "deviceName", "clientName"]));
  const connectedAt =
    moment(pick(client, ["connectTime", "associationTime", "lastConnectTime", "startTime"])) ??
    moment(voucherStart);
  const down = num(pick(client, ["trafficDown", "downPacket", "rxBytes"])) ?? 0;
  const up = num(pick(client, ["trafficUp", "upPacket", "txBytes"])) ?? 0;
  const totalRaw = num(pick(client, ["traffic", "trafficUsed", "totalTraffic"]));
  const traffic = totalRaw ?? (down + up > 0 ? down + up : null);

  return {
    deviceMac: upperMac,
    sessionKey: connectedAt ?? "unknown",
    deviceName: name && name.toUpperCase() === upperMac ? null : name,
    ipAddress: text(pick(client, ["ip", "ipAddress", "ipv4"])),
    apIdentifier: text(pick(client, ["apName", "apMac", "gatewayName", "switchName"])),
    networkName: text(pick(client, ["ssid", "networkName", "network"])),
    connectedAt,
    trafficBytes: traffic,
  };
}

export function usageObservations(clients: Row[], voucherStart?: unknown): UsageObservation[] {
  const out: UsageObservation[] = [];
  const seen = new Set<string>();
  for (const client of clients) {
    const obs = usageObservation(client, voucherStart);
    if (!obs) continue;
    const key = `${obs.deviceMac}|${obs.sessionKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(obs);
  }
  return out;
}

/** Sessions not currently authorized, newest use first. */
export function pastSessions(sessions: UsageSessionView[]): UsageSessionView[] {
  return sessions
    .filter((s) => !s.current)
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

/**
 * Groups the site's Authorized Clients by the voucher code that authorized
 * them (Omada auth type 3). This is the same authoritative client data the
 * controller's Authorized Clients view shows.
 */
export function voucherClientIndex(clients: Row[]): Map<string, Row[]> {
  const index = new Map<string, Row[]>();
  for (const client of clients) {
    const info = client["authInfo"];
    if (!Array.isArray(info)) continue;
    for (const entry of info) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Row;
      const type = num(e["authType"]);
      if (type !== null && type !== 3) continue;
      const code = text(e["info"])?.toUpperCase();
      if (!code) continue;
      const list = index.get(code) ?? [];
      list.push(client);
      index.set(code, list);
    }
  }
  return index;
}
