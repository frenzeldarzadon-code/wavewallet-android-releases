/**
 * Product & reward ratings.
 *
 * Ratings are never free-standing: the database only accepts a rating that is
 * tied to a completed voucher sale or a claimed reward redemption owned by the
 * caller, and it keeps one rating per transaction. Nothing here can fabricate
 * or duplicate a score — the RPCs re-check ownership and eligibility.
 */
import { supabase } from "@/integrations/supabase/client";
import { friendlyWalletError } from "@/lib/wallet";

export interface RatingSummary {
  rating_avg: number;
  rating_count: number;
}

/** Rounds a raw average for display without inventing precision. */
export function ratingLabel(avg: number | null | undefined, count: number): string | null {
  if (!count || !avg) return null;
  return (Math.round(Number(avg) * 10) / 10).toFixed(1);
}

/** "12 sold" / "1 sold" — never shown when nothing has been sold yet. */
export function soldLabel(count: number | null | undefined): string | null {
  const n = Number(count ?? 0);
  return n > 0 ? `${n.toLocaleString()} sold` : null;
}

export async function rateVoucherSale(saleId: string, rating: number, comment?: string) {
  const { error } = await supabase.rpc("rate_voucher_sale", {
    _sale_id: saleId,
    _rating: rating,
    ...(comment ? { _comment: comment } : {}),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
}

export async function rateRewardRedemption(redemptionId: string, rating: number, comment?: string) {
  const { error } = await supabase.rpc("rate_reward_redemption", {
    _redemption_id: redemptionId,
    _rating: rating,
    ...(comment ? { _comment: comment } : {}),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
}
