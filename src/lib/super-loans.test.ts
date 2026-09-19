import { describe, expect, it } from "vitest";
import {
  borrowerName,
  loanTone,
  owedBreakdown,
  roleLabel,
  sortTransactions,
  type SuperLoan,
} from "@/lib/super-loans";

const loan: SuperLoan = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "u1",
  fullName: "Maria Santos",
  handle: "maria",
  role: "reseller",
  principal: 1000,
  releasedAmount: 980,
  firstMonthInterest: 20,
  interestPercent: 2,
  accruedInterest: 40,
  outstanding: 640,
  totalOwed: 1040,
  repaid: 400,
  autoLimitSnapshot: 1000,
  freeBalanceSnapshot: 120,
  status: "active",
  approvalMode: "auto",
  origin: "member_request",
  createdBy: null,
  createdByName: null,
  referenceNote: null,
  borrowerRole: "reseller",
  universeSpend: false,
  decidedAt: null,
  decisionNote: null,
  releasedAt: "2026-01-02T00:00:00Z",
  settledAt: null,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("total owed is reconcilable from the stored loan record", () => {
  it("explains the balance as borrowed + interest − repayments", () => {
    const b = owedBreakdown(loan);
    expect(b.charged).toBe(1040);
    expect(b.derived).toBe(640);
    expect(b.outstanding).toBe(640);
    expect(b.reconciles).toBe(true);
  });

  it("never rewrites the stored balance — it flags a difference instead", () => {
    const b = owedBreakdown({ ...loan, outstanding: 700 });
    expect(b.outstanding).toBe(700);
    expect(b.reconciles).toBe(false);
    expect(b.difference).toBe(60);
  });

  it("handles a fully repaid loan", () => {
    const b = owedBreakdown({ ...loan, repaid: 1040, outstanding: 0, status: "settled" });
    expect(b.derived).toBe(0);
    expect(b.reconciles).toBe(true);
  });
});

describe("presentation helpers", () => {
  it("labels roles in plain words", () => {
    expect(roleLabel("admin")).toBe("Shop admin");
    expect(roleLabel("subreseller")).toBe("Sub-reseller");
    expect(roleLabel(null)).toBe("Member");
  });

  it("colours each loan status", () => {
    expect(loanTone("active")).toBe("warning");
    expect(loanTone("settled")).toBe("success");
    expect(loanTone("pending")).toBe("brand");
    expect(loanTone("rejected")).toBe("danger");
  });

  it("falls back from name to handle", () => {
    expect(borrowerName(loan)).toBe("Maria Santos");
    expect(borrowerName({ fullName: null, handle: "jay" })).toBe("@jay");
    expect(borrowerName({ fullName: null, handle: null })).toBe("Member");
  });
});

describe("transaction sorting", () => {
  const rows = [
    { createdAt: "2026-01-01T00:00:00Z", amount: 50 },
    { createdAt: "2026-03-01T00:00:00Z", amount: 10 },
    { createdAt: "2026-02-01T00:00:00Z", amount: 90 },
  ];

  it("sorts newest, oldest and by amount without mutating the input", () => {
    expect(sortTransactions(rows, "newest")[0]?.createdAt).toBe("2026-03-01T00:00:00Z");
    expect(sortTransactions(rows, "oldest")[0]?.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(sortTransactions(rows, "amount-high")[0]?.amount).toBe(90);
    expect(sortTransactions(rows, "amount-low")[0]?.amount).toBe(10);
    expect(rows[0]?.amount).toBe(50);
  });
});
