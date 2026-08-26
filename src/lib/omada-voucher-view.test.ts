import { describe, expect, it } from "vitest";
import { formatData, formatDuration, toVoucherView, voucherState } from "./omada-voucher-view";

describe("authoritative status mapping", () => {
  it("maps Omada's numeric status to the three customer states", () => {
    expect(voucherState(0)).toBe("unused");
    expect(voucherState(1)).toBe("in_use");
    expect(voucherState(2)).toBe("expired");
    expect(voucherState("Expired")).toBe("expired");
    expect(voucherState(9)).toBe("unknown");
  });

  it("labels the state for the customer", () => {
    expect(toVoucherView("15918788", { status: 1 }).stateLabel).toBe("In-use");
    expect(toVoucherView("abc123", { status: 0 }).stateLabel).toBe("Unused");
  });
});

describe("device level view", () => {
  const row = {
    id: "5f2c",
    code: "15918788",
    status: 1,
    unitPrice: 20,
    currency: "PHP",
    trafficLimit: 1024 * 1024 * 1024,
    duration: 86400,
    expirationTime: 1_772_000_000_000,
    clients: [
      { mac: "aa:bb:cc:dd:ee:01", name: "Juan phone", timeLeftSec: 3600, trafficUsed: 512 * 1024 * 1024, beginTime: 1_771_900_000_000 },
      { clientMac: "aa:bb:cc:dd:ee:02", hostName: "Laptop", timeLeftSec: 60, trafficUsed: 0 },
    ],
  };

  it("lists every device separately with its own details", () => {
    const view = toVoucherView("15918788", row);
    expect(view.devices).toHaveLength(2);
    expect(view.devices[0]!.mac).toBe("AA:BB:CC:DD:EE:01");
    expect(view.devices[0]!.deviceName).toBe("Juan phone");
    expect(view.devices[0]!.remainingTime).toBe("1 hour");
    expect(view.devices[0]!.remainingData).toBe("512 MB");
    expect(view.devices[0]!.startedAt).toBeTruthy();
    expect(view.devices[0]!.expiresAt).toBeTruthy();
    expect(view.devices[1]!.mac).toBe("AA:BB:CC:DD:EE:02");
    expect(view.devices[1]!.deviceName).toBe("Laptop");
  });

  it("shows price on the voucher and on each device", () => {
    const view = toVoucherView("15918788", row);
    expect(view.price).toBe("PHP 20");
    expect(view.devices.every((d) => d.price === "PHP 20")).toBe(true);
  });

  it("never exposes raw controller fields", () => {
    const view = toVoucherView("15918788", row);
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("trafficUsed");
    expect(serialised).not.toContain("timeLeftSec");
    expect(serialised).not.toContain("5f2c");
  });

  it("shows no devices for an unused voucher", () => {
    expect(toVoucherView("abc123", { status: 0, unitPrice: 5 }).devices).toHaveLength(0);
  });
});

describe("human readable formatting", () => {
  it("formats remaining time and data", () => {
    expect(formatDuration(0)).toBe("None left");
    expect(formatDuration(90061)).toBe("1 day 1 hour");
    expect(formatData(0)).toBe("None left");
    expect(formatData(1536)).toBe("1.5 KB");
  });
});
