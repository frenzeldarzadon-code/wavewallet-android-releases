/**
 * Where a cashback came from.
 *
 * The origin is NOT guessed: `voucher_sales.buyer_role` is the role snapshot
 * taken when the sale happened, and `cashback_sale_sources` returns it only for
 * sales the caller is actually party to (buyer, cashback recipient, upline,
 * seller, or that shop's admin). When the source cannot be read we keep the
 * existing wording rather than inventing one.
 */
import { supabase } from "@/integrations/supabase/client";

/** sale_id → buyer role snapshot of that sale. */
export type CashbackSourceMap = Record<string, string>;

const LABELS: Record<string, string> = {
  customer: "Customer Purchase",
  reseller: "Reseller Purchase",
  subreseller: "Subreseller Purchase",
  admin: "Admin Purchase",
  super_admin: "Admin Purchase",
};

/** Human label for a buyer role snapshot, or null when it is unknown. */
export function sourceLabelForRole(role: string | null | undefined): string | null {
  if (!role) return null;
  return LABELS[role] ?? null;
}

/** Source label for one cashback entry, using only data that already exists. */
export function cashbackSourceLabel(
  saleId: string | null | undefined,
  sources: CashbackSourceMap,
): string | null {
  if (!saleId) return null;
  return sourceLabelForRole(sources[saleId]);
}

/** Batch read (one request) of the buyer role behind each cashback sale. */
export async function fetchCashbackSources(saleIds: string[]): Promise<CashbackSourceMap> {
  const ids = Array.from(new Set(saleIds.filter(Boolean)));
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc("cashback_sale_sources", { _sale_ids: ids });
  if (error || !data) return {};
  const map: CashbackSourceMap = {};
  for (const row of data as { sale_id: string; buyer_role: string | null }[]) {
    if (row.sale_id && row.buyer_role) map[row.sale_id] = row.buyer_role;
  }
  return map;
}
