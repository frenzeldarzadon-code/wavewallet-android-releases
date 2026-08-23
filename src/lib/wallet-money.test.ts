import { describe, expect, it } from "vitest";
import {
  adminCashbackPercent,
  cashInFundingLabel,
  cashOutFeePercent,
  cashOutPathLabel,
  EMPTY_CAPACITY,
  maxAdminCashInPhp,
  canDecideMoney,
  canRequestMoney,
  creditsAfterFee,
  describeRate,
  filterByStatus,
  MONEY_SETTINGS_FALLBACK,
  pendingMoneyCount,
  quoteCashIn,
  quoteWithdrawal,
  snapshotQuote,
  statusLabel,
  validateCashback,
  validateCashInProof,
  MAX_CASH_IN_PROOF_BYTES,
  validateCashIn,
  validateValuation,
  validateWithdrawal,
  type MoneySettings,
} from "@/lib/wallet-money";

const settings = (over: Partial<MoneySettings> = {}): MoneySettings => ({
  ...MONEY_SETTINGS_FALLBACK,
  ...over,
});

describe("cashback distribution", () => {
  it("gives the shop admin the remainder at the 10/20 example", () => {
    expect(adminCashbackPercent(10, 20)).toBe(70);
  });

  it("recomputes the remainder when the platform owner changes the rates", () => {
    expect(adminCashbackPercent(25, 25)).toBe(50);
    expect(adminCashbackPercent(0, 0)).toBe(100);
    expect(adminCashbackPercent(40, 60)).toBe(0);
  });

  it("rejects a distribution that would exceed the purchase", () => {
    expect(validateCashback(60, 50)).toMatch(/cannot exceed/i);
    expect(validateCashback(-1, 10)).toMatch(/between 0 and 100/i);
    expect(validateCashback(10, 20)).toBeNull();
  });

  it("splits a 10 credit purchase into 2 / 1 / 7", () => {
    const total = 10;
    const sub = total * 0.2;
    const res = total * 0.1;
    const admin = total - sub - res;
    expect([sub, res, admin]).toEqual([2, 1, 7]);
    expect(adminCashbackPercent(10, 20)).toBe(70);
  });
});

describe("credit valuation", () => {
  it("uses the configured 1,000 credits = PHP 1,000 valuation", () => {
    const q = quoteWithdrawal(100, settings());
    expect(q.gross).toBe(100);
    expect(q.fee).toBe(1);
    expect(q.net).toBe(99);
  });

  it("follows a changed valuation", () => {
    const q = quoteWithdrawal(1000, settings({ phpPerUnit: 10 }));
    expect(q.gross).toBe(10);
    expect(q.net).toBe(9.9);
  });

  it("follows a changed withdrawal fee", () => {
    expect(quoteWithdrawal(100, settings({ feePercent: 5 })).net).toBe(95);
    expect(quoteWithdrawal(100, settings({ feePercent: 0 })).net).toBe(100);
  });

  it("converts pesos to credits for cash in", () => {
    expect(quoteCashIn(250, settings())).toBe(250);
    expect(quoteCashIn(250, settings({ phpPerUnit: 10 }))).toBe(25000);
  });

  it("describes the live rate without hard-coding it", () => {
    expect(describeRate(settings({ creditsPerUnit: 1000, phpPerUnit: 10 }))).toBe("1,000 coins = ₱10");
  });

  it("validates valuation input", () => {
    expect(validateValuation(0, 100, 1)).toMatch(/greater than zero/);
    expect(validateValuation(1000, 0, 1)).toMatch(/greater than zero/);
    expect(validateValuation(1000, 1000, 120)).toMatch(/fee/i);
    expect(validateValuation(1000, 1000, 1)).toBeNull();
  });
});

describe("pending requests keep their snapshot", () => {
  it("reads the stored numbers, never the live settings", () => {
    const row = { credits: 100, gross_php: 100, fee_percent: 1, fee_php: 1, net_php: 99 };
    // Platform owner later halves the valuation and raises the fee…
    const q = snapshotQuote(row);
    expect(q.net).toBe(99);
    expect(quoteWithdrawal(100, settings({ phpPerUnit: 500, feePercent: 10 })).net).toBe(45);
    expect(snapshotQuote(row).net).toBe(99);
  });
});

