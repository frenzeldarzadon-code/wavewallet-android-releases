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
