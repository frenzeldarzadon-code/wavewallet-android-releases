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

/* -------------------------------------------------------------------------
 * Extended device management.
 *
 * Every endpoint below was verified live against this project's connected
 * Omada Controller 6.2.14.11 before being exposed. Endpoints the controller
 * answered with HTTP 400 / "not supported" (per-AP health detail, device
 * timeline, per-device traffic charts, AP uplink-port config) are deliberately
 * NOT wrapped here so the interface cannot offer a control that does nothing.
 * ---------------------------------------------------------------------- */

export interface DeviceFirmwareInfo {
  current: string | null;
  latest: string | null;
  releaseLog: string | null;
  updateAvailable: boolean;
}

/** GET /devices/{mac}/latest-firmware-info — verified. */
export async function getDeviceFirmware(
  session: OmadaSession,
  mac: string,
): Promise<DeviceFirmwareInfo> {
  const r = (await omadaSiteCall(
    session,
    `/devices/${encodeURIComponent(mac)}/latest-firmware-info`,
  )) as Record<string, unknown> | null;
  const current = str(r?.["curFwVer"]);
  const latest = str(r?.["lastFwVer"]);
  return {
    current,
    latest,
    releaseLog: str(r?.["fwReleaseLog"]),
    updateAvailable: Boolean(latest && latest !== current),
  };
}

/** POST /devices/{mac}/start-online-upgrade — verified path; asynchronous. */
export async function startOnlineUpgrade(session: OmadaSession, mac: string): Promise<void> {
  await omadaSiteCall(session, `/devices/${encodeURIComponent(mac)}/start-online-upgrade`, {
    method: "POST",
    body: "{}",
  });
}

/** GET /devices/{mac}/adopt-result — verified. */
export async function getAdoptResult(
  session: OmadaSession,
  mac: string,
): Promise<{ errorCode: number | null; failedType: number | null }> {
  const r = (await omadaSiteCall(
    session,
    `/devices/${encodeURIComponent(mac)}/adopt-result`,
  )) as Record<string, unknown> | null;
  return { errorCode: num(r?.["adoptErrorCode"]), failedType: num(r?.["adoptFailedType"]) };
}

