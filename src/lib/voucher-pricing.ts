/**
 * Universe voucher platform fee — presentation mirror of the database helpers
 * `voucher_seller_cut`, `voucher_platform_fee_amount` and
 * `voucher_price_from_seller_cut`. The database is authoritative; these only
 * let the product editor and checkout show the same numbers the ledger will.
 *
 * The fee is PRICE-INCLUSIVE: the customer pays exactly the displayed price,
 * the seller's cut is price ÷ (1 + fee) rounded once to 2 dp, and the fee is
 * the exact remainder — so cut + fee always equals the price.
 */
import { supabase } from "@/integrations/supabase/client";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const rate = (feePercent: number) => 1 + Math.max(0, Number(feePercent) || 0) / 100;

/** Seller's cut hidden inside a customer price (Set Retail Price mode). */
export const sellerCutFromRetail = (customerPrice: number, feePercent: number) =>
  round2((Number(customerPrice) || 0) / rate(feePercent));

/** Fee contained in a customer price — always the exact remainder. */
export const platformFeeFromRetail = (customerPrice: number, feePercent: number) =>
  round2((Number(customerPrice) || 0) - sellerCutFromRetail(customerPrice, feePercent));

/** Customer price that yields a wanted seller's cut (Set Seller's Cut mode). */
export const retailFromSellerCut = (sellerCut: number, feePercent: number) =>
  round2((Number(sellerCut) || 0) * rate(feePercent));

/** Which field the seller is typing in; the other is always derived. */
export type VoucherPriceMode = "retail" | "seller_cut";

export const DEFAULT_VOUCHER_FEE_PERCENT = 1;

/** Current platform-wide Universe voucher fee (new/re-priced products snapshot it). */
export async function fetchVoucherPlatformFeePercent(): Promise<number> {
  const { data, error } = await supabase.rpc("voucher_platform_fee_percent");
  if (error || data === null || data === undefined) return DEFAULT_VOUCHER_FEE_PERCENT;
  return Number(data);
}
