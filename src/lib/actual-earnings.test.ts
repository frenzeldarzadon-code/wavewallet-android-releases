import { describe, expect, it } from "vitest";
import { actualPeriodTotals, type SaleUsage } from "@/lib/actual-earnings";
import { periodTotals, type EarningRow } from "@/lib/earnings";

const now = new Date().toISOString();
function row(id: string, sale: string, amount: number, type: EarningRow["earning_type"] = "admin_shop_margin"): EarningRow {
  return {
    id, occurred_at: now, ecosystem_id: "e", earning_type: type, recipient_id: "a",
    recipient_name: null, counterparty_id: null, counterparty_name: null, product_name: null,
    quantity: 5, gross_amount: amount, basis_amount: amount, rate_percent: 0,
    earning_amount: amount, status: "settled", tx_id: null, sale_id: sale,
  };
}
const codes = ["A", "B", "C", "D", "E"];

describe("actual earnings", () => {
  it("A) all unused → actual 0, projected unchanged", () => {
    const rows = [row("1", "s1", 50)];
    const sales = new Map<string, SaleUsage>([["s1", { buyerRole: "reseller", codes }]]);
    const st = Object.fromEntries(codes.map((c) => [c, "unused" as const]));
    expect(actualPeriodTotals(rows, sales, st).total).toBe(0);
    expect(periodTotals(rows).total).toBe(50);
  });
  it("B) 2 of 5 used → 2/5 of the same earning", () => {
    const rows = [row("1", "s1", 50)];
    const sales = new Map<string, SaleUsage>([["s1", { buyerRole: "admin", codes }]]);
    const st = { A: "in_use", B: "expired", C: "unused", D: "unused", E: null } as const;
    expect(actualPeriodTotals(rows, sales, st).total).toBe(20);
  });
  it("C) customer purchases and unknown sales are excluded", () => {
    const rows = [row("1", "s1", 50), row("2", "s2", 30), row("3", "retail", 10)];
    const sales = new Map<string, SaleUsage>([
      ["s1", { buyerRole: "subreseller", codes: ["A"] }],
      ["s2", { buyerRole: "customer", codes: ["B"] }],
    ]);
    const st = { A: "in_use", B: "in_use" } as const;
    expect(actualPeriodTotals(rows, sales, st).total).toBe(50);
  });
  it("D) cashback rows are scaled, never added twice; reversed ignored", () => {
    const rows = [row("1", "s1", 4, "sale_cashback"), { ...row("2", "s1", 9, "sale_cashback"), status: "reversed" as const }];
    const sales = new Map<string, SaleUsage>([["s1", { buyerRole: "reseller", codes: ["A"] }]]);
    expect(actualPeriodTotals(rows, sales, { A: "in_use" }).total).toBe(4);
  });
});

import { actualNetPeriodTotals, signedPeso } from "@/lib/actual-earnings";
import { expensePeriodTotals } from "@/lib/expenses";
import { subtractPeriods } from "@/lib/earnings";

describe("actual net of expenses", () => {
  const exp = (amount: number, at = now) =>
    ({ id: "x", spent_at: at, amount } as unknown as Parameters<typeof expensePeriodTotals>[0][number]);
  it("C2) ₱50 used earnings − ₱10 expenses = ₱40, expense deducted once", () => {
    const rows = [row("1", "s1", 50)];
    const sales = new Map<string, SaleUsage>([["s1", { buyerRole: "admin", codes }]]);
    const st = Object.fromEntries(codes.map((c) => [c, "in_use" as const]));
    const e = expensePeriodTotals([exp(10)]);
    expect(actualNetPeriodTotals(rows, sales, st, undefined, e).total).toBe(40);
  });
  it("F) the same period buckets apply to both metrics", () => {
    const old = new Date(Date.now() - 400 * 864e5).toISOString();
    const rows = [row("1", "s1", 50), { ...row("2", "s2", 30), occurred_at: old }];
    const sales = new Map<string, SaleUsage>([
      ["s1", { buyerRole: "admin", codes: ["A"] }],
      ["s2", { buyerRole: "admin", codes: ["B"] }],
    ]);
    const e = expensePeriodTotals([exp(5), exp(7, old)]);
    const a = actualNetPeriodTotals(rows, sales, { A: "in_use", B: "in_use" }, undefined, e);
    const p = subtractPeriods(periodTotals(rows), e);
    expect(a).toEqual(p); // everything used → identical in every period
    expect(a.today).toBe(45);
  });
  it("G) Actual never exceeds Projected on the same basis, even with losses", () => {
    const rows = [row("1", "s1", 100)];
    const sales = new Map<string, SaleUsage>([["s1", { buyerRole: "reseller", codes }]]);
    const st = { A: "in_use", B: "unused", C: "unused", D: "unused", E: "unused" } as const;
    const e = expensePeriodTotals([exp(500)]);
    const a = actualNetPeriodTotals(rows, sales, st, undefined, e).total; // 20 − 500
    const p = subtractPeriods(periodTotals(rows), e).total; // 100 − 500
    expect(a).toBe(-480);
    expect(p).toBe(-400);
    expect(a).toBeLessThanOrEqual(p);
    expect(signedPeso(a)).toBe("−₱480.00");
    expect(signedPeso(p)).toBe("−₱400.00");
  });
});
