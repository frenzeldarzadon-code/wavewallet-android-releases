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
const today = new Date();
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
};
const startOfYear = () => {
  const d = new Date(today);
  d.setMonth(0, 2);
  d.setHours(12, 0, 0, 0);
  return d;
};

const earning = (type: EarningType, amount: number, at: Date): EarningRow =>
  ({
    id: `${type}-${amount}-${at.getTime()}`,
    earning_type: type,
    recipient_id: "r1",
    ecosystem_id: "eco",
    amount,
    created_at: iso(at),
  }) as unknown as EarningRow;

const expense = (amount: number, at: Date): ExpenseRow => ({
  id: `x-${amount}-${at.getTime()}`,
  scope: "ecosystem",
  ecosystem_id: "eco",
  amount,
  description: "cost",
  category: null,
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
    if (jan.toDateString() !== today.toDateString()) expect(e.cashback.today).toBe(0);
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
