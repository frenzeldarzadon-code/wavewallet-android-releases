/**
 * Live Voucher Monitoring regressions.
 *
 * These assert the real translation of controller rows (the same shapes the
 * Omada Open API returns on Controller 6.2.14.11) and the real composition of a
 * customer's monitoring list, not a mocked component.
 */
import { describe, expect, it } from "vitest";
import {
  compactDuration,
  expiryReason,
  monitoringList,
  toLocalUserView,
  toMonitorCard,
  type MonitorRecord,
} from "@/lib/voucher-monitoring";
import { localUserPath } from "@/lib/voucher-monitoring.server";
import { customerNav, navPaths, resellerNav, adminNav } from "@/lib/navigation";

const MB = 1024 * 1024;

/** Controller row for an untouched voucher: 7 hours, 3 GB. */
const unusedRow = {
  code: "ABCD1234",
  status: 0,
  duration: 420,
  durationType: 0,
  trafficLimitEnable: true,
  trafficLimit: 3072,
  trafficUnused: 3072 * MB,
  timeLeftSec: 25200,
  startTime: 0,
  endTime: 0,
};

const inUseRow = {
  code: "EFGH5678",
  status: 1,
  duration: 480,
  durationType: 0,
  trafficLimitEnable: true,
  trafficLimit: 3072,
  trafficUsed: 1229 * MB,
  trafficUnused: 1843 * MB,
  timeUsedSec: 5040,
  timeLeftSec: 23760,
};

describe("navigation: customer monitoring replaces Status Check", () => {
  it("1. a customer sees Live Voucher Monitoring instead of Status Check", () => {
    const paths = navPaths(customerNav());
    expect(paths).toContain("/app/monitor");
    expect(paths).not.toContain("/app/omada");
  });

  it("2/3. resellers and subresellers keep Status Check exactly", () => {
    expect(navPaths(resellerNav("reseller"))).toContain("/reseller/omada");
    expect(navPaths(resellerNav("subreseller"))).toContain("/reseller/omada");
    expect(navPaths(resellerNav("reseller"))).not.toContain("/app/monitor");
  });

  it("4. admin tools are unaffected", () => {
    const paths = navPaths(adminNav());
    expect(paths).toContain("/admin/omada");
    expect(paths).not.toContain("/app/monitor");
  });
});

describe("monitoring list composition", () => {
  const owned = [{ code: "AAAA1111", productName: "6 Hours" }];

  it("5. a manually added voucher joins the list", () => {
    const records: MonitorRecord[] = [{ code: "bbbb2222", source: "manual", monitoring: true }];
    expect(monitoringList([], records).map((v) => v.code)).toEqual(["BBBB2222"]);
  });

  it("6. several vouchers can be monitored at once", () => {
    const records: MonitorRecord[] = [{ code: "BBBB2222", source: "manual", monitoring: true }];
    expect(monitoringList(owned, records).map((v) => v.code)).toEqual(["AAAA1111", "BBBB2222"]);
  });

  it("7/22. a purchased voucher appears exactly once, however often the purchase replays", () => {
    const twice = [...owned, { code: "AAAA1111", productName: "6 Hours" }];
    const records: MonitorRecord[] = [
      { code: "AAAA1111", source: "purchase", monitoring: true },
      { code: "AAAA1111", source: "purchase", monitoring: true },
    ];
    expect(monitoringList(twice, records).map((v) => v.code)).toEqual(["AAAA1111"]);
  });

  it("8/9. do-not-monitor hides only that customer's entry and never the voucher", () => {
    const records: MonitorRecord[] = [{ code: "AAAA1111", source: "purchase", monitoring: false }];
    expect(monitoringList(owned, records)).toEqual([]);
    // The owned code itself is untouched input data.
    expect(owned[0]!.code).toBe("AAAA1111");
    // Another customer, with no such record, still monitors it.
    expect(monitoringList(owned, []).map((v) => v.code)).toEqual(["AAAA1111"]);
  });
});