describe("who may request and who may decide", () => {
  it("lets the four member roles request", () => {
    for (const role of ["customer", "subreseller", "reseller", "admin"]) {
      expect(canRequestMoney(role)).toBe(true);
    }
  });

  it("does not treat the platform owner as a requesting member", () => {
    expect(canRequestMoney("super_admin")).toBe(false);
  });

  it("only lets the platform owner approve, reject or release", () => {
    expect(canDecideMoney("super_admin")).toBe(true);
    for (const role of ["customer", "subreseller", "reseller", "admin"]) {
      expect(canDecideMoney(role)).toBe(false);
    }
  });
});

describe("withdrawal validation", () => {
  const base = { credits: 100, mode: "ewallet" as const, accountName: "Ann", accountNumber: "0917" };

  it("accepts a funded whole-credit request", () => {
    expect(validateWithdrawal(base, 500)).toBeNull();
  });

  it("rejects zero, negative and fractional amounts", () => {
    expect(validateWithdrawal({ ...base, credits: 0 }, 500)).toMatch(/Enter how many/);
    expect(validateWithdrawal({ ...base, credits: -5 }, 500)).toMatch(/Enter how many/);
    expect(validateWithdrawal({ ...base, credits: 10.5 }, 500)).toMatch(/whole number/);
  });

  it("rejects more than the wallet holds", () => {
    expect(validateWithdrawal(base, 50)).toMatch(/do not have that many/);
  });

  it("requires account details for e-wallet and bank only", () => {
    expect(validateWithdrawal({ ...base, accountNumber: "" }, 500)).toMatch(/Account name and account number/);
    expect(validateWithdrawal({ credits: 100, mode: "physical_cash" }, 500)).toBeNull();
  });

  it("caps a single withdrawal", () => {
    expect(validateWithdrawal({ ...base, credits: 20_000_000 }, 30_000_000)).toMatch(/limited to/);
  });
});

describe("cash in validation", () => {
  it("requires a method and a positive amount", () => {
    expect(validateCashIn(100, null)).toMatch(/payment method/);
    expect(validateCashIn(0, "m1")).toMatch(/how much/);
    expect(validateCashIn(100, "m1")).toBeNull();
  });

  it("accepts any provider's payer identity, not just a GCash mobile number", () => {
    const base = { hasProof: true };
    // e-wallet: mobile number read off the receipt
    expect(validateCashIn(100, "m1", { ...base, payerNumber: "09171234567" })).toBeNull();
    // bank: masked account / payer name instead of a mobile number
    expect(validateCashIn(100, "m1", { ...base, payerNumber: "", payerAccount: "****1234" })).toBeNull();
    expect(validateCashIn(100, "m1", { ...base, payerNumber: "", payerAccount: "JUAN D." })).toBeNull();
    // bank account number typed by hand
    expect(validateCashIn(100, "m1", { ...base, payerNumber: "0012 3456 7890" })).toBeNull();
    // nothing at all still fails, and the screenshot stays required
    expect(validateCashIn(100, "m1", { ...base, payerNumber: "" })).toMatch(/account number or mobile number/i);
    expect(validateCashIn(100, "m1", { hasProof: false, payerNumber: "09171234567" })).toMatch(/screenshot/);
  });
});


describe("queues", () => {
  const rows = [{ status: "pending" }, { status: "pending" }, { status: "released" }, { status: "rejected" }];

  it("counts only what still needs a decision", () => {
    expect(pendingMoneyCount(rows)).toBe(2);
  });

  it("filters by status", () => {
    expect(filterByStatus(rows, "released")).toHaveLength(1);
    expect(filterByStatus(rows, "all")).toHaveLength(4);
  });

  it("labels a released payout as a successful withdrawal", () => {
    expect(statusLabel("released")).toBe("Successful withdrawal");
    expect(statusLabel("pending")).toBe("Pending");
  });
});

