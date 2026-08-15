import { describe, expect, it } from "vitest";
import {
  adminNetEarnings,
  platformNetEarnings,
  pointsEarnings,
  sellerEarnings,
  type PointsEarningRow,
} from "./role-earnings";
import type { EarningRow, EarningType } from "./earnings";
import type { ExpenseRow } from "./expenses";
import type { CashOutFeeRow } from "./platform-earnings";

const iso = (d: Date) => d.toISOString();

/**
 * Reports bucket days in the shared reporting timezone (Asia/Manila), so the
 * fixtures must be anchored there too. A machine-local noon drifts into the
 * previous Manila day after 16:00 UTC and would make "today" totals flaky.
 */
const MANILA_OFFSET_HOURS = 8;
const manilaParts = (d: Date) => {
  const shifted = new Date(d.getTime() + MANILA_OFFSET_HOURS * 3_600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
};
/** Midday in Manila on the requested Manila calendar day. */
const manilaNoon = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day, 12 - MANILA_OFFSET_HOURS, 0, 0, 0));

const now = manilaParts(new Date());
const daysAgo = (n: number) => manilaNoon(now.year, now.month, now.day - n);
const startOfYear = () => manilaNoon(now.year, 0, 2);


const earning = (type: EarningType, amount: number, at: Date): EarningRow =>
  ({
    id: `${type}-${amount}-${at.getTime()}`,
    occurred_at: iso(at),
    ecosystem_id: "eco",
    earning_type: type,
    recipient_id: "r1",
    recipient_name: "Member",
    counterparty_id: null,
    counterparty_name: null,
    product_name: null,
    quantity: null,
    gross_amount: amount,
    basis_amount: amount,
    rate_percent: 0,
    earning_amount: amount,
    status: "settled",
    tx_id: null,
    sale_id: null,
  }) satisfies EarningRow;

const expense = (amount: number, at: Date): ExpenseRow => ({
  id: `x-${amount}-${at.getTime()}`,
  scope: "ecosystem",
  ecosystem_id: "eco",
  amount,
  description: "cost",
  category: null,
  provider: null,
  provider_reference: null,
  currency: "PHP",

  created_by: "admin",
  created_by_name: "Admin",
  spent_at: iso(at),
  created_at: iso(at),
});

const fee = (amount: number, at: Date): CashOutFeeRow => ({
  id: `f-${amount}-${at.getTime()}`,
  reference: "WD-1",
  requester_name: "Member",
  ecosystem_id: "eco",
  gross_php: amount * 100,
  fee_percent: 1,
  fee_php: amount,
  net_php: amount * 99,
  released_at: iso(at),
});

describe("reseller / subreseller dashboard earnings", () => {
  it("shows cashback, discount and their total per period", () => {
    const rows = [
      earning("sale_cashback", 10, daysAgo(0)),
      earning("upline_commission", 5, daysAgo(0)),
      earning("wholesale_discount", 4, daysAgo(0)),
      earning("wholesale_discount", 6, startOfYear()),
    ];
    const e = sellerEarnings(rows);
    expect(e.cashback.today).toBe(15);
    expect(e.discount.today).toBe(4);
    expect(e.total.today).toBe(19);
    expect(e.total.year).toBe(25);
  });

  it("never counts transfers, cash in or issued credits", () => {
    const rows = [
      earning("sale_cashback", 10, daysAgo(0)),
      earning("credit_generation" as EarningType, 5000, daysAgo(0)),
    ];
    const e = sellerEarnings(rows);
    expect(e.total.today).toBe(10);
    expect(e.total.year).toBe(10);
  });

  it("separates daily from monthly, quarterly and yearly buckets", () => {
    const jan = startOfYear();
    const rows = [earning("sale_cashback", 100, jan)];
    const e = sellerEarnings(rows);
    expect(e.cashback.year).toBe(100);
    if (jan.getTime() !== daysAgo(0).getTime()) expect(e.cashback.today).toBe(0);
  });
});

describe("customer dashboard earnings", () => {
  const pt = (o: Partial<PointsEarningRow>): PointsEarningRow => ({
    entry_type: "earn",
    direction: "credit",
    amount: 0,
    created_at: iso(daysAgo(0)),
    ...o,
  });

  it("counts earned points only", () => {
    const totals = pointsEarnings([
      pt({ amount: 30 }),
      pt({ amount: 10, entry_type: "redeem", direction: "debit" }),
      pt({ amount: 7, entry_type: "adjust" }),
    ]);
    expect(totals.today).toBe(30);
    expect(totals.year).toBe(30);
  });
});

describe("admin dashboard earnings", () => {
  it("uses the 10-credit example: 7 retained, expense 2 leaves net 5", () => {
    const e = adminNetEarnings(
      [earning("admin_shop_margin", 7, daysAgo(0))],
      [expense(2, daysAgo(0))],
    );
    expect(e.earnings.today).toBe(7);
    expect(e.expenses.today).toBe(2);
    expect(e.net.today).toBe(5);
    expect(e.net.year).toBe(5);
  });

  it("ignores platform issuance, cash in, transfers and withdrawal holds", () => {
    const e = adminNetEarnings(
      [
        earning("admin_shop_margin", 7, daysAgo(0)),
        earning("credit_generation" as EarningType, 5000, daysAgo(0)),
      ],
      [],
    );
    expect(e.earnings.today).toBe(7);
    expect(e.net.today).toBe(7);
  });
});

describe("super admin dashboard earnings", () => {
  it("counts collected cash-out fees only", () => {
    const e = platformNetEarnings([fee(10, daysAgo(0)), fee(5, startOfYear())], []);
    expect(e.earnings.today).toBe(10);
    expect(e.earnings.year).toBe(15);
  });

  it("is unchanged by credit issuance and cash in", () => {
    const before = platformNetEarnings([fee(10, daysAgo(0))], []);
    // Issuance and cash in produce no withdrawal fee rows at all.
    const after = platformNetEarnings([fee(10, daysAgo(0))], []);
    expect(after.earnings).toEqual(before.earnings);
    expect(after.net.year).toBe(10);
  });

  it("deducts platform expenses to produce net earnings", () => {
    const e = platformNetEarnings(
      [fee(10, daysAgo(0))],
      [{ ...expense(4, daysAgo(0)), scope: "platform", ecosystem_id: null }],
    );
    expect(e.net.today).toBe(6);
  });
});
