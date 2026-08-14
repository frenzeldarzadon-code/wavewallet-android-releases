import { describe, expect, it } from "vitest";
import {
  MONEY_SETTINGS_FALLBACK,
  quoteCashInBreakdown,
  validateCashInFee,
  type MoneySettings,
} from "@/lib/wallet-money";
import {
  cashInFeePeriodTotals,
  totalCashInFees,
  type CashInFeeRow,
} from "@/lib/platform-earnings";
import { platformNetEarnings } from "@/lib/role-earnings";

const settings = (over: Partial<MoneySettings> = {}): MoneySettings => ({
  ...MONEY_SETTINGS_FALLBACK,
  ...over,
});

describe("configurable cash in fee", () => {
  it("uses the configured percentage, never a hard-coded one", () => {
    const q = quoteCashInBreakdown(1000, settings({ cashInFeePercent: 2 }));
    expect(q.gross).toBe(1000);
    expect(q.feePercent).toBe(2);
    expect(q.fee).toBe(20);
    expect(q.net).toBe(980);
  });

  it("changes the outcome as soon as the platform owner changes the setting", () => {
    expect(quoteCashInBreakdown(500, settings({ cashInFeePercent: 0 })).net).toBe(500);
    expect(quoteCashInBreakdown(500, settings({ cashInFeePercent: 5 })).net).toBe(475);
  });

  it("converts the NET amount to credits, not the gross", () => {
    const q = quoteCashInBreakdown(1000, settings({ cashInFeePercent: 10, creditsPerUnit: 1000, phpPerUnit: 1000 }));
    expect(q.credits).toBe(900);
  });

  it("validates the percentage", () => {
    expect(validateCashInFee(-1)).toMatch(/negative/i);
    expect(validateCashInFee(100)).toMatch(/less than 100/i);
    expect(validateCashInFee(0)).toBeNull();
    expect(validateCashInFee(7.5)).toBeNull();
  });
});

describe("historical cash in fees", () => {
  const row = (over: Partial<CashInFeeRow> = {}): CashInFeeRow => ({
    id: "a",
    reference: "CI-1",
    requester_name: "Ann",
    ecosystem_id: null,
    amount_php: 1000,
    fee_percent: 1,
    fee_php: 10,
    net_php: 990,
    reviewed_at: new Date().toISOString(),
    ...over,
  });

  it("reports the fee stored on the request, not a recomputed one", () => {
    const rows = [row(), row({ id: "b", fee_percent: 5, fee_php: 50, net_php: 950 })];
    // a later setting change cannot restate these numbers: they come from the row
    expect(totalCashInFees(rows)).toBe(60);
    expect(cashInFeePeriodTotals(rows).today).toBe(60);
  });

  it("adds collected cash in fees to platform earnings", () => {
    const rows = [row({ fee_php: 25 })];
    const net = platformNetEarnings([], [], rows);
    expect(net.earnings.today).toBe(25);
    expect(net.net.today).toBe(25);
  });
});
