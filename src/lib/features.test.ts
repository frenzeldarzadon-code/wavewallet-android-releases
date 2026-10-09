import { describe, expect, it } from "vitest";
import { LOANS_VISIBLE, isFeaturePathVisible, isLoanDisplayVisible } from "./features";

describe("temporary loan presentation restriction", () => {
  it("keeps the single loan visibility flag off", () => {
    expect(LOANS_VISIBLE).toBe(false);
  });
  it.each(["/universe/loans", "/universe/loan-pool", "/super/loans"])("hides destination %s", (path) => {
    expect(isFeaturePathVisible(path)).toBe(false);
  });
  it.each(["loan_release", "loan_repayment", "universe_loan_payment", "universe_loan_interest_refund", "loan_pool_contribution", "loan_pool_withdrawal", "Coin loan repayment", "loan", "/universe/loans?tab=shop"])("hides system display %s", (value) => {
    expect(isLoanDisplayVisible(value)).toBe(false);
  });
  it.each(["purchase", "sale_commission", "Cash In approved", "Coin transfer", "cash_out", "/universe/wallet", "/super/approvals"])("preserves non-loan display %s", (value) => {
    expect(isLoanDisplayVisible(value)).toBe(true);
    expect(isFeaturePathVisible(value)).toBe(true);
  });
});