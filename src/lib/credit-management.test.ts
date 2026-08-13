import { describe, expect, it } from "vitest";
import {
  MANUAL_CREDIT_ACTION,
  MANUAL_CREDIT_MAX,
  filterOrders,
  isManualCredit,
  manualCreditIssue,
  manualCreditReason,
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

describe("manual credit validation", () => {
  it("requires a target account", () => {
    expect(manualCreditIssue({ userId: null, amount: 100 })).toMatch(/Choose the account/);
  });

  it("requires a positive amount", () => {
    expect(manualCreditIssue({ userId: "u1", amount: 0 })).toMatch(/how many credits/);
    expect(manualCreditIssue({ userId: "u1", amount: -50 })).toMatch(/how many credits/);
    expect(manualCreditIssue({ userId: "u1", amount: Number.NaN })).toMatch(/how many credits/);
  });

  it("refuses an absurd single grant", () => {
    expect(manualCreditIssue({ userId: "u1", amount: MANUAL_CREDIT_MAX + 1 })).toMatch(
      /limited to/,
    );
  });

  it("accepts a valid grant", () => {
    expect(manualCreditIssue({ userId: "u1", amount: 1500 })).toBeNull();
  });
});

describe("manual credit provenance", () => {
  it("labels the ledger entry as a manual grant", () => {
    expect(manualCreditReason()).toBe(MANUAL_CREDIT_ACTION);
    expect(manualCreditReason("  goodwill  ")).toBe(`${MANUAL_CREDIT_ACTION} — goodwill`);
  });

  it("recognises its own entries and nothing else", () => {
    expect(isManualCredit(manualCreditReason("test"))).toBe(true);
    expect(isManualCredit("Platform credit purchase — Starter")).toBe(false);
    expect(isManualCredit(null)).toBe(false);
  });
});

describe("previewBalance", () => {
  it("adds the grant to the current balance", () => {
    expect(previewBalance(1000, 250)).toBe(1250);
    expect(previewBalance(0, 10.555)).toBe(10.56);
  });
});