describe("card translation from Omada rows", () => {
  it("10. UNUSED shows the configured time and consumable data", () => {
    const card = toMonitorCard("ABCD1234", unusedRow)!;
    expect(card.statusLabel).toBe("UNUSED");
    expect(card.time).toBe("7h");
    expect(card.consumableData).toBe("3.0 GB");
    expect(card.pausable).toBe(false);
    expect(card.masked).toBe("••••1234");
  });

  it("labels a usage-based duration as pausable", () => {
    const card = toMonitorCard("ABCD1234", { ...unusedRow, durationType: 1 })!;
    expect(card.pausable).toBe(true);
  });

  it("11. IN-USE shows running time, remaining time, data used and data left", () => {
    const card = toMonitorCard("EFGH5678", inUseRow)!;
    expect(card.statusLabel).toBe("IN-USE");
    expect(card.runningTime).toBe("1h 24m");
    expect(card.remainingTime).toBe("6h 36m");
    expect(card.dataUsed).toBe("1.2 GB");
    expect(card.dataLeft).toBe("1.8 GB");
  });

  it("12. EXPIRED shows the same fields plus a truthful reason", () => {
    const card = toMonitorCard("EFGH5678", {
      ...inUseRow,
      status: 2,
      timeLeftSec: 0,
      trafficUnused: 512 * MB,
    })!;
    expect(card.statusLabel).toBe("EXPIRED");
    expect(card.runningTime).toBe("1h 24m");
    expect(card.dataUsed).toBe("1.2 GB");
    expect(card.expiredReason).toBe("Expired because the time limit was reached");
  });

  it("12b. a data-exhausted voucher reports the data limit", () => {
    expect(expiryReason({ ...inUseRow, status: 2, trafficUnused: 0 }, null)).toBe(
      "Expired because the data limit was reached",
    );
  });

  it("12c. an indistinguishable expiry stays honest", () => {
    expect(expiryReason({ status: 2, timeLeftSec: 60 }, null)).toBe("Expired according to Omada");
  });

  it("13. no time limit displays No limit", () => {
    const card = toMonitorCard("EFGH5678", { ...inUseRow, duration: 0 })!;
    expect(card.remainingTime).toBe("No limit");
    expect(toMonitorCard("EFGH5678", { ...inUseRow, duration: 0, status: 0 })!.time).toBe(
      "Unlimited",
    );
  });

  it("14. no traffic limit displays No limit / Unlimited", () => {
    const noCap = { ...inUseRow, trafficLimitEnable: false, trafficLimit: 0 };
    expect(toMonitorCard("EFGH5678", noCap)!.dataLeft).toBe("No limit");
    expect(toMonitorCard("EFGH5678", { ...noCap, status: 0 })!.consumableData).toBe("Unlimited");
  });

  it("15. state follows Omada, so a transition changes the card", () => {
    expect(toMonitorCard("X", { ...unusedRow })!.statusLabel).toBe("UNUSED");
    expect(toMonitorCard("X", { ...unusedRow, status: 1 })!.statusLabel).toBe("IN-USE");
    expect(toMonitorCard("X", { ...unusedRow, status: 2 })!.statusLabel).toBe("EXPIRED");
  });

  it("16. an unreadable status is refused rather than invented", () => {
    expect(toMonitorCard("X", { code: "X", status: "banana" })).toBeNull();
  });

  it("formats durations compactly", () => {
    expect(compactDuration(0)).toBe("0m");
    expect(compactDuration(3600)).toBe("1h");
    expect(compactDuration(90000)).toBe("1d 1h");
  });
});

describe("local user monitoring", () => {
  const spec = {
    paths: {
      "/openapi/v1/{omadacId}/sites/{siteId}/hotspot/local-users": { get: {} },
    },
  };

  it("17/18. a verified account shows its real expiry and remaining data", () => {
    const view = toLocalUserView({
      name: "juan",
      expirationTime: 1_760_000_000_000,
      trafficLimitEnable: true,
      trafficLimit: 2048,
      trafficUnused: 1024 * MB,
    })!;
    expect(view.username).toBe("juan");
    expect(view.dataRemaining).toBe("1.0 GB");
    expect(view.expiresAt).not.toBeNull();
  });

  it("18b. an uncapped account reads Unlimited", () => {
    expect(toLocalUserView({ name: "juan", trafficLimit: 0 })!.dataRemaining).toBe("Unlimited");
  });

  it("19. the option is only offered when the controller publishes local users", () => {
    expect(localUserPath(spec)).toContain("hotspot/local-users");
    expect(localUserPath({ paths: { "/hotspot/voucher-groups": { get: {} } } })).toBeNull();
    expect(localUserPath(null)).toBeNull();
  });
});
