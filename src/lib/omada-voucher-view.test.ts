/**
 * Mapping tests use REAL Controller 6.2.14.11 payload shapes captured from the
 * live Sagada Wave controller (voucher rows, voucher groups, authorized clients).
 */
import { describe, expect, it } from "vitest";
import { clientsForVoucher, toVoucherView, voucherState } from "./omada-voucher-view";

const group = { unitPrice: "20", currency: "PHP", duration: 420, trafficLimit: 3072 };

const unused = {
  code: "32673296",
  status: 0,
  trafficUsed: 0,
  trafficUnused: 1073741824,
  trafficLimit: 1024,
  startTime: 0,
  endTime: 9223372036854776000,
  timeUsedSec: 0,
  timeLeftSec: 10800,
};

const inUse = {
  code: "89859160",
  status: 1,
  trafficUnused: 536870912,
  trafficLimit: 1024,
  startTime: 1786751723817,
  endTime: 1786762523817,
  timeLeftSec: 5400,
};

const expired = {
  code: "61851185",
  status: 2,
  trafficUnused: 0,
  trafficLimit: 1024,
  startTime: 1786751723817,
  endTime: 1786751967766,
  timeLeftSec: 0,
};

const clients = [
  { mac: "0E-AD-EA-67-5B-08", name: "0E-AD-EA-67-5B-08", authInfo: [{ authType: 3, info: "89859160" }] },
  { mac: "AA-BB-CC-DD-EE-FF", name: "OPPO-A58", hostName: "OPPO-A58", authInfo: [{ authType: 3, info: "89859160" }] },
  { mac: "11-22-33-44-55-66", name: "Other", authInfo: [{ authType: 5, info: "Rhaine" }] },
];

describe("voucherState", () => {
  it("maps the controller's numeric status", () => {
    expect(voucherState(0)).toBe("unused");
    expect(voucherState(1)).toBe("in_use");
    expect(voucherState(2)).toBe("expired");
  });

  it("never invents a state", () => {
    expect(voucherState(undefined)).toBeNull();
    expect(voucherState("weird")).toBeNull();
  });
});

describe("toVoucherView", () => {
  it("shows an unused voucher with no devices and no fake expiry", () => {
    const view = toVoucherView("32673296", unused, group, clients);
    expect(view?.stateLabel).toBe("Unused");
    expect(view?.devices).toHaveLength(0);
    expect(view?.expiresAt).toBeNull();
    expect(view?.startedAt).toBeNull();
    expect(view?.devicesUnavailable).toBe(false);
    expect(view?.price).toBe("₱20");
  });

  it("lists every authorized device of an in-use voucher separately", () => {
    const view = toVoucherView("89859160", inUse, group, clients);
    expect(view?.stateLabel).toBe("In-use");
    expect(view?.devices).toHaveLength(2);
    expect(view?.devices.map((d) => d.mac)).toEqual(["0E-AD-EA-67-5B-08", "AA-BB-CC-DD-EE-FF"]);
    expect(view?.devices[0]?.deviceName).toBeNull(); // MAC-as-name is not a name
    expect(view?.devices[1]?.deviceName).toBe("OPPO-A58");
    expect(view?.devices[0]?.remainingTime).toBe("1 hour 30 min");
    expect(view?.devices[0]?.remainingData).toBe("512 MB");
    expect(view?.devices[0]?.expiresAt).not.toBeNull();
  });

  it("reports an expired voucher and flags missing device data", () => {
    const view = toVoucherView("61851185", expired, group, []);
    expect(view?.stateLabel).toBe("Expired");
    expect(view?.remainingTime).toBe("None left");
    expect(view?.remainingData).toBe("None left");
    expect(view?.devicesUnavailable).toBe(true);
  });

  it("returns null instead of an Unknown state", () => {
    expect(toVoucherView("1", { code: "1" }, group, [])).toBeNull();
  });

  it("only matches clients authorized by that voucher code", () => {
    expect(clientsForVoucher(clients, "89859160")).toHaveLength(2);
    expect(clientsForVoucher(clients, "00000000")).toHaveLength(0);
  });
});
