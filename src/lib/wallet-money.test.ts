import { describe, expect, it } from "vitest";
import {
  adminCashbackPercent,
  canDecideMoney,
  canRequestMoney,
  describeRate,
  filterByStatus,
  MONEY_SETTINGS_FALLBACK,
  pendingMoneyCount,
  quoteCashIn,
  quoteWithdrawal,
  snapshotQuote,
  statusLabel,
  validateCashback,
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
    expect(describeRate(settings({ creditsPerUnit: 1000, phpPerUnit: 10 }))).toBe("1,000 credits = ₱10");
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
