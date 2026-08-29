import { describe, expect, it } from "vitest";
import { codeStatusLabel, groupSaleCodes, statusSummary } from "@/lib/voucher-transactions";
import { sourceLabelForRole, cashbackSourceLabel } from "@/lib/cashback-source";

describe("voucher transaction grouping", () => {
  it("keeps one purchase as one transaction with all its codes", () => {
    const map = groupSaleCodes([
      { code: "B2", sale_id: "s1" },
      { code: "A1", sale_id: "s1" },
      { code: "C3", sale_id: "s2" },
      { code: "X9", sale_id: null },
    ]);
    expect(map.get("s1")).toEqual(["A1", "B2"]);
    expect(map.get("s2")).toEqual(["C3"]);
    expect(map.size).toBe(2);
  });

  it("never mixes vouchers between two transactions", () => {
    const map = groupSaleCodes([
      { code: "A", sale_id: "s1" },
      { code: "B", sale_id: "s2" },
    ]);
    expect(map.get("s1")).not.toContain("B");
  });

  it("summarises mixed Omada statuses using Omada's own labels", () => {
    const codes = ["A", "B", "C", "D", "E"];
    const summary = statusSummary(codes, {
      A: "in_use",
      B: "in_use",
      C: "unused",
      D: "unused",
      E: "expired",
    });
    expect(summary).toBe("2 Used · 2 Unused · 1 Expired");
  });

  it("reports codes Omada could not answer for separately", () => {
    expect(statusSummary(["A", "B"], { A: "unused" })).toBe("1 Unused · 1 status unavailable");
    expect(codeStatusLabel("b", { B: "expired" })).toBe("Expired");
    expect(codeStatusLabel("z", {})).toBeNull();
  });

  it("handles a single-voucher transaction unchanged", () => {
    expect(statusSummary(["A"], { A: "unused" })).toBe("1 Unused");
  });
});

describe("cashback source", () => {
  it("names the origin from the recorded buyer role", () => {
    expect(sourceLabelForRole("customer")).toBe("Customer Purchase");
    expect(sourceLabelForRole("reseller")).toBe("Reseller Purchase");
    expect(sourceLabelForRole("subreseller")).toBe("Subreseller Purchase");
  });

  it("never guesses when the origin is unknown", () => {
    expect(sourceLabelForRole(null)).toBeNull();
    expect(cashbackSourceLabel(null, {})).toBeNull();
    expect(cashbackSourceLabel("s1", {})).toBeNull();
    expect(cashbackSourceLabel("s1", { s1: "customer" })).toBe("Customer Purchase");
  });
});
