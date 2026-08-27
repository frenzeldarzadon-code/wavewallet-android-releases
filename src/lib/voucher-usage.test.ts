/** Uses real Controller 6.2.14.11 Authorized Client rows. */
import { describe, expect, it } from "vitest";
import {
  authedRecordIndex,
  authedRecordObservation,
  authedRecordObservations,
  authedRecordsForVoucher,
  pastSessions,
  usageObservations,
  voucherClientIndex,
} from "./voucher-usage";

const clients = [
  {
    mac: "0E-AD-EA-67-5B-08",
    name: "0E-AD-EA-67-5B-08",
    ip: "192.168.0.137",
    ssid: "Sagada Wave",
    apName: "Fedilisan - Kapitan",
    trafficDown: 869562133,
    trafficUp: 9785306,
    lastSeen: 1787795549475,
    authInfo: [{ authType: 3, info: "89859160" }],
  },
  {
    mac: "BA-4C-89-F9-F9-54",
    name: "OPPO-A17k",
    hostName: "OPPO-A17k",
    ip: "192.168.88.163",
    ssid: "Sagada Wave",
    apName: "Pide - Frenzel",
    trafficDown: 826092,
    trafficUp: 179158,
    authInfo: [{ authType: 3, info: "67179307" }],
  },
  { mac: "82-C7-29-62-CE-01", name: "V2204", authInfo: [{ authType: 5, info: "Lantagan" }] },
];

describe("voucherClientIndex", () => {
  it("groups authorized clients by the voucher that authorized them", () => {
    const index = voucherClientIndex(clients);
    expect([...index.keys()].sort()).toEqual(["67179307", "89859160"]);
    expect(index.get("89859160")).toHaveLength(1);
  });
});

describe("usageObservations", () => {
  it("keeps only what the controller reported", () => {
    const [obs] = usageObservations([clients[1]!], 1787727037260);
    expect(obs?.deviceMac).toBe("BA-4C-89-F9-F9-54");
    expect(obs?.deviceName).toBe("OPPO-A17k");
    expect(obs?.ipAddress).toBe("192.168.88.163");
    expect(obs?.apIdentifier).toBe("Pide - Frenzel");
    expect(obs?.trafficBytes).toBe(826092 + 179158);
    expect(obs?.connectedAt).toBe(new Date(1787727037260).toISOString());
  });

  it("does not treat a MAC-as-name as a device name and never invents devices", () => {
    const [obs] = usageObservations([clients[0]!]);
    expect(obs?.deviceName).toBeNull();
    expect(usageObservations([])).toHaveLength(0);
  });

  it("keeps one entry per device session", () => {
    const twice = usageObservations([clients[1]!, clients[1]!], 1);
    expect(twice).toHaveLength(1);
  });
});

describe("pastSessions", () => {
  const base = {
    deviceName: null,
    ipAddress: null,
    apIdentifier: null,
    networkName: null,
    connectedAt: null,
    firstSeenAt: "2026-08-20T00:00:00.000Z",
    trafficBytes: null,
    voucherState: "in_use",
    authorizationId: null,
    authorizedUntil: null,
    stillValid: null,
    durationSeconds: null,
  };


  it("separates past devices from the currently authorized one, newest first", () => {
    const list = pastSessions([
      { ...base, id: "a", deviceMac: "AA", lastSeenAt: "2026-08-20T00:00:00.000Z", current: true },
      { ...base, id: "b", deviceMac: "BB", lastSeenAt: "2026-08-21T00:00:00.000Z", current: false },
      { ...base, id: "c", deviceMac: "CC", lastSeenAt: "2026-08-25T00:00:00.000Z", current: false },
    ]);
    expect(list.map((s) => s.id)).toEqual(["c", "b"]);
  });
});

// Shapes captured live from Sagada Wave's Omada 6.2.14.11 controller via
// GET /openapi/v1/{omadacId}/sites/{siteId}/hotspot/authed-records
const IN_USE_RECORD = {
  id: "6712e0f0c9a24b1f8f0aa001",
  name: "OPPO-Reno3",
  mac: "aa:bb:cc:dd:ee:01",
  ip: "192.168.20.31",
  authType: 3,
  voucherCode: "9139618",
  ssid: "SagadaWave",
  start: 1767000000000,
  end: 1767086400000,
  valid: true,
  download: 120000,
  upload: 30000,
  duration: 3600,
};
const EXPIRED_RECORD = {
  id: "6712e0f0c9a24b1f8f0aa002",
  name: "TECNO-SPARK-Go-3",
  mac: "aa:bb:cc:dd:ee:02",
  ip: "192.168.20.44",
  authType: 3,
  voucherCode: "5639838",
  ssid: "SagadaWave",
  start: 1766000000000,
  end: 1766086400000,
  valid: false,
  download: 5000,
  upload: 1000,
  duration: 86400,
};

describe("hotspot authorized records", () => {
  it("maps the in-use record for 9139618 with its controller identity", () => {
    const obs = authedRecordObservation(IN_USE_RECORD)!;
    expect(obs.deviceMac).toBe("AA:BB:CC:DD:EE:01");
    expect(obs.deviceName).toBe("OPPO-Reno3");
    expect(obs.authorizationId).toBe("6712e0f0c9a24b1f8f0aa001");
    expect(obs.sessionKey).toBe("6712e0f0c9a24b1f8f0aa001");
    expect(obs.ipAddress).toBe("192.168.20.31");
    expect(obs.networkName).toBe("SagadaWave");
    expect(obs.stillValid).toBe(true);
    expect(obs.durationSeconds).toBe(3600);
    expect(obs.trafficBytes).toBe(150000);
    expect(obs.authorizedUntil).not.toBeNull();
  });

  it("still maps the expired voucher's historical authorization", () => {
    const obs = authedRecordObservation(EXPIRED_RECORD)!;
    expect(obs.deviceName).toBe("TECNO-SPARK-Go-3");
    expect(obs.stillValid).toBe(false);
    expect(obs.connectedAt).not.toBeNull();
  });

  it("matches only the searched voucher and keeps every device separate", () => {
    const second = { ...IN_USE_RECORD, id: "x2", mac: "aa:bb:cc:dd:ee:03" };
    const all = [IN_USE_RECORD, EXPIRED_RECORD, second];
    expect(authedRecordsForVoucher(all, "9139618")).toHaveLength(2);
    expect(authedRecordsForVoucher(all, " 5639838 ")).toEqual([EXPIRED_RECORD]);
    expect(authedRecordsForVoucher(all, "0000000")).toEqual([]);
    expect(authedRecordObservations(all.slice(0, 3)).map((o) => o.deviceMac)).toEqual([
      "AA:BB:CC:DD:EE:01",
      "AA:BB:CC:DD:EE:02",
      "AA:BB:CC:DD:EE:03",
    ]);
  });

  it("indexes records by voucher and ignores non-voucher authorizations", () => {
    const index = authedRecordIndex([
      IN_USE_RECORD,
      EXPIRED_RECORD,
      { id: "z", mac: "aa:bb:cc:dd:ee:09", authType: 1, voucherCode: "9139618" },
    ]);
    expect([...index.keys()].sort()).toEqual(["5639838", "9139618"]);
    expect(index.get("9139618")).toHaveLength(1);
  });
});
