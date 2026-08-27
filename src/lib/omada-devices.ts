/**
 * Antenna (managed Omada device) presentation model — browser safe.
 *
 * "Antenna" is what shops call these units in the field, so that is the word
 * the interface uses everywhere. The real controller device type (ap, gateway,
 * switch) is still carried and stored so nothing is lost or guessed.
 *
 * Status words come from the controller's own `status` / `detailStatus` codes
 * as returned by Controller 6.2.14.11. An unrecognised code is reported
 * honestly as an unknown reported state — never silently shown as healthy.
 */

export type DeviceHealth = "online" | "offline" | "pending" | "warning" | "unknown";

export interface AntennaView {
  /** Controller device address; the stable identifier for an antenna. */
  mac: string;
  name: string;
  /** Actual controller device type: ap | gateway | switch | … */
  deviceType: string;
  model: string | null;
  ip: string | null;
  publicIp: string | null;
  serial: string | null;
  firmware: string | null;
  uptime: string | null;
  cpuPercent: number | null;
  memoryPercent: number | null;
  lastSeen: string | null;
  health: DeviceHealth;
  /** Plain words for the controller state, e.g. "Connected (wireless)". */
  statusLabel: string;
  /** Raw controller codes, kept for support/diagnostics. */
  statusCode: number | null;
  detailStatusCode: number | null;
  /** Assignment, when this antenna is given to a member of the shop. */
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedAt: string | null;
  /** True when the assignment exists but the controller no longer lists it. */
  missingFromController: boolean;
}

/** Controller `detailStatus` code → plain words + health, per Omada's device model. */
const DETAIL_STATUS: Record<number, { label: string; health: DeviceHealth }> = {
  0: { label: "Disconnected", health: "offline" },
  1: { label: "Disconnected (migrating)", health: "offline" },
  10: { label: "Provisioning", health: "pending" },
  11: { label: "Configuring", health: "pending" },
  12: { label: "Upgrading", health: "pending" },
  13: { label: "Rebooting", health: "pending" },
  14: { label: "Connected", health: "online" },
  15: { label: "Connected (wireless)", health: "online" },
  16: { label: "Connected (migrating)", health: "online" },
  17: { label: "Connected (wireless, migrating)", health: "online" },
  20: { label: "Pending adoption", health: "pending" },
  21: { label: "Pending adoption (wireless)", health: "pending" },
  22: { label: "Adopting", health: "pending" },
  23: { label: "Adopting (wireless)", health: "pending" },
  24: { label: "Adoption failed", health: "warning" },
  25: { label: "Adoption failed (wireless)", health: "warning" },
  26: { label: "Managed by another controller", health: "warning" },
  27: { label: "Managed by another controller (wireless)", health: "warning" },
  30: { label: "Heartbeat missed", health: "warning" },
  31: { label: "Heartbeat missed (wireless)", health: "warning" },
  32: { label: "Heartbeat missed (migrating)", health: "warning" },
  33: { label: "Heartbeat missed (wireless, migrating)", health: "warning" },
  40: { label: "Isolated", health: "warning" },
  41: { label: "Isolated (migrating)", health: "warning" },
};

/** Coarse `status` code, used when the detailed code is not recognised. */
const STATUS: Record<number, { label: string; health: DeviceHealth }> = {
  0: { label: "Disconnected", health: "offline" },
  1: { label: "Connected", health: "online" },
  2: { label: "Pending adoption", health: "pending" },
  3: { label: "Heartbeat missed", health: "warning" },
  4: { label: "Isolated", health: "warning" },
  5: { label: "Adoption failed", health: "warning" },
  6: { label: "Managed by another controller", health: "warning" },
};

export function describeDeviceStatus(
  status: number | null,
  detailStatus: number | null,
): { label: string; health: DeviceHealth } {
  if (detailStatus !== null && DETAIL_STATUS[detailStatus]) return DETAIL_STATUS[detailStatus]!;
  if (status !== null && STATUS[status]) return STATUS[status]!;
  const code = detailStatus ?? status;
  return {
    label: code === null ? "Unknown state" : `Unknown reported state (${code})`,
    health: "unknown",
  };
}

/** Field-friendly label; the controller word is kept alongside it. */
export function antennaTypeLabel(deviceType: string): string {
  const t = deviceType.toLowerCase();
  if (t === "ap") return "Antenna (access point)";
  if (t === "gateway") return "Router / gateway";
  if (t === "switch") return "Switch";
  return deviceType || "Device";
}

export const healthTone: Record<DeviceHealth, string> = {
  online: "bg-success/10 text-success border-success/30",
  offline: "bg-destructive/10 text-destructive border-destructive/30",
  pending: "bg-primary/10 text-primary border-primary/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

export function normaliseMac(mac: string): string {
  return mac.trim().toUpperCase().replace(/:/g, "-");
}
