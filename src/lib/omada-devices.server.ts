/**
 * Managed-device (antenna) operations against ONE shop's own Omada controller.
 *
 * Endpoints verified live against Sagada Wave's Controller 6.2.14.11:
 *   GET  /openapi/v1/{omadacId}/sites/{siteId}/devices?page=&pageSize=
 *        → { totalRows, currentPage, data: [ { mac, name, type, model,
 *            modelName, ip, publicIp, sn, status, detailStatus, uptime,
 *            lastSeen, cpuUtil, memUtil, firmwareVersion, … } ] }
 *   POST /openapi/v1/{omadacId}/sites/{siteId}/devices/{mac}/reboot
 *        → { errorCode: 0 } on success (an unknown device answers -39006).
 *
 * These are the managed-device operations — NOT the hotspot authorized records
 * and NOT the generic client snapshot, which describe voucher users instead.
 */
import { omadaSiteCall, type OmadaSession } from "./omada-api.server";

export interface ControllerDevice {
  mac: string;
  name: string;
  type: string;
  model: string | null;
  ip: string | null;
  publicIp: string | null;
  serial: string | null;
  firmware: string | null;
  uptime: string | null;
  cpuPercent: number | null;
  memoryPercent: number | null;
  lastSeen: string | null;
  status: number | null;
  detailStatus: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;

function toDevice(row: Record<string, unknown>): ControllerDevice | null {
  const mac = str(row["mac"]);
  if (!mac) return null;
  const seen = num(row["lastSeen"]);
  return {
    mac: mac.toUpperCase(),
    name: str(row["name"]) ?? mac.toUpperCase(),
    type: (str(row["type"]) ?? "device").toLowerCase(),
    model: str(row["modelName"]) ?? str(row["model"]),
    ip: str(row["ip"]),
    publicIp: str(row["publicIp"]),
    serial: str(row["sn"]),
    firmware: str(row["firmwareVersion"]),
    uptime: str(row["uptime"]),
    cpuPercent: num(row["cpuUtil"]),
    memoryPercent: num(row["memUtil"]),
    lastSeen: seen ? new Date(seen).toISOString() : null,
    status: num(row["status"]),
    detailStatus: num(row["detailStatus"]),
  };
}

/** Every device the controller manages on this shop's own site. */
export async function listSiteDevices(session: OmadaSession): Promise<ControllerDevice[]> {
  const pageSize = 100;
  const devices: ControllerDevice[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = (await omadaSiteCall(session, `/devices?page=${page}&pageSize=${pageSize}`)) as
      | Record<string, unknown>
      | null;
    const raw = (result?.["data"] ?? result) as unknown;
    const batch = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
    for (const row of batch) {
      const device = toDevice(row);
      if (device) devices.push(device);
    }
    const total = Number(result?.["totalRows"] ?? devices.length);
    if (batch.length === 0 || batch.length < pageSize || devices.length >= total) break;
  }
  return devices;
}

/**
 * Restart one managed device on this shop's site.
 * Throws OmadaError when the controller refuses; never silently succeeds.
 */
export async function rebootSiteDevice(session: OmadaSession, mac: string): Promise<void> {
  await omadaSiteCall(session, `/devices/${encodeURIComponent(mac)}/reboot`, {
    method: "POST",
    body: "{}",
  });
}