/** POST /devices/{mac}/start-adopt — asynchronous; result via getAdoptResult. */
export async function startAdopt(
  session: OmadaSession,
  mac: string,
  credentials?: { username?: string; password?: string },
): Promise<void> {
  const body: Record<string, string> = {};
  if (credentials?.username) body["username"] = credentials.username;
  if (credentials?.password) body["password"] = credentials.password;
  await omadaSiteCall(session, `/devices/${encodeURIComponent(mac)}/start-adopt`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** POST /devices/{mac}/force-provision */
export async function forceProvisionDevice(session: OmadaSession, mac: string): Promise<void> {
  await omadaSiteCall(session, `/devices/${encodeURIComponent(mac)}/force-provision`, {
    method: "POST",
    body: "{}",
  });
}

/** POST /devices/{mac}/forget — removes the device from this site. */
export async function forgetDevice(session: OmadaSession, mac: string): Promise<void> {
  await omadaSiteCall(session, `/devices/${encodeURIComponent(mac)}/forget`, {
    method: "POST",
    body: "{}",
  });
}

/** POST /devices/{mac}/locate — flashes the device LED on/off. */
export async function locateDevice(
  session: OmadaSession,
  mac: string,
  enable: boolean,
): Promise<void> {
  await omadaSiteCall(session, `/devices/${encodeURIComponent(mac)}/locate`, {
    method: "POST",
    body: JSON.stringify({ locateEnable: enable }),
  });
}

export interface RadioBandSetting {
  band: "2g" | "5g" | "5g1" | "5g2" | "6g";
  radioEnable: boolean;
  channel: string | null;
  freq: number | null;
  channelWidth: string | null;
  txPower: number | null;
  txPowerLevel: number | null;
  wirelessMode: number | null;
}

const BANDS: Array<{ key: string; band: RadioBandSetting["band"] }> = [
  { key: "radioSetting2g", band: "2g" },
  { key: "radioSetting5g", band: "5g" },
  { key: "radioSetting5g1", band: "5g1" },
  { key: "radioSetting5g2", band: "5g2" },
  { key: "radioSetting6g", band: "6g" },
];

/** GET /aps/{mac}/radio-config — verified. Only bands the AP reports appear. */
export async function getApRadioConfig(
  session: OmadaSession,
  mac: string,
): Promise<RadioBandSetting[]> {
  const r = (await omadaSiteCall(session, `/aps/${encodeURIComponent(mac)}/radio-config`)) as
    | Record<string, unknown>
    | null;
  const out: RadioBandSetting[] = [];
  for (const { key, band } of BANDS) {
    const raw = r?.[key] as Record<string, unknown> | undefined;
    if (!raw) continue;
    out.push({
      band,
      radioEnable: raw["radioEnable"] !== false,
      channel: str(raw["channel"]),
      freq: num(raw["freq"]),
      channelWidth: str(raw["channelWidth"]),
      txPower: num(raw["txPower"]),
      txPowerLevel: num(raw["txPowerLevel"]),
      wirelessMode: num(raw["wirelessMode"]),
    });
  }
  return out;
}

export interface RadioBandUpdate {
  band: RadioBandSetting["band"];
  radioEnable?: boolean;
  channel?: string;
  freq?: number;
  channelWidth?: string;
  txPowerLevel?: number;
  txPower?: number;
}

/** PATCH /aps/{mac}/radio-config — only the bands passed in are touched. */
export function buildRadioPatchBody(updates: RadioBandUpdate[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const u of updates) {
    const key = BANDS.find((b) => b.band === u.band)?.key;
    if (!key) continue;
    const band: Record<string, unknown> = { radioEnable: u.radioEnable !== false };
    if (u.radioEnable !== false) {
      if (u.channel !== undefined) band["channel"] = u.channel;
      if (u.freq !== undefined) band["freq"] = u.freq;
      if (u.channelWidth !== undefined) band["channelWidth"] = u.channelWidth;
      if (u.txPowerLevel !== undefined) band["txPowerLevel"] = u.txPowerLevel;
      if (u.txPowerLevel === 3 && u.txPower !== undefined) band["txPower"] = u.txPower;
    }
    body[key] = band;
  }
  return body;
}

export async function updateApRadioConfig(
  session: OmadaSession,
  mac: string,
  updates: RadioBandUpdate[],
): Promise<void> {
  const body = buildRadioPatchBody(updates);
  if (!Object.keys(body).length) return;
  await omadaSiteCall(session, `/aps/${encodeURIComponent(mac)}/radio-config`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export interface ChannelOption {
  band: string;
  radioId: number | null;
  channel: string;
  freq: number | null;
  label: string;
  maxPower: number | null;
}

/** POST /aps/channel-info — the channel list the AP itself reports. */
export async function getApChannelOptions(
  session: OmadaSession,
  mac: string,
): Promise<ChannelOption[]> {
  const r = (await omadaSiteCall(session, `/aps/channel-info`, {
    method: "POST",
    body: JSON.stringify({ macList: [mac] }),
  })) as Record<string, unknown> | null;
  const groups = (r?.["data"] ?? r) as Array<Record<string, unknown>> | undefined;
  const out: ChannelOption[] = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const band = str(g["band"]) ?? "";
    const list = g["channelList"] as Array<Record<string, unknown>> | undefined;
    for (const c of Array.isArray(list) ? list : []) {
      const value = str(c["value"]);
      if (!value) continue;
      out.push({
        band,
        radioId: num(g["radioId"]),
        channel: value,
        freq: num(c["freq"]),
        label: str(c["channelName"]) ?? value,
        maxPower: num(c["maxPow"]),
      });
    }
  }
  return out;
}

export interface DeviceClient {
  mac: string;
  name: string;
  wireless: boolean;
  ssid: string | null;
  channel: number | null;
  guest: boolean;
}

/** GET /openapi/v2/.../topology/devices/{mac}/clients — verified. */
export async function listDeviceClients(
  session: OmadaSession,
  mac: string,
): Promise<DeviceClient[]> {
  const url = `${session.base}/openapi/v2/${session.omadacId}/sites/${session.siteId}/topology/devices/${encodeURIComponent(mac)}/clients`;
  const res = await fetch(url, {
    headers: { Authorization: `AccessToken=${session.token}`, "content-type": "application/json" },
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const rows = (body?.["result"] ?? []) as Array<Record<string, unknown>>;
  return (Array.isArray(rows) ? rows : []).map((c) => {
    const up = c["upApInfo"] as Record<string, unknown> | undefined;
    return {
      mac: (str(c["mac"]) ?? "").toUpperCase(),
      name: str(c["name"]) ?? str(c["mac"]) ?? "Device",
      wireless: c["wireless"] === true,
      ssid: str(up?.["ssid"]),
      channel: num(up?.["channel"]),
      guest: c["guest"] === true,
    };
  });
}
