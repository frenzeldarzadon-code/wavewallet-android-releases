import { describe, expect, it } from "vitest";
import type { Membership } from "@/lib/memberships";
import {
  dashboardPathFor,
  isManagementRole,
  managedMemberships,
  shopDashboardEntry,
} from "@/lib/shop-dashboard";

const m = (over: Partial<Membership>): Membership => ({
  ecosystemId: "e1",
  ecosystemName: "Shop",
  ecosystemSlug: "shop",
  role: "customer",
  membershipState: "active",
  status: "active",
  isActive: false,
  ...over,
});

describe("shop dashboard entry", () => {
  it("never offers a dashboard to an ordinary customer", () => {
    expect(shopDashboardEntry([m({ role: "customer" }), m({ ecosystemId: "e2", role: "customer" })]))
      .toEqual({ kind: "none" });
    expect(shopDashboardEntry([])).toEqual({ kind: "none" });
  });

  it("opens directly when exactly one shop is managed", () => {
    const list = [m({ role: "customer" }), m({ ecosystemId: "e2", role: "reseller" })];
    const entry = shopDashboardEntry(list);
    expect(entry.kind).toBe("single");
    if (entry.kind === "single") expect(entry.membership.ecosystemId).toBe("e2");
  });

  it("asks which shop when several are managed", () => {
    const entry = shopDashboardEntry([
      m({ ecosystemId: "a", role: "admin" }),
      m({ ecosystemId: "b", role: "subreseller" }),
      m({ ecosystemId: "c", role: "customer" }),
    ]);
    expect(entry.kind).toBe("choose");
    if (entry.kind === "choose") expect(entry.memberships.map((x) => x.ecosystemId)).toEqual(["a", "b"]);
  });

  it("ignores pending, removed and suspended memberships even with a management role", () => {
    expect(
      managedMemberships([
        m({ role: "admin", membershipState: "pending" }),
        m({ ecosystemId: "e2", role: "admin", membershipState: "removed" }),
        m({ ecosystemId: "e3", role: "reseller", status: "suspended" }),
      ]),
    ).toEqual([]);
  });

  it("maps roles onto their existing console", () => {
    expect(isManagementRole("customer")).toBe(false);
    expect(dashboardPathFor("admin")).toBe("/admin");
    expect(dashboardPathFor("reseller")).toBe("/reseller");
    expect(dashboardPathFor("subreseller")).toBe("/reseller");
  });
});
