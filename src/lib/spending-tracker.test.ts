import { describe, expect, it } from "vitest";
import {
  automaticEntries,
  categoryHighlights,
  categoryTotals,
  resolvePeriod,
  summarize,
  timeBuckets,
  validateManualEntry,
  type AutoRow,
  type SpendingEntry,
} from "@/lib/spending-tracker";

const entry = (over: Partial<SpendingEntry>): SpendingEntry => ({
  id: crypto.randomUUID(),
  kind: "income",
  occurredAt: "2026-08-10T02:00:00.000Z",
  description: "Sale",
  amount: 10,
  source: "automatic",
  categoryKey: "direct",
  categoryName: "Direct sales",
  memberId: null,
  memberName: null,
  notes: null,
  editable: false,
  ...over,
});

describe("Spending Tracker period filter", () => {
  it("resolves a specific month", () => {
    const p = resolvePeriod({ mode: "month", month: "2026-08" });
    expect(p.from.getDate()).toBe(1);
    expect(p.to.getMonth()).toBe(7);
    expect(p.to.getDate()).toBe(31);
    expect(p.label).toBe("August 2026");
  });

  it("resolves a single date", () => {
    const p = resolvePeriod({ mode: "day", day: "2026-08-15" });
    expect(p.from.getHours()).toBe(0);
    expect(p.to.getHours()).toBe(23);
    expect(p.from.getDate()).toBe(15);
  });

  it("resolves and repairs a custom range", () => {
    const p = resolvePeriod({ mode: "range", from: "2026-08-20", to: "2026-08-01" });
    expect(p.from.getDate()).toBe(1);
    expect(p.to.getDate()).toBe(20);
  });
});

describe("Spending Tracker totals", () => {
  it("balances income minus expense, keeping a loss negative", () => {
    const rows = [
      entry({ amount: 100 }),
      entry({ kind: "expense", amount: 250, categoryKey: "admin_purchases" }),
    ];
    expect(summarize(rows)).toEqual({ income: 100, expense: 250, balance: -150 });
  });

  it("records a 100% admin discount as income with a zero purchase expense", () => {
    // ₱10 original, 100% off, paid ₱0: discount income ₱10, purchase expense 0.
    const rows = [
      entry({ amount: 10, categoryKey: "admin_discount", categoryName: "Admin Discount" }),
    ];
    const s = summarize(rows);
    expect(s.income).toBe(10);
    expect(s.expense).toBe(0);
    expect(categoryTotals(rows, "expense")).toHaveLength(0);
  });

  it("records a half-price admin purchase as paid amount plus discount income", () => {
    // ₱100 original, 50% off, paid ₱50.
    const rows = [
      entry({ amount: 50, categoryKey: "admin_discount", categoryName: "Admin Discount" }),
      entry({
        kind: "expense",
        amount: 50,
        categoryKey: "admin_purchases",
        categoryName: "Admin Purchases",
      }),
    ];
    expect(summarize(rows)).toEqual({ income: 50, expense: 50, balance: 0 });
  });

  it("never counts the pre-discount value as an expense", () => {
    const rows = [
      entry({
        kind: "expense",
        amount: 0.0,
        categoryKey: "admin_purchases",
        categoryName: "Admin Purchases",
      }),
    ];
    expect(summarize(rows).expense).toBe(0);
  });
});

describe("Spending Tracker category attribution", () => {
  const rows = [
    // Reseller A: own sale plus a downline sale — both admin-earned cashback.
    entry({ amount: 30, categoryKey: "reseller:a", categoryName: "Reseller A", memberId: "a" }),
    entry({ amount: 45, categoryKey: "reseller:a", categoryName: "Reseller A", memberId: "a" }),
    entry({ amount: 20, categoryKey: "reseller:b", categoryName: "Reseller B", memberId: "b" }),
    entry({ amount: 5, categoryKey: "direct", categoryName: "Direct sales" }),
    entry({ kind: "expense", amount: 60, categoryKey: "admin_purchases", categoryName: "Admin Purchases" }),
    entry({
      kind: "expense",
      amount: 90,
      source: "manual",
      editable: true,
      categoryKey: "cat:1",
      categoryName: "Internet",
    }),
  ];

  it("rolls every downline's admin cashback into the top-level reseller category", () => {
    const income = categoryTotals(rows, "income");
    expect(income[0]).toMatchObject({ key: "reseller:a", total: 75 });
    expect(income.find((c) => c.key === "reseller:b")?.total).toBe(20);
    expect(income.reduce((s, c) => s + c.share, 0)).toBeCloseTo(100, 1);
  });

  it("highlights the biggest income and expense category", () => {
    const h = categoryHighlights(rows);
    expect(h.topIncome?.name).toBe("Reseller A");
    expect(h.topExpense?.name).toBe("Internet");
    expect(h.topExpense?.total).toBe(90);
  });

  it("keeps manual and automatic categories side by side", () => {
    const expense = categoryTotals(rows, "expense");
    expect(expense.map((c) => c.automatic)).toEqual([false, true]);
  });
});

describe("Spending Tracker buckets and validation", () => {
  it("buckets a month by day", () => {
    const period = resolvePeriod({ mode: "month", month: "2026-08" });
    const rows = [
      entry({ amount: 10, occurredAt: new Date(2026, 7, 3, 10).toISOString() }),
      entry({ kind: "expense", amount: 4, occurredAt: new Date(2026, 7, 3, 12).toISOString() }),
      entry({ amount: 6, occurredAt: new Date(2026, 7, 9, 12).toISOString() }),
    ];
    const buckets = timeBuckets(rows, period);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toEqual({ label: "3", income: 10, expense: 4 });
  });

  it("rejects empty or non-positive manual entries", () => {
    expect(validateManualEntry({ amount: "", description: "x" })).toBeTruthy();
    expect(validateManualEntry({ amount: 5, description: "  " })).toBeTruthy();
    expect(validateManualEntry({ amount: 5, description: "Internet" })).toBeNull();
  });
});
