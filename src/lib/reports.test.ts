import { describe, expect, it } from "vitest";
import {
  adminShopEarnings,
  summariseCreditFlow,
  summariseSaleCommissions,
  type SaleCommissionReportRow,
  type SaleReportRow,
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

describe("admin shop earnings (retained share of completed sales)", () => {
  const sale = (o: Partial<SaleReportRow> & { id: string }): SaleReportRow =>
    ({
      ecosystem_id: "eco",
      product_name: "1-Day Wifi",
      buyer_id: "cust",
      buyer_role: "customer",
      reseller_id: null,
      list_price: 10,
      discount_percent: 0,
      sale_price: 10,
      payment_method: "credits",
      tx_id: "TX",
      created_at: "2026-01-01T00:00:00Z",
      points_spent: 0,
      points_earned: 0,
      credits_per_point_used: null,
      points_rule_version: null,
      refunded_at: null,
      refund_reason: null,
      ...o,
    }) as SaleReportRow;

  const comm = (o: Partial<SaleCommissionReportRow> & { id: string }): SaleCommissionReportRow =>
    ({
      ecosystem_id: "eco",
      sale_id: "s1",
      recipient_id: "r",
      kind: "seller",
      commission_percent: 0,
      commission_amount: 0,
      reversed_at: null,
      created_at: "2026-01-01T00:00:00Z",
      ...o,
    }) as SaleCommissionReportRow;

  it("keeps the admin remainder after 20% subreseller + 10% reseller cashback", () => {
    const e = adminShopEarnings(
      [sale({ id: "s1" })],
      [
        comm({ id: "c1", kind: "seller", commission_percent: 20, commission_amount: 2 }),
        comm({ id: "c2", kind: "upline", commission_percent: 10, commission_amount: 1 }),
      ],
    );
    expect(e.saleCollected).toBe(10);
    expect(e.cashbackPaid).toBe(2);
    expect(e.uplinePaid).toBe(1);
    expect(e.retained).toBe(7);
  });

  it("follows whatever percentages were configured at sale time", () => {
    const e = adminShopEarnings(
      [sale({ id: "s1", sale_price: 100 })],
      [
        comm({ id: "c1", kind: "seller", commission_percent: 35, commission_amount: 35 }),
        comm({ id: "c2", kind: "upline", commission_percent: 5, commission_amount: 5 }),
      ],
    );
    expect(e.retained).toBe(60);
  });

  it("keeps historical snapshots when rates change later", () => {
    const e = adminShopEarnings(
      [sale({ id: "s1", sale_price: 10 }), sale({ id: "s2", sale_price: 10 })],
      [
        comm({ id: "c1", sale_id: "s1", commission_amount: 2, commission_percent: 20 }),
        comm({ id: "c2", sale_id: "s2", commission_amount: 5, commission_percent: 50 }),
      ],
    );
    expect(e.retained).toBe(13);
  });

  it("never double-counts a cashback row against another sale", () => {
    const e = adminShopEarnings(
      [sale({ id: "s1" })],
      [
        comm({ id: "c1", sale_id: "s1", commission_amount: 2 }),
        comm({ id: "c2", sale_id: "other-sale", commission_amount: 9 }),
      ],
    );
    expect(e.retained).toBe(8);
  });

  it("excludes refunded and points-funded sales", () => {
    const e = adminShopEarnings(
      [
        sale({ id: "s1", refunded_at: "2026-01-02T00:00:00Z" }),
        sale({ id: "s2", payment_method: "points", sale_price: 0, points_spent: 100 }),
      ],
      [comm({ id: "c1", sale_id: "s1", commission_amount: 2, reversed_at: "2026-01-02T00:00:00Z" })],
    );
    expect(e.saleCount).toBe(0);
    expect(e.retained).toBe(0);
    expect(e.refundedCount).toBe(1);
  });

  it("is unchanged by platform issuance, cash in, transfers and withdrawal holds", () => {
    const flow = summariseCreditFlow([
      entry({ id: "1", tx_id: "TX-ISS", direction: "credit", amount: 5000, entry_kind: "credit_issue" }),
      entry({ id: "2", tx_id: "TX-CI", direction: "credit", amount: 1000, entry_kind: "cash_in" }),
      entry({ id: "3", tx_id: "TX-W", direction: "debit", amount: 300, entry_kind: "withdrawal_hold" }),
      entry({ id: "4", tx_id: "TX-WR", direction: "credit", amount: 300, entry_kind: "withdrawal_return" }),
      entry({ id: "5", tx_id: "TX-T", direction: "debit", amount: 200, user_id: "a" }),
      entry({ id: "6", tx_id: "TX-T-R", direction: "credit", amount: 200, user_id: "b" }),
    ]);
    expect(flow.generated).toBe(0);
    expect(flow.revoked).toBe(0);
    expect(flow.platformIssued).toBe(5000);
    expect(flow.cashIn).toBe(1000);
    expect(flow.withdrawalHeld).toBe(300);
    expect(flow.withdrawalReturned).toBe(300);
    expect(flow.transferred).toBe(200);

    const e = adminShopEarnings([sale({ id: "s1" })], [comm({ id: "c1", commission_amount: 3 })]);
    expect(e.retained).toBe(7);
  });
});
