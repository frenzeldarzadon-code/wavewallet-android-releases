/**
 * Reseller downline management — the reseller's OWN subresellers only.
 *
 * Reads go through two SECURITY DEFINER RPCs that re-derive the caller from
 * `effective_uid()`, require an active `reseller` role and check the target's
 * `reseller_id` inside the caller's shop. The client never picks whose ledger
 * it reads: it can only ask for a member the database already agrees it owns.
 */
import { supabase } from "@/integrations/supabase/client";
import { friendlyWalletError } from "@/lib/wallet";

export interface SubresellerRow {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  phone: string;
  masked_email: string;
  status: string;
  balance: number;
  joined_at: string;
}

export interface SubresellerLedgerEntry {
  id: string;
  direction: "coin" | "debit";
  amount: number;
  balance_after: number;
  reason: string;
  reference: string | null;
  tx_id: string | null;
  created_at: string;
}

/** Every subreseller owned by the signed-in reseller, with shop wallet balances. */
export async function listOwnSubresellers(): Promise<SubresellerRow[]> {
  const { data, error } = await supabase.rpc("reseller_list_subresellers");
  if (error) throw new Error(friendlyWalletError(error.message));
  return ((data ?? []) as unknown as SubresellerRow[]).map((r) => ({
    ...r,
    balance: Number(r.balance ?? 0),
  }));
}

/** Read-only credit history of ONE owned subreseller — all movements, newest first. */
export async function fetchSubresellerLedger(
  userId: string,
  limit = 100,
): Promise<SubresellerLedgerEntry[]> {
  const { data, error } = await supabase.rpc("reseller_subreseller_ledger", {
    _user_id: userId,
    _limit: limit,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return ((data ?? []) as unknown as SubresellerLedgerEntry[]).map((e) => ({
    ...e,
    amount: Number(e.amount),
    balance_after: Number(e.balance_after),
  }));
}

export interface DownlineTotals {
  count: number;
  balance: number;
  active: number;
}

export function downlineTotals(rows: SubresellerRow[]): DownlineTotals {
  return {
    count: rows.length,
    balance: rows.reduce((sum, r) => sum + Number(r.balance || 0), 0),
    active: rows.filter((r) => r.status === "active").length,
  };
}

/** Client-side guard rails only — the database is still the authorization layer. */
export function validateSubresellerTransfer(input: {
  target: SubresellerRow | null;
  amount: number;
  balance: number;
}): string | null {
  if (!input.target) return "Pick a subreseller first.";
  if (input.target.status !== "active") return "That subreseller account is suspended.";
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "Enter a positive amount.";
  if (input.amount > input.balance) return "Amount exceeds your reseller balance.";
  return null;
}
