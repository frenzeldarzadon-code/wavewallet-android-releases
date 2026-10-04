import { describe, expect, it } from "vitest";
import { rangedSales, type AttributedSale, type SaleCode } from "@/lib/sales-attribution";
import { resolveRange } from "@/lib/reports";

const sale = (id: string, at: string, gen: string, role: string, scope: "own" | "network", qty = 1, amt = 20): AttributedSale => ({
  sale_id: id, occurred_at: at, generator_id: gen, generator_name: gen, generator_role: role,
  quantity: qty, sale_amount: amt, scope,
});
const sep = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-09-30T23:59:59Z") };
const oct = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-31T23:59:59Z") };

describe("projected vs actual sales by range", () => {
  it("A) sold and used in the same month → both", () => {
    const r = rangedSales([sale("s1", "2026-10-02T10:00:00Z", "a", "admin", "own")],
      [{ sale_id: "s1", code: "X", first_used_at: null }], { X: "in_use" }, { X: "2026-10-03T10:00:00Z" }, oct);
    expect(r.projected.own.amount).toBe(20);
    expect(r.actual.own.amount).toBe(20);
  });
  it("B) sold Sept 28, used Oct 3 → Sept projected only, Oct actual only", () => {
    const rows = [sale("s1", "2026-09-28T10:00:00Z", "a", "admin", "own")];
    const codes: SaleCode[] = [{ sale_id: "s1", code: "X", first_used_at: "2026-10-03T08:00:00Z" }];
    const st = { X: "expired" as const };
    const s = rangedSales(rows, codes, st, {}, sep);
    const o = rangedSales(rows, codes, st, {}, oct);
    expect(s.projected.own.amount).toBe(20);
    expect(s.actual.own.amount).toBe(0);
    expect(o.projected.own.amount).toBe(0);
    expect(o.actual.own.amount).toBe(20);
  });
  it("C) sold but unused → projected only", () => {
    const r = rangedSales([sale("s1", "2026-10-02T10:00:00Z", "a", "admin", "own", 5, 100)],
      ["A", "B", "C", "D", "E"].map((code) => ({ sale_id: "s1", code, first_used_at: null })),
      { A: "unused" }, {}, oct);
    expect(r.projected.own).toMatchObject({ amount: 100, vouchers: 5 });
    expect(r.actual.own.amount).toBe(0);
  });
  it("D/E) generator attribution and scope are preserved; network never becomes own", () => {
    const rows = [
      sale("s1", "2026-10-02T00:00:00Z", "admin", "admin", "own"),
      sale("s2", "2026-10-02T00:00:00Z", "res", "reseller", "network"),
      sale("s3", "2026-10-02T00:00:00Z", "sub", "subreseller", "network"),
    ];
    const codes = rows.map((r) => ({ sale_id: r.sale_id, code: r.sale_id, first_used_at: "2026-10-05T00:00:00Z" }));
    const st = { s1: "in_use", s2: "in_use", s3: "in_use" } as const;
    const r = rangedSales(rows, codes, st, {}, oct);
    expect(r.actual.own.amount).toBe(20);
    expect(r.actual.network.amount).toBe(40);
    expect(r.actual.byGenerator.map((g) => g.id).sort()).toEqual(["res", "sub"]);
    // Subreseller view: the database returns only their own rows.
    const sub = rangedSales([{ ...rows[2], scope: "own" }], [codes[2]], st, {}, oct);
    expect(sub.actual.own.amount).toBe(20);
    expect(sub.actual.network.amount).toBe(0);
  });
  it("F) duplicate rows/codes never double count", () => {
    const row = sale("s1", "2026-10-02T00:00:00Z", "a", "admin", "own", 2, 40);
    const c = { sale_id: "s1", code: "X", first_used_at: "2026-10-03T00:00:00Z" };
    const r = rangedSales([row, row], [c, c], { X: "in_use", Y: "in_use" }, {}, oct);
    expect(r.projected.own.amount).toBe(40);
    expect(r.actual.own).toMatchObject({ amount: 20, vouchers: 1 });
  });
  it("G) custom ranges are inclusive and exact", () => {
    const range = resolveRange("custom", "2026-10-03", "2026-10-03");
    const rows = [sale("s1", "2026-10-03T12:00:00", "a", "admin", "own"), sale("s2", "2026-10-04T12:00:00", "a", "admin", "own")];
    const r = rangedSales(rows, [], {}, {}, range);
    expect(r.projected.own.sales).toBe(1);
  });
});
