import { describe, expect, it } from "vitest";
import {
  activeMembers,
  resellersOf,
  shopRoleOf,
  toShopMember,
  type ShopMember,
} from "@/lib/shop-members";

const member = (over: Partial<ShopMember>): ShopMember => ({
  id: "u",
  full_name: "Member",
  email: "m@example.com",
  phone: "",
  handle: null,
  avatar_path: null,
  joined_at: "2026-01-01T00:00:00Z",
  status: "active",
  membership_state: "active",
  role: "customer",
  reseller_id: null,
  reseller_discount_percent: 0,
  reseller_commission_percent: null,
  sale_commission_percent: null,
  deleted_at: null,
  ...over,
});

/**
 * Helen is an active reseller in two shops. Each shop lists its own members,
 * and a shop she never joined must not know she exists.
 */
const helenInSagada = member({ id: "helen", full_name: "Helen Torio", role: "reseller", sale_commission_percent: 30 });
const helenInLenas = member({ id: "helen", full_name: "Helen Torio", role: "reseller", sale_commission_percent: 30 });
const otherShopRows: ShopMember[] = [member({ id: "someone-else" })];

describe("shop member lists", () => {
  it("shows the same person as a reseller in every shop she is active in", () => {
    expect(resellersOf([helenInSagada]).map((m) => m.id)).toEqual(["helen"]);
    expect(resellersOf([helenInLenas]).map((m) => m.id)).toEqual(["helen"]);
  });

  it("does not leak her into a shop she has no membership in", () => {
    expect(resellersOf(otherShopRows)).toEqual([]);
    expect(shopRoleOf(otherShopRows, "helen")).toBeNull();
  });

  it("reads the role from the shop membership, not a global role", () => {
    const asCustomer = { ...helenInLenas, role: "customer" as const };
    expect(shopRoleOf([helenInSagada], "helen")).toBe("reseller");
    expect(shopRoleOf([asCustomer], "helen")).toBe("customer");
    expect(resellersOf([asCustomer])).toEqual([]);
  });

  it("keeps per-shop reseller data separate", () => {
    const lenas = { ...helenInLenas, sale_commission_percent: 25, reseller_id: "parent-a" };
    expect(resellersOf([helenInSagada])[0]?.sale_commission_percent).toBe(30);
    expect(resellersOf([lenas])[0]?.sale_commission_percent).toBe(25);
    expect(resellersOf([lenas])[0]?.reseller_id).toBe("parent-a");
  });

  it("hides removed, rejected and deleted memberships", () => {
    const rows = [
      helenInLenas,
      member({ id: "removed", membership_state: "removed", role: "reseller" }),
      member({ id: "rejected", membership_state: "rejected", role: "reseller" }),
      member({ id: "deleted", deleted_at: "2026-02-01T00:00:00Z", role: "reseller" }),
    ];
    expect(activeMembers(rows).map((m) => m.id)).toEqual(["helen"]);
    expect(resellersOf(rows).map((m) => m.id)).toEqual(["helen"]);
  });

  it("keeps a suspended member visible but out of the selling network", () => {
    const suspended = member({ id: "s", role: "reseller", status: "suspended" });
    expect(activeMembers([suspended]).map((m) => m.id)).toEqual(["s"]);
    expect(resellersOf([suspended])).toEqual([]);
  });

  it("normalises numeric strings coming back from the database", () => {
    const row = toShopMember({
      id: "helen",
      full_name: "Helen Torio",
      email: "h@example.com",
      phone: "",
      handle: "helentorio1",
      avatar_path: null,
      joined_at: "2026-01-01T00:00:00Z",
      status: "active",
      membership_state: "active",
      role: "reseller",
      reseller_id: null,
      reseller_discount_percent: "30",
      reseller_commission_percent: null,
      sale_commission_percent: "30",
      deleted_at: null,
    });
    expect(row.reseller_discount_percent).toBe(30);
    expect(row.sale_commission_percent).toBe(30);
    expect(row.reseller_commission_percent).toBeNull();
  });
});
