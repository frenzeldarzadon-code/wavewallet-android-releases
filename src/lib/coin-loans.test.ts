import { describe, expect, it } from "vitest";
import {
  autoApprovalLimit,
  needsManualApproval,
  releasedCoins,
  requestGoesToApproval,
  upfrontInterest,
  validateLoanRequest,
  validateLoanSubmission,
  validateLoanIdFile,
  loanIdRequired,
  loanStatusLabel,
} from "@/lib/coin-loans";

const settings = {
  enabled: true,
  baseCredits: 1000,
  multiplier: 3,
  monthlyInterestPercent: 2,
  firstMonthUpfront: true,
};

describe("automatic approval limit", () => {
  it("uses the base amount for small free balances", () => {
    expect(autoApprovalLimit(0, settings)).toBe(1000);
    expect(autoApprovalLimit(200, settings)).toBe(1000);
    expect(autoApprovalLimit(333.33, settings)).toBe(1000);
  });

  it("uses 3x the free balance once that is larger", () => {
    expect(autoApprovalLimit(500, settings)).toBe(1500);
    expect(autoApprovalLimit(2000, settings)).toBe(6000);
  });

  it("never counts restricted coins — only the free balance is passed in", () => {
    const balance = 5000;
    const restricted = 4800;
    expect(autoApprovalLimit(balance - restricted, settings)).toBe(1000);
  });

  it("follows a reconfigured base and multiplier", () => {
    const custom = { ...settings, baseCredits: 2000, multiplier: 1.5 };
    expect(autoApprovalLimit(100, custom)).toBe(2000);
    expect(autoApprovalLimit(4000, custom)).toBe(6000);
  });
});

describe("upfront interest", () => {
  it("takes the first month off the released coins", () => {
    expect(upfrontInterest(1000, settings)).toBe(20);
    expect(releasedCoins(1000, settings)).toBe(980);
  });

  it("releases the full amount when the upfront toggle is off", () => {
    const off = { ...settings, firstMonthUpfront: false };
    expect(upfrontInterest(1000, off)).toBe(0);
    expect(releasedCoins(1000, off)).toBe(1000);
  });

  it("rounds to two decimals", () => {
    expect(upfrontInterest(1234.56, settings)).toBe(24.69);
  });
});

describe("manual approval", () => {
  it("is required only above the limit", () => {
    expect(needsManualApproval(1000, 1000)).toBe(false);
    expect(needsManualApproval(1000.01, 1000)).toBe(true);
    expect(needsManualApproval(6000, 6000)).toBe(false);
  });
});

describe("request validation", () => {
  const base = { loansEnabled: true, status: null as string | null };

  it("blocks when loans are switched off", () => {
    expect(validateLoanRequest(500, { ...base, loansEnabled: false })).toMatch(/not available/);
  });

  it("allows only one loan at a time", () => {
    expect(validateLoanRequest(500, { ...base, status: "active" })).toMatch(/Repay/);
    expect(validateLoanRequest(500, { ...base, status: "pending" })).toMatch(/still waiting/);
  });

  it("rejects non-positive amounts", () => {
    expect(validateLoanRequest(0, base)).toMatch(/greater than zero/);
    expect(validateLoanRequest(-5, base)).toMatch(/greater than zero/);
  });

  it("accepts a valid request", () => {
    expect(validateLoanRequest(1500, base)).toBeNull();
    expect(validateLoanRequest(1500, { ...base, status: "settled" })).toBeNull();
  });
});

describe("labels", () => {
  it("reads in plain language", () => {
    expect(loanStatusLabel("active")).toBe("Active");
    expect(loanStatusLabel(null)).toBe("No loan");
  });
});

describe("who gets released automatically", () => {
  it("releases a position holder within their limit", () => {
    expect(requestGoesToApproval(900, { canAuto: true, autoLimit: 1000 })).toBe(false);
  });

  it("sends a position holder above the limit for approval", () => {
    expect(requestGoesToApproval(1500, { canAuto: true, autoLimit: 1000 })).toBe(true);
  });

  it("never auto-approves a customer, whatever the amount", () => {
    expect(requestGoesToApproval(1, { canAuto: false, autoLimit: 0 })).toBe(true);
    expect(requestGoesToApproval(1, { canAuto: false, autoLimit: 5000 })).toBe(true);
    expect(requestGoesToApproval(100000, { canAuto: false, autoLimit: 0 })).toBe(true);
  });
});

describe("customer valid ID requirement", () => {
  const base = { loansEnabled: true, status: "none" as const };

  it("requires an ID for a member with no shop position", () => {
    expect(loanIdRequired({ hasPosition: false })).toBe(true);
    expect(validateLoanSubmission(500, { ...base, hasPosition: false }, false)).toMatch(/valid ID/i);
    expect(validateLoanSubmission(500, { ...base, hasPosition: false }, true)).toBeNull();
  });

  it("does not require an ID from admins, resellers or subresellers", () => {
    expect(loanIdRequired({ hasPosition: true })).toBe(false);
    expect(validateLoanSubmission(500, { ...base, hasPosition: true }, false)).toBeNull();
  });

  it("still reports the ordinary problems first", () => {
    expect(validateLoanSubmission(0, { ...base, hasPosition: false }, true)).toMatch(/greater than zero/i);
    expect(
      validateLoanSubmission(500, { ...base, loansEnabled: false, hasPosition: false }, true),
    ).toMatch(/not available/i);
  });

  it("accepts only reasonable ID photos", () => {
    expect(validateLoanIdFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateLoanIdFile({ type: "application/pdf", size: 1000 })).toMatch(/JPG/);
    expect(validateLoanIdFile({ type: "image/png", size: 9 * 1024 * 1024 })).toMatch(/5 MB/);
  });
});
