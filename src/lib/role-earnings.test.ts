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

/**
 * Dashboard "Total" column: lifetime, independent of the calendar year, while
 * the period columns stay year-scoped. Non-purchase movements never appear
 * because they are not earning rows at all.
 */
describe("lifetime totals", () => {
  const lastYear = manilaNoon(now.year - 1, 5, 10);

  it("counts prior-year purchases in the total but not in the yearly column", () => {
    const rows = [
      earning("sale_cashback", 20, daysAgo(0)),
      earning("sale_cashback", 15, lastYear),
    ];
    const totals = sellerEarnings(rows);
    expect(totals.cashback.year).toBe(20);
    expect(totals.cashback.today).toBe(20);
    expect(totals.cashback.total).toBe(35);
    expect(totals.total.total).toBe(35);
  });

  it("nets lifetime admin earnings against lifetime expenses", () => {
    const rows = [
      earning("admin_shop_margin", 70, daysAgo(0)),
      earning("admin_shop_margin", 70, lastYear),
    ];
    const net = adminNetEarnings(rows, [expense(40, lastYear)]);
    expect(net.earnings.total).toBe(140);
    expect(net.expenses.total).toBe(40);
    expect(net.net.total).toBe(100);
    expect(net.net.year).toBe(70);
  });

  it("keeps the 20 / 10 / 70 allocation split by recipient", () => {
    const sub = sellerEarnings([earning("sale_cashback", 20, daysAgo(0))]);
    const upline = sellerEarnings([earning("upline_commission", 10, daysAgo(0))]);
    const admin = adminNetEarnings([earning("admin_shop_margin", 70, daysAgo(0))], []);
    expect(sub.total.total + upline.total.total + admin.earnings.total).toBe(100);
    expect(admin.earnings.total).toBe(70);
  });

  it("ignores reversed purchases everywhere, including the lifetime total", () => {
    const reversed = { ...earning("sale_cashback", 50, daysAgo(1)), status: "reversed" as const };
    const totals = sellerEarnings([reversed, earning("sale_cashback", 20, daysAgo(0))]);
    expect(totals.cashback.total).toBe(20);
  });
});

/**
 * Admin income is the shop's retained remainder of a completed purchase — the
 * admin cashback the purchase engine credits to the admin wallet. The ledger
 * reports it as one `admin_shop_margin` row per sale, so it must be counted
 * exactly once and never mixed into reseller/subreseller cashback.
 *
 * The splits below are configuration-driven examples, not fixed rates.
 */
describe("₱100 allocation across roles", () => {
  const scenario = (subPct: number, resRemainderPct: number) => {
    const sale = 100;
    const subCashback = (sale * subPct) / 100;
    const uplineShare = (sale * resRemainderPct) / 100;
    const adminRemainder = sale - subCashback - uplineShare;
    return {
      sale,
      sub: sellerEarnings([earning("sale_cashback", subCashback, daysAgo(0))]),
      res: sellerEarnings([earning("upline_commission", uplineShare, daysAgo(0))]),
      admin: adminNetEarnings([earning("admin_shop_margin", adminRemainder, daysAgo(0))], []),
      adminRemainder,
    };
  };

  it("20% subreseller under a 30% reseller: 20 / 10 / 70", () => {
    const s = scenario(20, 10);
    expect(s.sub.cashback.total).toBe(20);
    expect(s.res.cashback.total).toBe(10);
    expect(s.admin.earnings.total).toBe(70);
    expect(s.sub.total.total + s.res.total.total + s.admin.earnings.total).toBe(s.sale);
  });

  it("follows a different configuration: 10% subreseller under a 40% reseller", () => {
    const s = scenario(10, 30);
    expect(s.sub.cashback.total).toBe(10);
    expect(s.res.cashback.total).toBe(30);
    expect(s.admin.earnings.total).toBe(60);
    expect(s.sub.total.total + s.res.total.total + s.admin.earnings.total).toBe(s.sale);
  });

  it("counts admin cashback once and keeps it out of seller earnings", () => {
    const adminRow = earning("admin_shop_margin", 70, daysAgo(0));
    // The admin's own retained cashback must never show up as seller cashback.
    expect(sellerEarnings([adminRow]).total.total).toBe(0);
    // And it must not be added a second time alongside downline cashback.
    const admin = adminNetEarnings([adminRow, earning("sale_cashback", 20, daysAgo(0))], []);
    expect(admin.earnings.total).toBe(70);
  });
});

