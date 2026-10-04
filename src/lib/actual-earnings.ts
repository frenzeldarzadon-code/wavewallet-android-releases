/**
 * "Actual" earnings — a reporting-only view over the SAME earnings rows that
 * produce the Projected (existing) total. Nothing here writes or recalculates
 * a ledger, cashback or fee.
 *
 * A row counts only when:
 *  - it comes from a voucher sale (retail and other rows are excluded),
 *  - the buyer was an admin, reseller or subreseller at sale time
 *    (voucher_sales.buyer_role snapshot), and
 *  - the sale's codes are confirmed used by the existing Omada status lookup.
 * Each qualifying row contributes earning_amount × (used codes ÷ codes in the
 * sale), so a sale with 2 of 5 codes used contributes exactly 2/5 of what it
 * already contributes to Projected. Cashback is never added a second time.
 */
import { supabase } from "@/integrations/supabase/client";
import { periodTotalsOf, subtractPeriods, type EarningRow, type EarningType, type PeriodTotals } from "@/lib/earnings";
import { lookupOmadaVoucherStatuses } from "@/lib/omada-vouchers.functions";
import type { VoucherState } from "@/lib/omada-voucher-view";

export const ACTUAL_BUYER_ROLES = ["admin", "reseller", "subreseller"] as const;

/**
 * Omada states that prove a code was used. A code only reaches "expired" on
 * this platform once its usage timer has run out after first use.
 */
export function isUsedState(state: VoucherState | null | undefined): boolean {
  return state === "in_use" || state === "expired";
}

export interface SaleUsage {
  buyerRole: string;
  codes: string[];
}

export function actualEarningRows(
  rows: EarningRow[],
  sales: Map<string, SaleUsage>,
  statuses: Record<string, VoucherState | null>,
  types?: EarningType[],
): { row: EarningRow; amount: number }[] {
  const out: { row: EarningRow; amount: number }[] = [];
  for (const r of rows) {
    if (r.status === "reversed" || !r.sale_id) continue;
    if (types && !types.includes(r.earning_type)) continue;
    const sale = sales.get(r.sale_id);
    if (!sale || sale.codes.length === 0) continue;
    if (!(ACTUAL_BUYER_ROLES as readonly string[]).includes(sale.buyerRole)) continue;
    const used = sale.codes.filter((c) => isUsedState(statuses[c.toUpperCase()])).length;
    if (used === 0) continue;
    out.push({ row: r, amount: (r.earning_amount * used) / sale.codes.length });
  }
  return out;
}

export function actualPeriodTotals(
  rows: EarningRow[],
  sales: Map<string, SaleUsage>,
  statuses: Record<string, VoucherState | null>,
  types?: EarningType[],
): PeriodTotals {
  return periodTotalsOf(
    actualEarningRows(rows, sales, statuses, types),
    (x) => x.row.occurred_at,
    (x) => x.amount,
  );
}

const ID_CHUNK = 200;
const CODE_CHUNK = 500;

/** Loads buyer roles, codes and current statuses for the sales behind `rows`. */
export async function fetchSaleUsage(rows: EarningRow[]): Promise<{
  sales: Map<string, SaleUsage>;
  statuses: Record<string, VoucherState | null>;
}> {
  const ids = Array.from(new Set(rows.map((r) => r.sale_id).filter((x): x is string => !!x)));
  const sales = new Map<string, SaleUsage>();
  const shopOf = new Map<string, string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data: saleRows } = await supabase
      .from("voucher_sales")
      .select("id, buyer_role, ecosystem_id")
      .in("id", chunk);
    for (const s of saleRows ?? []) {
      if (!(ACTUAL_BUYER_ROLES as readonly string[]).includes(String(s.buyer_role))) continue;
      sales.set(s.id, { buyerRole: String(s.buyer_role), codes: [] });
      shopOf.set(s.id, s.ecosystem_id);
    }
  }
  const qualifying = Array.from(sales.keys());
  for (let i = 0; i < qualifying.length; i += ID_CHUNK) {
    const { data: codeRows } = await supabase
      .from("voucher_codes")
      .select("code, sale_id")
      .in("sale_id", qualifying.slice(i, i + ID_CHUNK));
    for (const c of codeRows ?? []) {
      if (c.sale_id && c.code) sales.get(c.sale_id)?.codes.push(String(c.code).toUpperCase());
    }
  }
  const byShop = new Map<string, string[]>();
  for (const [id, s] of sales) {
    const shop = shopOf.get(id);
    if (!shop) continue;
    const list = byShop.get(shop) ?? [];
    list.push(...s.codes);
    byShop.set(shop, list);
  }
  const statuses: Record<string, VoucherState | null> = {};
  for (const [ecosystemId, codes] of byShop) {
    for (let i = 0; i < codes.length; i += CODE_CHUNK) {
      try {
        const res = await lookupOmadaVoucherStatuses({
          data: { ecosystemId, codes: codes.slice(i, i + CODE_CHUNK) },
        });
        Object.assign(statuses, res.statuses);
      } catch {
        // Unknown status never counts as used.
      }
    }
  }
  return { sales, statuses };
}

/**
 * Actual Total Earnings per period = used-voucher share of the SAME earning
 * rows Projected uses, less the SAME recorded expenses Projected deducts.
 * Expenses are passed in once (already period-bucketed), so they are never
 * deducted twice. Never clamped: a loss stays a loss.
 */
export function actualNetPeriodTotals(
  rows: EarningRow[],
  sales: Map<string, SaleUsage>,
  statuses: Record<string, VoucherState | null>,
  types: EarningType[] | undefined,
  expenses: PeriodTotals,
): PeriodTotals {
  return subtractPeriods(actualPeriodTotals(rows, sales, statuses, types), expenses);
}

/** Money with its sign kept, so a loss never reads as a profit. */
export function signedPeso(n: number): string {
  const abs = `₱${Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < -0.004 ? `−${abs}` : abs;
}
