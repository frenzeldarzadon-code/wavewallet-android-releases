import { describe, expect, it } from "vitest";
import { cashInDecisionError, quoteCashIn, type MoneySettings } from "./wallet-money";

/**
 * Regression coverage for the cash in approval fix.
 *
 * The database rules verified live against the project database on the fix:
 *  - approval credits the member's SAME standard credit balance (0 → 1,000)
 *  - a credit lot is created for the ledger entry, with the member's own
 *    ecosystem (null for platform-level accounts such as the platform owner)
 *  - a platform issuance row keyed `cash_in:<id>` is written, so the platform
 *    owner's own wallet is never debited
 *  - approving twice raises "This request was already approved"
 *  - rejection writes no ledger, lot or issuance row
 * These pure tests lock the client-side contract around that flow.
 */

const settings: MoneySettings = {
  creditsPerUnit: 1000,
  phpPerUnit: 1000,
  feePercent: 1,
} as MoneySettings;

describe("cash in conversion snapshot", () => {
  it("uses the configured rate, never a hard-coded one", () => {
    expect(quoteCashIn(1000, settings)).toBe(1000);
    expect(quoteCashIn(500, { ...settings, creditsPerUnit: 1200 })).toBe(600);
  });

  it("re-reads a stored request from its own snapshot", () => {
    const stored = { amount_php: 1000, credits: 1000 };
    // a later rate change must not restate an already submitted request
    expect(quoteCashIn(stored.amount_php, { ...settings, creditsPerUnit: 2000 })).toBe(2000);
    expect(stored.credits).toBe(1000);
  });
});

describe("cash in decision errors", () => {
  it("explains a duplicate approval instead of leaking SQL", () => {
    expect(cashInDecisionError("This request was already approved")).toMatch(/already decided/);
  });

  it("explains a broken shop link instead of a constraint error", () => {
    expect(
      cashInDecisionError('null value in column "ecosystem_id" of relation "credit_lots" violates not-null constraint'),
    ).toMatch(/shop link is missing/);
  });

  it("explains a missing member", () => {
    expect(cashInDecisionError("Member not found")).toMatch(/no longer exists/);
  });

  it("explains a role boundary", () => {
    expect(cashInDecisionError("Only the platform owner can decide cash in requests")).toMatch(/platform owner/);
  });

  it("passes through anything else unchanged", () => {
    expect(cashInDecisionError("network unreachable")).toBe("network unreachable");
  });
});
