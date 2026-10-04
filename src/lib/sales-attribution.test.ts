import { describe, expect, it } from "vitest";
import { summariseAttribution, type AttributedSale } from "@/lib/sales-attribution";

const s = (id: string, gen: string, role: string, scope: "own" | "network", amt: number, q = 1): AttributedSale => ({
  sale_id: id, occurred_at: "2026-10-01T00:00:00Z", generator_id: gen, generator_name: gen,
  generator_role: role, quantity: q, sale_amount: amt, scope,
});

describe("sales attribution", () => {
  it("admin view: own vs network, generator kept, no double count", () => {
    const r = summariseAttribution([
      s("a1", "admin", "admin", "own", 100, 5),
      s("r1", "res", "reseller", "network", 50, 2),
      s("x1", "sub", "subreseller", "network", 20, 1),
      s("x1", "sub", "subreseller", "network", 20, 1),
    ]);
    expect(r.own).toEqual({ sales: 1, vouchers: 5, amount: 100 });
    expect(r.network).toEqual({ sales: 2, vouchers: 3, amount: 70 });
    expect(r.combined.amount).toBe(170);
    expect(r.byGenerator.map((g) => g.id)).toEqual(["res", "sub"]);
  });
  it("reseller view: subreseller sale is network, never own (cashback ≠ sale)", () => {
    const r = summariseAttribution([s("r1", "res", "reseller", "own", 50), s("x1", "sub", "subreseller", "network", 20)]);
    expect(r.own.amount).toBe(50);
    expect(r.network.amount).toBe(20);
  });
  it("subreseller view: own only", () => {
    const r = summariseAttribution([s("x1", "sub", "subreseller", "own", 20)]);
    expect(r.own.amount).toBe(20);
    expect(r.network.sales).toBe(0);
  });
});
