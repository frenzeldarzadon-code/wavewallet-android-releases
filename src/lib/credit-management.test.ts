import { describe, expect, it } from "vitest";
import {
  CREDIT_ISSUANCE_ACTION,
  CREDIT_ISSUANCE_MAX,
  ISSUANCE_ENTRY_KIND,
  LEGACY_MANUAL_CREDIT_ACTION,
  filterOrders,
  isCreditIssuance,
  issuanceFormIssue,
  issuanceReason,
  pendingCount,
  previewBalance,
} from "@/lib/credit-management";
import type { CreditPurchaseOrder } from "@/lib/credit-purchases";

const order = (status: string, id = status) =>
  ({ id, status }) as unknown as CreditPurchaseOrder;

describe("pending queue", () => {
  const orders = [
    order("pending", "a"),
    order("pending", "b"),
    order("approved"),
    order("rejected"),
    order("frozen"),
  ];

  it("counts only requests awaiting verification", () => {
    expect(pendingCount(orders)).toBe(2);
    expect(pendingCount([])).toBe(0);
  });

  it("filters by status and keeps everything on 'all'", () => {
    expect(filterOrders(orders, "pending").map((o) => o.id)).toEqual(["a", "b"]);
    expect(filterOrders(orders, "frozen")).toHaveLength(1);
    expect(filterOrders(orders, "all")).toHaveLength(5);
  });
});

describe("issuance validation", () => {
  it("requires a target account", () => {
    expect(issuanceFormIssue({ userId: null, amount: 100 })).toMatch(/Choose the account/);
  });

  it("requires a positive amount", () => {
    expect(issuanceFormIssue({ userId: "u1", amount: 0 })).toMatch(/how many credits/);
    expect(issuanceFormIssue({ userId: "u1", amount: -50 })).toMatch(/how many credits/);
    expect(issuanceFormIssue({ userId: "u1", amount: Number.NaN })).toMatch(/how many credits/);
  });

  it("refuses an absurd single issuance (overflow guard)", () => {
    expect(issuanceFormIssue({ userId: "u1", amount: CREDIT_ISSUANCE_MAX + 1 })).toMatch(
      /limited to/,
    );
    expect(issuanceFormIssue({ userId: "u1", amount: CREDIT_ISSUANCE_MAX })).toBeNull();
  });

  it("refuses fractional credits", () => {
    expect(issuanceFormIssue({ userId: "u1", amount: 10.5 })).toMatch(/whole number/);
  });

  it("accepts a valid issuance", () => {
    expect(issuanceFormIssue({ userId: "u1", amount: 1500 })).toBeNull();
  });

  it("never depends on the operator's own balance", () => {
    // The form takes no operator balance at all: issuing from a zero-balance
    // platform-owner wallet is valid by construction.
    expect(issuanceFormIssue({ userId: "u1", amount: 10_000, reason: "mint supply" })).toBeNull();
  });
});

describe("issuance reason and category", () => {
  it("requires a meaningful reason when one is supplied", () => {
    expect(issuanceFormIssue({ userId: "u1", amount: 100, reason: "  " })).toMatch(/reason/);
    expect(issuanceFormIssue({ userId: "u1", amount: 100, reason: "ok" })).toMatch(/reason/);
    expect(issuanceFormIssue({ userId: "u1", amount: 100, reason: "verified payment" })).toBeNull();
  });

  it("tags the ledger reason with the category", () => {
    expect(issuanceReason("paid via gcash", "Goodwill")).toBe(
      `${CREDIT_ISSUANCE_ACTION} — [Goodwill] paid via gcash`,
    );
    expect(issuanceReason(null, "Correction")).toBe(`${CREDIT_ISSUANCE_ACTION} — [Correction]`);
  });
});

describe("issuance provenance", () => {
  it("labels the ledger entry as a platform issuance", () => {
    expect(issuanceReason()).toBe(CREDIT_ISSUANCE_ACTION);
    expect(issuanceReason("  goodwill  ")).toBe(`${CREDIT_ISSUANCE_ACTION} — goodwill`);
    expect(ISSUANCE_ENTRY_KIND).toBe("superadmin_credit_issuance");
  });

  it("recognises issuances, including legacy manual grants, and nothing else", () => {
    expect(isCreditIssuance(issuanceReason("test"))).toBe(true);
    expect(isCreditIssuance(`${LEGACY_MANUAL_CREDIT_ACTION} — old grant`)).toBe(true);
    expect(isCreditIssuance("Platform credit purchase — Starter")).toBe(false);
    expect(isCreditIssuance(null)).toBe(false);
  });
});

describe("previewBalance", () => {
  it("adds the issuance to the recipient's balance", () => {
    expect(previewBalance(1000, 250)).toBe(1250);
    expect(previewBalance(0, 10.555)).toBe(10.56);
  });
});