describe("credit-only presentation", () => {
  it("derives the payout in credits from the fee percent snapshot", () => {
    expect(creditsAfterFee(1000, 1)).toBe(990);
    expect(creditsAfterFee(1000, 0)).toBe(1000);
    expect(creditsAfterFee(0, 5)).toBe(0);
  });
});

describe("cash in payment screenshot", () => {
  it("accepts jpg, png and webp under the size cap", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateCashInProof({ type, size: 1024 })).toBeNull();
    }
  });

  it("rejects unsupported image types with a clear message", () => {
    expect(validateCashInProof({ type: "application/pdf", size: 1024 })).toMatch(/JPG, PNG or WEBP/);
    expect(validateCashInProof({ type: "image/gif", size: 1024 })).toMatch(/JPG, PNG or WEBP/);
  });

  it("rejects oversized screenshots", () => {
    expect(validateCashInProof({ type: "image/png", size: MAX_CASH_IN_PROOF_BYTES + 1 })).toMatch(/5 MB/);
    expect(validateCashInProof({ type: "image/png", size: MAX_CASH_IN_PROOF_BYTES })).toBeNull();
  });

  it("never requires notes or a screenshot to submit", () => {
    expect(validateCashIn(500, "method-1")).toBeNull();
  });
});

describe("cash out path fees", () => {
  it("never charges a fee on a shop admin cash out", () => {
    expect(cashOutFeePercent("admin", { ...MONEY_SETTINGS_FALLBACK, feePercent: 5 })).toBe(0);
  });

  it("keeps the configured fee on the platform cash out", () => {
    expect(cashOutFeePercent("superadmin", { ...MONEY_SETTINGS_FALLBACK, feePercent: 5 })).toBe(5);
  });
});

describe("admin cash in capacity", () => {
  const cap = (available: number) => ({ ...EMPTY_CAPACITY, balance: available, available });

  it("caps a member at the admin's spendable credits", () => {
    expect(maxAdminCashInPhp(cap(1000), MONEY_SETTINGS_FALLBACK)).toBe(1000);
  });

  it("subtracts credits already reserved by pending requests", () => {
    const held = { ...EMPTY_CAPACITY, balance: 1000, reserved: 300, available: 700 };
    expect(maxAdminCashInPhp(held, MONEY_SETTINGS_FALLBACK)).toBe(700);
  });

  it("offers nothing when the admin has no spendable credits", () => {
    expect(maxAdminCashInPhp(cap(0), MONEY_SETTINGS_FALLBACK)).toBe(0);
    expect(maxAdminCashInPhp(EMPTY_CAPACITY, MONEY_SETTINGS_FALLBACK)).toBe(0);
  });

  it("grosses the peso ceiling up when a cash in fee is configured", () => {
    const settings = { ...MONEY_SETTINGS_FALLBACK, cashInFeePercent: 10 };
    // 700 credits arrive after a 10% fee, so ~777.78 pesos may be paid.
    expect(maxAdminCashInPhp(cap(700), settings)).toBeCloseTo(777.78, 2);
  });

  it("labels the funding source and cash out path for members", () => {
    expect(cashInFundingLabel("admin")).toBe("My shop admin's GCash");
    expect(cashInFundingLabel(null)).toBe("Platform GCash");
    expect(cashOutPathLabel("admin")).toBe("My shop admin");
    expect(cashOutPathLabel(null)).toBe("Platform cash out");
  });
});

describe("cash in sender identifier is provider-neutral", () => {
  const b = { hasProof: true, payerReference: "9044057598177" };
  it("accepts a bank account number and a GCash number", () => {
    expect(validateCashIn(100, "m1", { ...b, payerNumber: "15976553427" })).toBeNull();
    expect(validateCashIn(100, "m1", { ...b, payerNumber: "09541230072" })).toBeNull();
    expect(validateCashIn(100, "m1", { ...b, payerNumber: "ACCT-9931-XY" })).toBeNull();
  });
  it("still asks for something when nothing identifies the sender", () => {
    expect(validateCashIn(100, "m1", { ...b, payerNumber: "" })).toMatch(
      /account number or mobile number/i,
    );
  });
});
