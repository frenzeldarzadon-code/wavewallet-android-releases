/** Uses real Controller 6.2.14.11 Authorized Client rows. */
import { describe, expect, it } from "vitest";
import { pastSessions, usageObservations, voucherClientIndex } from "./voucher-usage";

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
