import { describe, expect, it } from "vitest";
import {
  coinCostForPoints,
  reconciliationStatusLabel,
  reconciliationTone,
  shopReconciles,
  totals,
  type PointsCostShop,
} from "@/lib/points-cost-reconciliation";

const shop = (over: Partial<PointsCostShop> = {}): PointsCostShop => ({
  ecosystemId: "eco",
  shopName: "Shop A",
  adminId: "admin",
  adminName: "Admin",
  historicalPoints: 125.5,
  chargedPoints: 125.5,
  pendingPoints: 0,
  chargedCoins: 125.5,
  shortfallCoins: 0,
  adminAvailable: 500,
  status: "settled",
  ...over,
});

describe("1 point = 1 coin", () => {
  it("converts exactly, decimals included", () => {
    expect(coinCostForPoints(125.5)).toBe(125.5);
    expect(coinCostForPoints(0.01)).toBe(0.01);
    expect(coinCostForPoints(4846.1)).toBe(4846.1);
  });

  it("never charges for zero or negative points", () => {
    expect(coinCostForPoints(0)).toBe(0);
    expect(coinCostForPoints(-10)).toBe(0);
    expect(coinCostForPoints(Number.NaN)).toBe(0);
  });
});

describe("reconciliation reporting", () => {
  it("a shop reconciles when charged + pending equals the historical total", () => {
    expect(shopReconciles(shop())).toBe(true);
    expect(shopReconciles(shop({ chargedPoints: 100, pendingPoints: 25.5 }))).toBe(true);
    expect(shopReconciles(shop({ chargedPoints: 100, pendingPoints: 0 }))).toBe(false);
  });

  it("sums only shops that actually have historical points", () => {
    const t = totals([
      shop({ historicalPoints: 100, chargedPoints: 100, chargedCoins: 100 }),
      shop({ historicalPoints: 25.5, chargedPoints: 0, pendingPoints: 25.5, chargedCoins: 0 }),
      shop({ historicalPoints: 0, chargedPoints: 0, chargedCoins: 0, status: "nothing_to_charge" }),
    ]);
    expect(t.historicalPoints).toBe(125.5);
    expect(t.chargedCoins).toBe(100);
    expect(t.pendingCoins).toBe(25.5);
    expect(t.shops).toBe(2);
  });

  it("labels every state in plain words", () => {
    expect(reconciliationStatusLabel("settled")).toBe("Fully charged");
    expect(reconciliationStatusLabel("partial")).toBe("Partly charged");
    expect(reconciliationStatusLabel("unresolved_no_admin")).toBe("Unresolved — no shop admin");
    expect(reconciliationStatusLabel("unresolved_insufficient_balance")).toBe(
      "Unresolved — not enough coins",
    );
    expect(reconciliationTone("settled")).toBe("success");
    expect(reconciliationTone("unresolved_no_admin")).toBe("danger");
    expect(reconciliationTone("nothing_to_charge")).toBe("muted");
  });
});
