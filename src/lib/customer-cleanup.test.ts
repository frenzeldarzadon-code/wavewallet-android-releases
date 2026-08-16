import { describe, expect, it } from "vitest";
import { evaluateCustomerDeletion, type DeletionCandidate } from "@/lib/customer-cleanup";

const NOW = new Date("2026-08-12T00:00:00Z");
const OLD = "2026-01-01T00:00:00Z"; // > 3 months before NOW
const RECENT = "2026-07-01T00:00:00Z"; // < 3 months before NOW

const base: DeletionCandidate = {
  role: "customer",
  joinedAt: OLD,
  credits: 0,
  points: 0,
  pointsHeld: 0,
  pendingRedemptions: 0,
};

describe("customer deletion eligibility", () => {
  it("allows an old, empty customer account", () => {
    const v = evaluateCustomerDeletion(base, NOW);
    expect(v.eligible).toBe(true);
    expect(v.blockers).toEqual([]);
    expect(v.reasons.length).toBeGreaterThan(3);
  });

  it("blocks accounts younger than three months", () => {
    const v = evaluateCustomerDeletion({ ...base, joinedAt: RECENT }, NOW);
    expect(v.eligible).toBe(false);
    expect(v.blockers.join(" ")).toContain("less than 3 months old");
  });

  it("blocks customers holding credits", () => {
    const v = evaluateCustomerDeletion({ ...base, credits: 10 }, NOW);
    expect(v.eligible).toBe(false);
    expect(v.blockers.join(" ")).toContain("Coin balance is not zero");
  });

  it("blocks customers holding points", () => {
    expect(evaluateCustomerDeletion({ ...base, points: 5 }, NOW).eligible).toBe(false);
    const held = evaluateCustomerDeletion({ ...base, pointsHeld: 5 }, NOW);
    expect(held.eligible).toBe(false);
    expect(held.blockers.join(" ")).toContain("on hold");
  });

  it("blocks customers with a reward order still waiting", () => {
    const v = evaluateCustomerDeletion({ ...base, pendingRedemptions: 2 }, NOW);
    expect(v.eligible).toBe(false);
    expect(v.blockers.join(" ")).toContain("2 reward orders");
  });

  it("blocks operator roles", () => {
    for (const role of ["reseller", "subreseller", "admin", "super_admin"] as const) {
      const v = evaluateCustomerDeletion({ ...base, role }, NOW);
      expect(v.eligible).toBe(false);
      expect(v.blockers.join(" ")).toContain("plain customer accounts");
    }
  });

  it("blocks an already deleted account", () => {
    const v = evaluateCustomerDeletion({ ...base, deletedAt: OLD }, NOW);
    expect(v.eligible).toBe(false);
  });
});
