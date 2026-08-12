import { describe, expect, it } from "vitest";
import { ecosystemCounts, platformMrr, totalAccounts } from "./platform-overview";

/**
 * Regression: the Super Admin ecosystem card used to render demo fixture data,
 * which showed Sagada Wave as "4 customers / 2 resellers". The real ecosystem
 * (3a972878-ff7b-4dfb-8a5b-b681b1c81205) has 1 admin, 1 reseller,
 * 1 subreseller and 2 customers (1 active, 1 suspended).
 */
const sagadaWave = {
  admin_count: 1,
  reseller_count: 1,
  subreseller_count: 1,
  customer_count: 2,
  suspended_customer_count: 1,
  member_count: 5,
  plan_price: 150,
  subscription_state: "active" as const,
  archived_at: null as unknown as string,
};

describe("Super Admin ecosystem counters", () => {
  it("reports Sagada Wave exactly as the database does", () => {
    expect(ecosystemCounts(sagadaWave)).toEqual({
      admins: 1,
      resellers: 1,
      subresellers: 1,
      customers: 2,
      suspendedCustomers: 1,
      activeCustomers: 1,
      members: 5,
    });
  });

  it("never folds subresellers into the reseller count", () => {
    const c = ecosystemCounts({ ...sagadaWave, subreseller_count: 3 });
    expect(c.resellers).toBe(1);
    expect(c.subresellers).toBe(3);
  });

  it("does not double count customers by status", () => {
    const c = ecosystemCounts(sagadaWave);
    expect(c.activeCustomers + c.suspendedCustomers).toBe(c.customers);
  });

  it("clamps a suspended count that exceeds the customer total", () => {
    expect(ecosystemCounts({ ...sagadaWave, suspended_customer_count: 9 })).toMatchObject({
      customers: 2,
      suspendedCustomers: 2,
      activeCustomers: 0,
    });
  });

  it("sums accounts and MRR from live rows only", () => {
    const rows = [sagadaWave, { ...sagadaWave, member_count: 2, subscription_state: "expired" as const }];
    expect(totalAccounts(rows)).toBe(7);
    expect(platformMrr(rows)).toBe(150);
  });

  it("excludes archived ecosystems from MRR", () => {
    expect(platformMrr([{ ...sagadaWave, archived_at: "2026-01-01T00:00:00Z" }])).toBe(0);
  });
});
