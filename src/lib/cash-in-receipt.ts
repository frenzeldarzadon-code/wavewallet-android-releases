/**
 * Cash In receipt verification — SECONDARY protection.
 *
 * The authoritative payment reference is the one READ OFF the uploaded GCash
 * receipt, not the one the member typed. The typed value is only ever compared
 * against it:
 *   - both agree            -> `matched`   (automatic approval may proceed)
 *   - they differ           -> `mismatch`  (pending, "Reference does not match receipt")
 *   - the receipt cannot be read reliably -> `unreadable` (pending, never guessed)
 *
 * The PRIMARY payment match is unchanged and lives elsewhere: the sending GCash
 * number and the exact amount must match a real notification seen by a paired
 * listener phone on the shop's configured receiving account.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePaymentReference, normalizePhMobile } from "./cash-in-auto";

export type ReceiptCheck = "pending" | "matched" | "mismatch" | "unreadable" | "error" | "skipped";

/** What a reader (OCR / vision model) claims it saw on the receipt. */
export interface ReceiptReading {
  reference: string | null;
  amountPhp: number | null;
  senderNumber: string | null;
  /** The reader's own confidence that it read the reference correctly, 0..1. */
  confidence: number;
  readable: boolean;
}

/** Below this we treat the reading as unreadable rather than guess. */
export const RECEIPT_MIN_CONFIDENCE = 0.6;

export const RECEIPT_CHECK_LABEL: Record<ReceiptCheck, string> = {
  pending: "Reading the receipt…",
  matched: "Reference matches the receipt.",
  mismatch: "Reference does not match receipt",
  unreadable: "The reference could not be read from the receipt — manual review.",
  error: "The receipt could not be checked — manual review.",
  skipped: "The receipt was not checked automatically.",
};

/**
 * Turn whatever the reader returned into a decision. Anything doubtful becomes
 * `unreadable`; nothing is ever inferred from the typed value.
 */
export function decideReceiptCheck(typedReference: string | null | undefined, reading: ReceiptReading): ReceiptCheck {
  const typed = normalizePaymentReference(typedReference);
  const read = normalizePaymentReference(reading.reference);
  if (!reading.readable || !read || reading.confidence < RECEIPT_MIN_CONFIDENCE) return "unreadable";
  if (!typed) return "mismatch";
  return read === typed ? "matched" : "mismatch";
}

/** Does the number on the receipt agree with the number the member said they paid from? */
export function receiptSenderAgrees(
  submittedSender: string | null | undefined,
  receiptSender: string | null | undefined,
): boolean | null {
  const a = normalizePhMobile(submittedSender);
  const b = normalizePhMobile(receiptSender);
  if (!a || !b) return null;
  return a === b;
}

const numeric = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v === "" || /^(null|none|n\/a|unknown)$/i.test(v) ? null : v;
};

/**
 * Parse the reader's JSON answer defensively — a model may wrap it in prose or
 * a code fence. Anything we cannot parse is an unreadable receipt, never a
 * guess.
 */
export function parseReceiptReading(raw: string): ReceiptReading {
  const unreadable: ReceiptReading = {
    reference: null,
    amountPhp: null,
    senderNumber: null,
    confidence: 0,
    readable: false,
  };
  const body = raw.replace(/```json/gi, "```").split("```").find((part) => part.includes("{")) ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return unreadable;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return unreadable;
  }
  const reference = text(parsed["reference"]);
  const confidenceValue = numeric(parsed["confidence"]);
  const confidence = confidenceValue === null ? (reference ? 1 : 0) : Math.min(confidenceValue, 1);
  return {
    reference,
    amountPhp: numeric(parsed["amount_php"] ?? parsed["amount"]),
    senderNumber: text(parsed["sender_number"] ?? parsed["sender"]),
    confidence,
    readable: parsed["readable"] === false ? false : Boolean(reference),
  };
}

/** Member-facing wording for a request that is waiting on the receipt check. */
export function receiptOutcomeMessage(check: ReceiptCheck): string {
  if (check === "matched") return RECEIPT_CHECK_LABEL.matched;
  if (check === "mismatch") {
    return "Reference does not match receipt — held for manual review, no credits were added.";
  }
  return "We could not read the reference from your screenshot, so this is held for manual review.";
}

/* ------------------------------------------------------------------ */
/* Duplicate-reference review records                                  */
/* ------------------------------------------------------------------ */

export interface ConflictSnapshot {
  cash_in_id: string;
  reference: string | null;
  payment_reference: string | null;
  receipt_reference: string | null;
  receipt_check: ReceiptCheck | null;
  amount_php: number | null;
  credits: number | null;
  sender_number: string | null;
  sender_name: string | null;
  receiving_number: string | null;
  ecosystem_id: string | null;
  shop_name: string | null;
  credited_to_user_id: string | null;
  credited_to_name: string | null;
  status: string | null;
  approval_method: string | null;
  decision_reason: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  credits_released_at: string | null;
  listener_event_id: string | null;
  payment_seen_at: string | null;
  has_screenshot: boolean | null;
  request_key: string | null;
}

export interface ReferenceConflict {
  id: string;
  reference: string | null;
  reference_key: string;
  new_request_id: string;
  old_request_id: string | null;
  ecosystem_id: string | null;
  credited_first: "old" | "new" | "none" | null;
  credited_at: string | null;
  status: string;
  old_snapshot: ConflictSnapshot;
  new_snapshot: ConflictSnapshot;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** One line that says who was credited first — the heart of the comparison. */
export function creditedFirstLabel(conflict: Pick<ReferenceConflict, "credited_first" | "credited_at">): string {
  const when = conflict.credited_at ? new Date(conflict.credited_at).toLocaleString() : null;
  if (conflict.credited_first === "old") {
    return `The earlier transaction was credited first${when ? ` on ${when}` : ""}. It was left untouched.`;
  }
  if (conflict.credited_first === "new") {
    return `The newer transaction was credited first${when ? ` on ${when}` : ""}.`;
  }
  return "Neither transaction has released credits yet.";
}

export async function fetchReferenceConflicts(status: string | null = "open"): Promise<ReferenceConflict[]> {
  const { data, error } = await supabase.rpc("cash_in_reference_conflict_list", {
    _status: status,
  } as never);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReferenceConflict[];
}

export async function resolveReferenceConflict(id: string, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc("resolve_cash_in_reference_conflict", {
    _id: id,
    _note: note ?? null,
  } as never);
  if (error) throw new Error(error.message);
}
