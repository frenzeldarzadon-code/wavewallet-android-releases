import { describe, expect, it } from "vitest";
import { isLegacyCustomerPath, universeDestinationFor } from "../customer-portal";
import {
  canMonitor,
  mergeCustomerShops,
  monitorableShops,
  relatedShopIds,
  rewardShops,
} from "../customer-shops";
import { homeFor, shopHomeFor, landingForMemberships } from "../session";

describe("legacy customer portal → Universe", () => {
  it("recognises only the old customer console", () => {
    expect(isLegacyCustomerPath("/app")).toBe(true);
    expect(isLegacyCustomerPath("/app/monitor")).toBe(true);
    expect(isLegacyCustomerPath("/admin")).toBe(false);
    expect(isLegacyCustomerPath("/reseller/shop")).toBe(false);
    expect(isLegacyCustomerPath("/application")).toBe(false);
  });

  it("maps wallet-style pages to the Universe wallet", () => {
    for (const p of ["/app", "/app/", "/app/money", "/app/history", "/app/transfer"]) {
      expect(universeDestinationFor(p)).toEqual({ to: "/universe/wallet" });
    }
  });

  it("keeps the shop and voucher code when redirecting monitoring", () => {
    expect(universeDestinationFor("/app/monitor", { shopId: "s1", code: "ABC" })).toEqual({
      to: "/universe/monitor/$shopId",
      params: { shopId: "s1" },
      search: { code: "ABC" },
    });
    expect(universeDestinationFor("/app/monitor")).toEqual({ to: "/universe/monitor" });
  });

  it("sends shopping to the public storefront and the rest to Universe", () => {
    expect(universeDestinationFor("/app/shop", { shopSlug: "guesang" })).toEqual({
      to: "/shop/$slug",
      params: { slug: "guesang" },
    });
    expect(universeDestinationFor("/app/shop")).toEqual({ to: "/universe/shops" });
    expect(universeDestinationFor("/app/rewards", { shopId: "s1" })).toEqual({
      to: "/universe/rewards/$shopId",
      params: { shopId: "s1" },
    });
    expect(universeDestinationFor("/app/profile")).toEqual({ to: "/universe/profile" });
    expect(universeDestinationFor("/app/messages")).toEqual({ to: "/universe/messages" });
    expect(universeDestinationFor("/app/social")).toEqual({ to: "/universe" });
    expect(universeDestinationFor("/app/whatever")).toEqual({ to: "/universe" });
  });

  it("customers land in Universe; managers keep their consoles", () => {
    expect(homeFor("customer")).toBe("/universe");
    expect(shopHomeFor("customer")).toBe("/universe");
    expect(homeFor("admin")).toBe("/admin");
    expect(homeFor("reseller")).toBe("/reseller");
    expect(homeFor("subreseller")).toBe("/reseller");
    expect(homeFor("super_admin")).toBe("/super");
    expect(
      landingForMemberships([{ ecosystemId: "a", role: "customer", isActive: true }]),
    ).toEqual({ to: "/universe", switchTo: null });
  });
});

describe("customer shop entitlements", () => {
  const inputs = {
    memberships: [{ ecosystem_id: "m", role: "customer" }],
    vouchers: [{ ecosystem_id: "b" }, { ecosystem_id: "b" }],
    points: [{ ecosystem_id: "p", balance: "12" }],
    shops: [
      { id: "m", name: "Member Shop", slug: "member" },
      { id: "b", name: "Bought Shop", slug: "bought", logo_path: "x.jpg" },
      { id: "p", name: "Points Shop", slug: "points" },
      { id: "z", name: "Archived", slug: "old", archived_at: "2026-01-01" },
    ],
    controllers: [{ ecosystem_id: "b" }],
  };

  it("collects every related shop id once", () => {
    expect(relatedShopIds(inputs).sort()).toEqual(["b", "m", "p"]);
  });

  it("merges the caller's rows and drops archived shops", () => {
    const list = mergeCustomerShops(inputs);
    expect(list.map((s) => s.id)).toEqual(["b", "m", "p"]);
    const bought = list.find((s) => s.id === "b")!;
    expect(bought).toMatchObject({ ownedVouchers: 2, role: null, controllerConfigured: true, logoPath: "x.jpg" });
    expect(list.find((s) => s.id === "p")).toMatchObject({ points: 12, ownedVouchers: 0, role: null });
  });

  it("monitoring needs membership OR a purchased voucher — never just browsing/points", () => {
    const list = mergeCustomerShops(inputs);
    expect(monitorableShops(list).map((s) => s.id)).toEqual(["b", "m"]);
    expect(canMonitor({ role: null, ownedVouchers: 0 })).toBe(false);
  });

  it("reward shops include points-only shops", () => {
    expect(rewardShops(mergeCustomerShops(inputs)).map((s) => s.id)).toEqual(["b", "m", "p"]);
  });
});
