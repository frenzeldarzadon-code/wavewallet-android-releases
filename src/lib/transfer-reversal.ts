/**
 * Credit transfer reversal (dispute handling).
 *
 * A reversal NEVER edits or deletes the original ledger rows. The database
 * writes a linked pair of correction entries (debit the recipient, credit the
 * sender back) inside one transaction, records the reversal in
 * `credit_transfer_reversals` and audit-logs the action.
 *
 * Rules enforced server-side and mirrored here for the UI:
 *  - Only credit transfers. Voucher sales use the refund workflow.
 *  - At most one reversal per transfer (idempotent by original tx id).
 *  - Only the unencumbered part of the transfer (the untouched credit lot) may
 *    be reversed — never credits already spent or passed onward.
 *  - Reversals generate no commission, cashback, points, discounts or earnings.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CreditEntry } from "@/lib/wallet";

export const REVERSAL_REASONS = [
  "Dispute / customer complaint",
  "Duplicate transfer",
  "Wrong recipient",
  "Wrong amount",
  "Fraud / unauthorized transfer",
  "Admin correction",
  "Other",
] as const;

export const SPENT_MESSAGE =
  "Cannot reverse automatically because some credits have already been spent or transferred.";

export interface ReversalInfo {
  eligible: boolean;
  code: "ok" | "already_reversed" | "no_unspent_credit" | "not_found" | "not_a_transfer" | "forbidden";
  message: string | null;
  tx_id?: string;
  ecosystem_id?: string;
  sender_id?: string;
  sender_name?: string;
  recipient_id?: string;
  recipient_name?: string;
  amount?: number;
  created_at?: string;
  note?: string | null;
  recipient_balance?: number;
  available?: number;
  reversed_amount?: number;
  reversal_kind?: "full" | "partial" | null;
  reversal_tx_id?: string | null;
  reversal_reason?: string | null;
  reversed_at?: string | null;
  reversed_by?: string | null;
}

/** Transfer ledger rows are the only entries this feature may act on. */
export function isReversibleTransferEntry(e: Pick<CreditEntry, "direction" | "reason" | "sale_id" | "entry_kind" | "tx_id">): boolean {
  if (e.direction !== "debit") return false;
  if (e.sale_id) return false;
  if (e.entry_kind && e.entry_kind !== "general" && e.entry_kind !== "transfer") return false;
  if (!e.tx_id) return false;
  return e.reason === "Credit transfer sent";
}

export interface AmountCheck {
  ok: boolean;
  kind: "full" | "partial" | null;
  error: string | null;
}

/**
 * Validates an operator-entered reversal amount against the original transfer
 * and the amount still attributable to it in the recipient's wallet.
 */
export function validateReversalAmount(input: {
  amount: number;
  original: number;
  available: number;
}): AmountCheck {
  const { amount, original, available } = input;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, kind: null, error: "Enter a positive amount" };
  }
  if (available <= 0) return { ok: false, kind: null, error: SPENT_MESSAGE };
  if (amount > original + 1e-9) {
    return { ok: false, kind: null, error: "Reversal cannot exceed the original transfer" };
  }
  if (amount > available + 1e-9) return { ok: false, kind: null, error: SPENT_MESSAGE };
  return {
    ok: true,
    kind: Math.abs(amount - original) < 1e-9 ? "full" : "partial",
    error: null,
  };
}

/** Human status for a transfer row in history/audit views. */
export function reversalStatusLabel(info: {
  reversed_amount?: number;
  amount?: number;
  reversal_kind?: string | null;
}): "Original transfer" | "Reversed" | "Partially reversed" {
  const reversed = Number(info.reversed_amount ?? 0);
  if (reversed <= 0) return "Original transfer";
  return info.reversal_kind === "partial" ? "Partially reversed" : "Reversed";
}

/** Amount that could still be reversed on an untouched transfer. */
export function remainingReversible(info: {
  amount?: number;
  available?: number;
  reversed_amount?: number;
}): number {
  if (Number(info.reversed_amount ?? 0) > 0) return 0;
  return Math.max(0, Math.min(Number(info.amount ?? 0), Number(info.available ?? 0)));
}

/* ------------------------------------------------------------------ */
/* Server calls                                                        */
/* ------------------------------------------------------------------ */

export async function fetchReversalInfo(txId: string): Promise<ReversalInfo> {
  const { data, error } = await supabase.rpc("transfer_reversal_info", { _tx_id: txId });
  if (error) throw new Error(error.message);
  const info = data as unknown as ReversalInfo;
  const num = (v: unknown) => (v === undefined || v === null ? undefined : Number(v));
  const out: ReversalInfo = { ...info };
  const amount = num(info.amount);
  if (amount !== undefined) out.amount = amount;
  const available = num(info.available);
  if (available !== undefined) out.available = available;
  const bal = num(info.recipient_balance);
  if (bal !== undefined) out.recipient_balance = bal;
  const reversed = num(info.reversed_amount);
  if (reversed !== undefined) out.reversed_amount = reversed;
  return out;
}

export async function reverseCreditTransfer(input: {
  txId: string;
  amount: number;
  reason: string;
  note?: string;
}): Promise<{ reversal_tx_id: string; kind: "full" | "partial"; amount: number }> {
  const { data, error } = await supabase.rpc("reverse_credit_transfer", {
    _tx_id: input.txId,
    _amount: input.amount,
    _reason: input.reason,
    _note: input.note ?? null,
  } as never);
  if (error) throw new Error(error.message);
  const res = data as unknown as { reversal_tx_id: string; kind: "full" | "partial"; amount: number };
  return { ...res, amount: Number(res.amount) };
}

export interface ReversalRecord {
  id: string;
  original_tx_id: string;
  reversal_tx_id: string;
  sender_id: string;
  recipient_id: string;
  original_amount: number;
  reversed_amount: number;
  kind: "full" | "partial";
  reason: string;
  note: string | null;
  actor_name: string;
  created_at: string;
}

export async function fetchReversalHistory(
  ecosystemId: string,
  limit = 50,
): Promise<ReversalRecord[]> {
  const { data } = await supabase
    .from("credit_transfer_reversals")
    .select(
      "id, original_tx_id, reversal_tx_id, sender_id, recipient_id, original_amount, reversed_amount, kind, reason, note, actor_name, created_at",
    )
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as ReversalRecord[]).map((r) => ({
    ...r,
    original_amount: Number(r.original_amount),
    reversed_amount: Number(r.reversed_amount),
  }));
}
