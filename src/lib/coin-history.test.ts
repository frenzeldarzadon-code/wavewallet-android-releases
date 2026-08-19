import { describe, expect, it } from "vitest";
import { buildCoinHistory, cashbackSummary, filterCoinHistory } from "@/lib/coin-history";
import type { CreditEntry } from "@/lib/wallet";

const entry = (over: Partial<CreditEntry>): CreditEntry => ({
  id: "e1",
  direction: "debit",
  amount: 10,
  balance_after: 90,
  reason: "Voucher purchase",
  reference: null,
  tx_id: "TX-1",
  created_at: "2026-08-10T10:00:00Z",
  user_id: "viewer",
  entry_kind: "purchase",
  sale_id: "sale-1",
  ...over,
});

describe("buildCoinHistory", () => {
  it("shows one line for a purchase that also paid the viewer cashback", () => {
    const rows = buildCoinHistory([
      entry({ id: "p", entry_kind: "purchase", direction: "debit", amount: 10 }),
      entry({
        id: "c",
        entry_kind: "sale_commission",
        direction: "credit",
        amount: 2,
        commission_percent: 20,
        reason: "Sales cashback",
        balance_after: 92,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("purchase");
    expect(rows[0]!.amount).toBe(10);
    expect(rows[0]!.cashbackTotal).toBe(2);
    expect(cashbackSummary(rows[0]!)).toContain("2");
  });

  it("does not duplicate the purchase amount across multiple cashback rows", () => {
    const rows = buildCoinHistory([
      entry({ id: "p" }),
      entry({ id: "c1", entry_kind: "sale_commission", direction: "credit", amount: 1 }),
      entry({ id: "c2", entry_kind: "upline_commission", direction: "credit", amount: 1 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(10);
    expect(rows[0]!.cashback).toHaveLength(2);
    expect(rows[0]!.entries).toHaveLength(3);
  });

  it("keeps a downline cashback with no purchase debit as a single credit line", () => {
    const rows = buildCoinHistory([
      entry({
        id: "c",
        entry_kind: "upline_commission",
        direction: "credit",
        amount: 3,
        reason: "Downline sale cashback",
        sale_id: "sale-9",
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.direction).toBe("credit");
    expect(rows[0]!.amount).toBe(3);
    expect(rows[0]!.cashback).toHaveLength(0);
  });

  it("falls back to tx_id when older rows carry no sale reference", () => {
    const rows = buildCoinHistory([
      entry({ id: "p", sale_id: null, tx_id: "TX-OLD" }),
      entry({
        id: "c",
        sale_id: null,
        tx_id: "TX-OLD",
        entry_kind: "sale_commission",
        direction: "credit",
        amount: 2,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cashbackTotal).toBe(2);
  });

  it("leaves non-purchase movements untouched", () => {
    const rows = buildCoinHistory([
      entry({ id: "t", entry_kind: "transfer", sale_id: null, reason: "Coin transfer sent" }),
      entry({ id: "g", entry_kind: "general", sale_id: null, tx_id: "TX-2", reason: "Cash in" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "entry")).toBe(true);
  });

  it("filters grouped rows by direction", () => {
    const rows = buildCoinHistory([
      entry({ id: "p" }),
      entry({ id: "c", entry_kind: "sale_commission", direction: "credit", amount: 2 }),
    ]);
    expect(filterCoinHistory(rows, "credit")).toHaveLength(0);
    expect(filterCoinHistory(rows, "debit")).toHaveLength(1);
  });
});
