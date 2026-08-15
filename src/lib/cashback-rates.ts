/**
 * Individual cashback / sales rates.
 *
 * Rates are per member, per shop — there is no bulk "apply to all" control any
 * more. The database (`set_member_cashback_rate`) is the authority: it checks
 * the operator's permission, refuses self-edits, keeps a subreseller plus its
 * reseller at or below 100%, and writes an audit entry. Everything here is
 * presentation-level convenience only.
 */
import { supabase } from "@/integrations/supabase/client";

/** Roles that can earn cashback at all. */
export type RateRole = "reseller" | "subreseller";

/** Client-side guard mirroring the database rule (0–100, whole numbers). */
export function validateCashbackRate(value: number): string | null {
  if (!Number.isFinite(value)) return "Enter a percentage between 0 and 100.";
  if (!Number.isInteger(value)) return "Use whole percentages only.";
  if (value < 0 || value > 100) return "Cashback must be between 0% and 100%.";
  return null;
}

/**
 * The shop admin always receives everything outside the parent reseller's
 * *total* configured share. A subreseller's share is carved out of that same
 * total, so it never changes the admin's remainder.
 */
export function adminRemainder(resellerTotalPct: number, _subresellerPct = 0): number {
  return Math.max(0, 100 - Math.max(0, Math.min(100, resellerTotalPct)));
}

/** The parent reseller keeps whatever is left of their total share. */
export function parentShare(resellerTotalPct: number, subresellerPct: number): number {
  return Math.max(0, Math.max(0, resellerTotalPct) - Math.max(0, subresellerPct));
}

/**
 * Plain-language preview of a purchase split.
 * `resellerTotalPct` is the parent reseller's total configured share, and
 * `subresellerPct` is the part of that total taken by the subreseller.
 */
export function describeSplit(amount: number, resellerTotalPct: number, subresellerPct: number) {
  const total = Math.max(0, Math.min(100, resellerTotalPct));
  const sub = Math.min(Math.max(0, subresellerPct), total);
  const subreseller = Math.round(amount * sub) / 100;
  const reseller = Math.round(amount * (total - sub)) / 100;
  const admin = Math.round((amount - reseller - subreseller) * 100) / 100;
  return { reseller, subreseller, admin: Math.max(0, admin) };
}

export interface CashbackSplitPreview {
  role: string;
  own: number;
  parent_id: string | null;
  parent_total: number;
  parent_share: number;
  admin_share: number;
  max_subreseller?: number;
}

/** Server-resolved split for one member in one shop (chain-aware). */
export async function fetchCashbackSplitPreview(
  userId: string,
  ecosystemId: string,
): Promise<CashbackSplitPreview | null> {
  const { data, error } = await supabase.rpc("cashback_split_preview", {
    _user_id: userId,
    _ecosystem_id: ecosystemId,
  });
  if (error || !data) return null;
  return data as unknown as CashbackSplitPreview;
}


/** Current individual rate of one member in one shop. */
export async function fetchMemberCashbackRate(
  userId: string,
  ecosystemId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("member_cashback_rate", {
    _user_id: userId,
    _ecosystem_id: ecosystemId,
  });
  if (error) return 0;
  return Number(data ?? 0);
}

/** Sets one member's rate. Future qualifying purchases only. */
export async function setMemberCashbackRate(
  userId: string,
  ecosystemId: string,
  percent: number,
  reason?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("set_member_cashback_rate", {
    _user_id: userId,
    _ecosystem_id: ecosystemId,
    _percent: Math.trunc(percent),
    // `null` clears the reason; the generated type narrows it to string.
    _reason: (reason?.trim() || null) as unknown as string,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? percent);
}
