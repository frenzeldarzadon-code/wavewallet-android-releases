import { describe, expect, it } from "vitest";
import { chargedExpenses, expensePeriodTotals, expensesInRange, type ExpenseRow } from "@/lib/expenses";
import { resolveRange } from "@/lib/reports";
import { rangedSales } from "@/lib/sales-attribution";
import { adminNetEarnings } from "@/lib/role-earnings";

const now = new Date("2026-10-04T12:00:00+08:00");
const e = (id: string, spent: string, amount: number, extra: Record<string, unknown> = {}) =>
  ({ id, spent_at: spent, amount, ...extra }) as unknown as ExpenseRow;

describe("only charged expenses reduce reports", () => {
  it("1) future-dated expense does not reduce today", () => {
    const t = expensePeriodTotals([e("a", "2026-10-04T09:00:00+08:00", 10), e("b", "2026-10-05T09:00:00+08:00", 99)], now);
    expect(t.total).toBe(10);
  });
  it("2) future recurring occurrence not yet charged → ₱0 now", () => {
    const rows = [e("tpl", "2026-09-10T09:00:00+08:00", 50, { recurring: true }), e("occ", "2026-10-10T09:00:00+08:00", 50, { recurrence_source_id: "tpl" })];
    expect(chargedExpenses(rows, now).map((r) => r.id)).toEqual(["tpl"]);
    expect(expensePeriodTotals(rows, now).total).toBe(50);
  });
  it("3) recurring occurrence charged in the period is deducted once", () => {
    const later = new Date("2026-10-11T00:00:00+08:00");
    const rows = [e("tpl", "2026-09-10T09:00:00+08:00", 50, { recurring: true }), e("occ", "2026-10-10T09:00:00+08:00", 50, { recurrence_source_id: "tpl" })];
    const oct = { start: new Date("2026-10-01T00:00:00+08:00"), end: new Date("2026-10-31T23:59:59+08:00") };
    expect(expensesInRange(rows, oct, later).map((r) => r.id)).toEqual(["occ"]);
  });
  it("4) charged outside the period is excluded", () => {
    const sep = { start: new Date("2026-09-01T00:00:00+08:00"), end: new Date("2026-09-30T23:59:59+08:00") };
    expect(expensesInRange([e("x", "2026-10-02T09:00:00+08:00", 5)], sep, now)).toHaveLength(0);
  });
  it("5) custom range: only charged rows inside, never future even if range ends later", () => {
    const r = resolveRange("custom", "2026-10-01", "2026-10-31");
    const rows = [e("in", "2026-10-02T09:00:00", 5), e("future", "2026-10-20T09:00:00", 7), e("out", "2026-09-29T09:00:00", 3)];
    expect(expensesInRange(rows, r, now).map((x) => x.id)).toEqual(["in"]);
  });
  it("6) sales still use sale date (projected) and first-use date (actual)", () => {
    const rows = [{ sale_id: "s", occurred_at: "2026-09-28T10:00:00Z", generator_id: "a", generator_name: "a", generator_role: "admin", quantity: 1, sale_amount: 20, scope: "own" as const }];
    const oct = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-31T23:59:59Z") };
    const r = rangedSales(rows, [{ sale_id: "s", code: "X", first_used_at: "2026-10-03T00:00:00Z" }], { X: "expired" }, {}, oct);
    expect(r.projected.own.amount).toBe(0);
    expect(r.actual.own.amount).toBe(20);
  });
  it("7) earnings rows untouched; only the expense side drops future rows", () => {
    const net = adminNetEarnings([], [e("f", "2999-01-01T00:00:00Z", 100)]);
    expect(net.expenses.total).toBe(0);
    expect(net.earnings.total).toBe(0);
  });
});
