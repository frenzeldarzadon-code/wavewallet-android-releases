/**
 * Sales attribution — reporting only.
 *
 * A voucher sale belongs to the member who GENERATED it (the admin, reseller
 * or subreseller who bought it from the shop: voucher_sales.buyer_id). It is
 * never moved to an upline because that upline earned cashback or commission
 * on it — cashback is an earning, never a sale. The database function
 * `voucher_sales_attribution` already scopes rows by hierarchy:
 *  - subreseller → own sales only
 *  - reseller    → own + their own subresellers' sales
 *  - admin       → own + every reseller/subreseller sale in the shop
 * Each sale is returned exactly once, tagged "own" or "network".
 */
import { supabase } from "@/integrations/supabase/client";

export interface AttributedSale {
  sale_id: string;
  occurred_at: string;
  generator_id: string;
  generator_name: string;
  generator_role: string;
  quantity: number;
  sale_amount: number;
  scope: "own" | "network";
}

export interface SalesFigure {
  sales: number;
  vouchers: number;
  amount: number;
}

export interface NetworkGenerator extends SalesFigure {
  id: string;
  name: string;
  role: string;
}

export interface SalesAttribution {
  own: SalesFigure;
  network: SalesFigure;
  combined: SalesFigure;
  byGenerator: NetworkGenerator[];
}

const zero = (): SalesFigure => ({ sales: 0, vouchers: 0, amount: 0 });

export function summariseAttribution(rows: AttributedSale[]): SalesAttribution {
  const own = zero();
  const network = zero();
  const gens = new Map<string, NetworkGenerator>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.sale_id)) continue; // never count one sale twice
    seen.add(r.sale_id);
    const bucket = r.scope === "own" ? own : network;
    bucket.sales += 1;
    bucket.vouchers += Number(r.quantity) || 0;
    bucket.amount += Number(r.sale_amount) || 0;
    if (r.scope === "network") {
      const g = gens.get(r.generator_id) ?? {
        id: r.generator_id,
        name: r.generator_name,
        role: r.generator_role,
        ...zero(),
      };
      g.sales += 1;
      g.vouchers += Number(r.quantity) || 0;
      g.amount += Number(r.sale_amount) || 0;
      gens.set(r.generator_id, g);
    }
  }
  return {
    own,
    network,
    combined: {
      sales: own.sales + network.sales,
      vouchers: own.vouchers + network.vouchers,
      amount: own.amount + network.amount,
    },
    byGenerator: [...gens.values()].sort((a, b) => b.amount - a.amount),
  };
}

export async function fetchSalesAttribution(ecosystemId: string): Promise<AttributedSale[]> {
  const out: AttributedSale[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .rpc("voucher_sales_attribution", { _ecosystem: ecosystemId })
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as AttributedSale[]));
    if (!data || data.length < page) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Projected vs Actual sales for a date range (reporting only).
//  - Projected: attributed sales whose SALE date is inside the range.
//  - Actual: the same attributed sales, counting only codes whose FIRST-USE
//    time is inside the range (a voucher sold earlier but used in the range
//    counts here). Each used code is worth sale_amount ÷ quantity, so a sale is
//    never counted for more than its own value and never twice.
// ---------------------------------------------------------------------------
import { lookupOmadaVoucherStatuses } from "@/lib/omada-vouchers.functions";
import type { VoucherState } from "@/lib/omada-voucher-view";

export interface SaleCode {
  sale_id: string;
  code: string;
  first_used_at: string | null;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface RangedSales {
  projected: SalesAttribution;
  actual: SalesAttribution;
  /** Used codes whose first-use time is unknown, so they can't be placed in a period. */
  usedUndated: number;
}

const inRange = (iso: string, r: DateRange) => {
  const t = Date.parse(iso);
  return t >= r.start.getTime() && t <= r.end.getTime();
};

export function rangedSales(
  rows: AttributedSale[],
  codes: SaleCode[],
  statuses: Record<string, VoucherState | null>,
  usedAt: Record<string, string>,
  range: DateRange,
): RangedSales {
  const bySale = new Map<string, SaleCode[]>();
  for (const c of codes) {
    const list = bySale.get(c.sale_id) ?? [];
    if (!list.some((x) => x.code === c.code)) list.push(c);
    bySale.set(c.sale_id, list);
  }
  const projectedRows = rows.filter((r) => inRange(r.occurred_at, range));
  const actualRows: AttributedSale[] = [];
  let usedUndated = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.sale_id)) continue;
    seen.add(r.sale_id);
    const list = bySale.get(r.sale_id) ?? [];
    const qty = Number(r.quantity) || list.length;
    if (!qty) continue;
    let used = 0;
    for (const c of list) {
      const st = statuses[c.code];
      if (st !== "in_use" && st !== "expired") continue;
      const at = usedAt[c.code] ?? c.first_used_at;
      if (!at) {
        usedUndated += 1;
        continue;
      }
      if (inRange(at, range)) used += 1;
    }
    if (used === 0) continue;
    actualRows.push({
      ...r,
      quantity: used,
      sale_amount: ((Number(r.sale_amount) || 0) * used) / qty,
    });
  }
  return {
    projected: summariseAttribution(projectedRows),
    actual: summariseAttribution(actualRows),
    usedUndated,
  };
}

export async function fetchAttributedCodes(ecosystemId: string): Promise<SaleCode[]> {
  const out: SaleCode[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .rpc("voucher_sales_attribution_codes", { _ecosystem: ecosystemId })
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as SaleCode[]));
    if (!data || data.length < page) break;
  }
  return out;
}

/** Current state + first-use time for codes, via the existing controller lookup. */
export async function fetchCodeUsage(
  ecosystemId: string,
  codes: string[],
): Promise<{ statuses: Record<string, VoucherState | null>; usedAt: Record<string, string> }> {
  const statuses: Record<string, VoucherState | null> = {};
  const usedAt: Record<string, string> = {};
  const unique = Array.from(new Set(codes));
  for (let i = 0; i < unique.length; i += 500) {
    try {
      const res = await lookupOmadaVoucherStatuses({
        data: { ecosystemId, codes: unique.slice(i, i + 500) },
      });
      Object.assign(statuses, res.statuses);
      Object.assign(usedAt, res.usedAt ?? {});
    } catch {
      // Unknown status never counts as used.
    }
  }
  return { statuses, usedAt };
}
