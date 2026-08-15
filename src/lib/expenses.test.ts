import { describe, expect, it } from "vitest";
import {
  LOVABLE_CREDITS_CATEGORY,
  expensePeriodTotals,
  findLikelyDuplicates,
  lovablePurchaseDescription,
  totalExpenses,
  totalLovableCredits,
  validateLovablePurchase,
  type ExpenseRow,
} from "@/lib/expenses";

const row = (over: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id: crypto.randomUUID(),
  scope: "platform",
  ecosystem_id: null,
  amount: 1000,
  description: "Lovable credit purchase",
  category: LOVABLE_CREDITS_CATEGORY,
  provider: "Lovable",
  provider_reference: null,
  currency: "PHP",
  created_by: "super",
  created_by_name: "Super Admin",
  spent_at: "2026-08-15T02:00:00.000Z",
  created_at: "2026-08-15T02:00:00.000Z",
  ...over,
});

describe("Lovable credit purchase expenses", () => {
  it("rejects missing or non-positive PHP amounts, never estimating", () => {
    expect(validateLovablePurchase({ amountPhp: "" })).toBeTruthy();
    expect(validateLovablePurchase({ amountPhp: 0 })).toBeTruthy();
    expect(validateLovablePurchase({ amountPhp: -50 })).toBeTruthy();
    expect(validateLovablePurchase({ amountPhp: "1250.75" })).toBeNull();
  });

  it("rejects an invalid purchase date", () => {
    expect(
      validateLovablePurchase({ amountPhp: 100, purchasedAt: new Date("nope") }),
    ).toBeTruthy();
  });

  it("names the provider and reference in the stored description", () => {
    const d = lovablePurchaseDescription({
      amountPhp: 500,
      purchasedAt: new Date("2026-08-15T00:00:00Z"),
      reference: "INV-42",
      note: "monthly top-up",
    });
    expect(d).toContain("Lovable credit purchase");
    expect(d).toContain("INV-42");
    expect(d).toContain("monthly top-up");
  });

  it("flags an existing entry with the same provider reference", () => {
    const rows = [row({ provider_reference: "INV-42", amount: 900 })];
    const dupes = findLikelyDuplicates(rows, {
      amountPhp: 123,
      purchasedAt: new Date("2026-01-01T00:00:00Z"),
      reference: "inv-42",
    });
    expect(dupes).toHaveLength(1);
  });

  it("flags a same-day same-amount entry when no reference exists", () => {
    const rows = [row({ amount: 1000, spent_at: "2026-08-15T09:00:00.000Z" })];
    expect(
      findLikelyDuplicates(rows, {
        amountPhp: 1000,
        purchasedAt: new Date("2026-08-15T23:00:00Z"),
      }),
    ).toHaveLength(1);
    expect(
      findLikelyDuplicates(rows, {
        amountPhp: 1000,
        purchasedAt: new Date("2026-08-16T00:00:00Z"),
      }),
    ).toHaveLength(0);
    expect(
      findLikelyDuplicates(rows, {
        amountPhp: 999,
        purchasedAt: new Date("2026-08-15T00:00:00Z"),
      }),
    ).toHaveLength(0);
  });

  it("ignores unrelated platform expenses when matching duplicates", () => {
    const rows = [row({ category: "Hosting", provider: null })];
    expect(
      findLikelyDuplicates(rows, {
        amountPhp: 1000,
        purchasedAt: new Date("2026-08-15T00:00:00Z"),
      }),
    ).toHaveLength(0);
  });

  it("counts Lovable credits inside the same platform expense totals", () => {
    const rows = [
      row({ amount: 1500.5 }),
      row({ amount: 200, category: "Hosting", provider: null }),
    ];
    expect(totalLovableCredits(rows)).toBe(1500.5);
    expect(totalExpenses(rows)).toBeCloseTo(1700.5, 2);
    expect(expensePeriodTotals(rows).year).toBeGreaterThan(0);
  });
});
