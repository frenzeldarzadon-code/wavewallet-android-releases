import { describe, expect, it } from "vitest";
import {
  activeMembership,
  canSwitchTo,
  roleInEcosystem,
  shouldShowSwitcher,
  switchableMemberships,
  type Membership,
} from "@/lib/memberships";

const m = (over: Partial<Membership>): Membership => ({
  ecosystemId: "eco",
  ecosystemName: "Eco",
  ecosystemSlug: "eco",
  role: "customer",
  membershipState: "active",
  status: "active",
  isActive: false,
  ...over,
});

/** The example matrix: Test 1 is a Customer in Lenas and a Subreseller in Sagada Wave. */
const lenas = m({ ecosystemId: "lenas", ecosystemName: "Lenas", role: "customer", isActive: true });
const sagada = m({ ecosystemId: "sagada", ecosystemName: "Sagada Wave", role: "subreseller" });

describe("ecosystem memberships", () => {
  it("keeps one role per ecosystem for the same person", () => {
    const list = [lenas, sagada];
    expect(roleInEcosystem(list, "lenas")).toBe("customer");
    expect(roleInEcosystem(list, "sagada")).toBe("subreseller");
  });

  it("promoting in one ecosystem never changes the other", () => {
    const promoted = [lenas, { ...sagada, role: "reseller" as const }];
    expect(roleInEcosystem(promoted, "sagada")).toBe("reseller");
    expect(roleInEcosystem(promoted, "lenas")).toBe("customer");
  });

  it("only exposes approved, non-suspended memberships to the switcher", () => {
    const list = [
      lenas,
      m({ ecosystemId: "pending", membershipState: "pending" }),
      m({ ecosystemId: "removed", membershipState: "removed" }),
      m({ ecosystemId: "suspended", status: "suspended" }),
    ];
    expect(switchableMemberships(list).map((x) => x.ecosystemId)).toEqual(["lenas"]);
  });

  it("refuses to switch into an ecosystem without an approved membership", () => {
    const list = [lenas, m({ ecosystemId: "pending", membershipState: "pending" })];
    expect(canSwitchTo(list, "lenas")).toBe(true);
    expect(canSwitchTo(list, "pending")).toBe(false);
    expect(canSwitchTo(list, "someone-elses-eco")).toBe(false);
  });

  it("hides the switcher until a second approved membership exists", () => {
    expect(shouldShowSwitcher([lenas])).toBe(false);
    expect(shouldShowSwitcher([lenas, sagada])).toBe(true);
  });

  it("reports exactly one active context", () => {
    expect(activeMembership([lenas, sagada])?.ecosystemId).toBe("lenas");
    expect(activeMembership([{ ...lenas, isActive: false }, sagada])).toBeNull();
  });

  it("has no notion of a role outside a membership", () => {
    expect(roleInEcosystem([lenas, sagada], "unknown-eco")).toBeNull();
  });
});
