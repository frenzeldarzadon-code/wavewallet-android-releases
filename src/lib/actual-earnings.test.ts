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
