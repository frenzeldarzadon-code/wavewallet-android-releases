import { describe, expect, it } from "vitest";
import {
  downlineTotals,
  validateSubresellerTransfer,
  type SubresellerRow,
} from "@/lib/subresellers";

const row = (over: Partial<SubresellerRow> = {}): SubresellerRow => ({
  id: "s1",
  full_name: "Sub One",
  handle: null,
  avatar_path: null,
  phone: "0917",
  masked_email: "s***@x.com",
  status: "active",
  balance: 100,
  joined_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("downlineTotals", () => {
  it("counts subresellers and sums balances", () => {
    expect(downlineTotals([row(), row({ id: "s2", balance: 50, status: "suspended" })])).toEqual({
      count: 2,
      balance: 150,
      active: 1,
    });
  });
  it("handles an empty downline", () => {
    expect(downlineTotals([])).toEqual({ count: 0, balance: 0, active: 0 });
  });
});

describe("validateSubresellerTransfer", () => {
  const base = { target: row(), amount: 50, balance: 100 };
  it("accepts a valid transfer", () => {
    expect(validateSubresellerTransfer(base)).toBeNull();
  });
  it("requires a target", () => {
    expect(validateSubresellerTransfer({ ...base, target: null })).toMatch(/Pick a subreseller/);
  });
  it("rejects suspended subresellers", () => {
    expect(
      validateSubresellerTransfer({ ...base, target: row({ status: "suspended" }) }),
    ).toMatch(/suspended/);
  });
  it("rejects non-positive amounts", () => {
    expect(validateSubresellerTransfer({ ...base, amount: 0 })).toMatch(/positive/);
  });
  it("rejects more than the reseller holds", () => {
    expect(validateSubresellerTransfer({ ...base, amount: 500 })).toMatch(/exceeds/);
  });
});
