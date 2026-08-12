import { describe, expect, it } from "vitest";
import {
  summariseCreditFlow,
  summariseSaleCommissions,
  type SaleCommissionReportRow,
} from "./reports";
import type { CreditEntry } from "./wallet";

const entry = (e: Partial<CreditEntry> & { id: string }): CreditEntry =>
  ({
    user_id: "u1",
    direction: "credit",
    amount: 0,
    reason: "",
    tx_id: null,
    created_at: "2026-01-01T00:00:00Z",
    entry_kind: "general",
    commission_amount: null,
    commission_percent: null,
    base_amount: null,
    ...e,
  }) as unknown as CreditEntry;

describe("summariseCreditFlow", () => {
  it("counts an unpaired credit as newly generated, not a transfer", () => {
    const flow = summariseCreditFlow([
      entry({ id: "1", tx_id: "TX1", direction: "credit", amount: 1000 }),
    ]);
    expect(flow.generated).toBe(1000);
    expect(flow.generatedCount).toBe(1);
    expect(flow.transferred).toBe(0);
  });

  it("counts a paired debit/credit as a face-value transfer with no earnings", () => {
    const flow = summariseCreditFlow([
      entry({ id: "1", tx_id: "TX2", direction: "debit", amount: 500, user_id: "admin" }),
      entry({ id: "2", tx_id: "TX2", direction: "credit", amount: 500, user_id: "res" }),
    ]);
    expect(flow.transferred).toBe(500);
    expect(flow.transferCount).toBe(1);
    expect(flow.generated).toBe(0);
  });

  it("pairs the -R receiving leg of a transfer with its debit", () => {
    const flow = summariseCreditFlow([
      entry({ id: "1", tx_id: "TX9", direction: "debit", amount: 300, user_id: "res" }),
      entry({ id: "2", tx_id: "TX9-R", direction: "credit", amount: 300, user_id: "cust" }),
    ]);
    expect(flow.transferred).toBe(300);
    expect(flow.generated).toBe(0);
  });

  it("treats an unpaired debit as revoked credits", () => {
    const flow = summariseCreditFlow([
      entry({ id: "1", tx_id: "TX3", direction: "debit", amount: 200 }),
    ]);
    expect(flow.revoked).toBe(200);
    expect(flow.transferred).toBe(0);
  });

  it("splits cashback, upline and voucher spend by entry kind", () => {
    const flow = summariseCreditFlow([
      entry({ id: "1", tx_id: "TX4", direction: "debit", amount: 100, entry_kind: "purchase" }),
      entry({ id: "2", tx_id: "TX4", direction: "credit", amount: 8, entry_kind: "sale_commission" }),
      entry({ id: "3", tx_id: "TX4", direction: "credit", amount: 2, entry_kind: "upline_commission" }),
      entry({
        id: "4",
        tx_id: "TX5",
        direction: "debit",
        amount: 8,
        entry_kind: "sale_commission_reversal",
      }),
    ]);
    expect(flow.spentOnVouchers).toBe(100);
    expect(flow.cashbackPaid).toBe(8);
    expect(flow.uplinePaid).toBe(2);
    expect(flow.commissionReversed).toBe(8);
    expect(flow.transferred).toBe(0);
    expect(flow.generated).toBe(0);
  });
});

describe("summariseSaleCommissions", () => {
  const row = (r: Partial<SaleCommissionReportRow> & { id: string }): SaleCommissionReportRow => ({
    ecosystem_id: "e1",
    sale_id: "s1",
    recipient_id: "r1",
    kind: "cashback",
    commission_percent: 10,
    commission_amount: 0,
    reversed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...r,
  });

  it("separates cashback from upline and excludes reversed rows", () => {
    const split = summariseSaleCommissions([
      row({ id: "1", commission_amount: 10 }),
      row({ id: "2", kind: "upline", commission_amount: 4 }),
      row({ id: "3", commission_amount: 6, reversed_at: "2026-01-02T00:00:00Z" }),
    ]);
    expect(split.cashback).toBe(10);
    expect(split.upline).toBe(4);
    expect(split.reversed).toBe(6);
  });
});
