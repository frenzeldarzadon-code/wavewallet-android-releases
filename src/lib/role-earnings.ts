/**
 * Role-specific dashboard earnings, derived from one shared set of records.
 *
 * Accounting rules enforced here (and covered by tests):
 *  - Credit issuance, approved cash in, wallet transfers and withdrawal
 *    holds/releases are NEVER earnings for anybody.
 *  - Reseller / subreseller earnings = cashback actually earned on completed
 *    downline purchases, plus the wholesale discount benefit, nothing else.
 *  - Admin earnings = the shop's retained share of completed sales, less
 *    recorded shop expenses.
 *  - Super Admin earnings = collected cash-out fees only, less recorded
 *    platform expenses.
 *  - Reversed / refunded records never count; historical snapshots are used
 *    as-is and never recomputed.
 */
import {
  addPeriods,
  periodTotals,
  periodTotalsOf,
  subtractPeriods,
  type EarningRow,
  type EarningType,
  type PeriodTotals,
} from "@/lib/earnings";
import { expensePeriodTotals, type ExpenseRow } from "@/lib/expenses";
import { feePeriodTotals, type CashOutFeeRow } from "@/lib/platform-earnings";

/** Cashback a reseller/subreseller actually earned from downline purchases. */
export const CASHBACK_EARNING_TYPES: EarningType[] = ["sale_cashback", "upline_commission"];
/** Value saved through the wholesale discount on their own purchases. */
export const DISCOUNT_EARNING_TYPES: EarningType[] = ["wholesale_discount"];

export interface SellerEarnings {
  cashback: PeriodTotals;
  discount: PeriodTotals;
  total: PeriodTotals;
}

export function sellerEarnings(rows: EarningRow[]): SellerEarnings {
  const cashback = periodTotals(rows, CASHBACK_EARNING_TYPES);
  const discount = periodTotals(rows, DISCOUNT_EARNING_TYPES);
  return { cashback, discount, total: addPeriods(cashback, discount) };
}

export interface PointsEarningRow {
  entry_type: string;
  direction: "credit" | "debit";
  amount: number;
  created_at: string;
}

/** Customer dashboards show points earned only — no credit/cash derivations. */
export function pointsEarnings(rows: PointsEarningRow[]): PeriodTotals {
  return periodTotalsOf(
    rows.filter((r) => r.entry_type === "earn" && r.direction === "credit"),
    (r) => r.created_at,
    (r) => r.amount,
  );
}

export interface NetEarnings {
  earnings: PeriodTotals;
  expenses: PeriodTotals;
  net: PeriodTotals;
}

/** Admin: retained shop margin from completed sales, less shop expenses. */
export function adminNetEarnings(rows: EarningRow[], expenses: ExpenseRow[]): NetEarnings {
  const earnings = periodTotals(rows, ["admin_shop_margin"]);
  const spent = expensePeriodTotals(expenses);
  return { earnings, expenses: spent, net: subtractPeriods(earnings, spent) };
}

/** Super Admin: collected cash-out fees only, less platform expenses. */
export function platformNetEarnings(
  fees: CashOutFeeRow[],
  expenses: ExpenseRow[],
): NetEarnings {
  const earnings = feePeriodTotals(fees);
  const spent = expensePeriodTotals(expenses);
  return { earnings, expenses: spent, net: subtractPeriods(earnings, spent) };
}
