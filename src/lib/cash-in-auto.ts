/**
 * Automatic Cash In approval — client helpers.
 *
 * Ground rule, enforced in the database and mirrored here: nothing in this app
 * contacts GCash. A screenshot is supporting evidence for audit and manual
 * review — it is NEVER treated as proof that the payment happened.
 *
 * A cash in may be approved automatically only when the *configured* matching
 * data lines up:
 *   - the amount obeys the configured expected amount / automatic limit,
 *   - the GCash number the member says they paid matches the receiving number
 *     configured for their shop (or the payment method),
 *   - a payment reference is present and has never been consumed before,
 *   - a screenshot is attached,
 *   - the request is still pending.
 *
 * The predicate below is a faithful copy of `try_auto_approve_cash_in` so the
 * settings screen can explain — and the tests can pin — exactly what the
 * database will and will not accept. It is never the authority.
 */
import { supabase } from "@/integrations/supabase/client";

export interface AutoApprovalRule {
  enabled: boolean;
  amount_tolerance_php: number;
  max_auto_amount_php: number | null;
  /** Optional exact amount every automatic cash in must match. */
  expected_amount_php: number | null;
  /** Also require a paired listener phone to have seen the payment. */
  require_listener_match?: boolean;
}

export interface ShopAutoRule extends AutoApprovalRule {
  ecosystem_id: string;
  ecosystem_name: string | null;
}

export interface CashInAutoStatus {
  platform_rule: (AutoApprovalRule & { ecosystem_id: string | null }) | null;
  shop_rules: ShopAutoRule[];
  shops_with_number: number;
  duplicates_blocked_30d: number;
  auto_approved_30d: number;
  /** Paired listener phones that are active. */
  listener_devices_active?: number;
  /** Active listener phones that have actually delivered a notification. */
  listener_devices_proven?: number;
  listener_matches_30d?: number;
  listener_last_event_at?: string | null;
}

export const DEFAULT_AUTO_RULE: AutoApprovalRule = {
  enabled: false,
  amount_tolerance_php: 0,
  max_auto_amount_php: null,
  expected_amount_php: null,
  require_listener_match: false,
};

/** Same normalisation as `public.normalize_payment_reference`. */
export function normalizePaymentReference(ref?: string | null): string | null {
  const key = (ref ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return key === "" ? null : key;
}

/**
 * Same normalisation as `public.normalize_ph_mobile`: 09XXXXXXXXX,
 * +639XXXXXXXXX, 639XXXXXXXXX and 9XXXXXXXXX all compare equal.
 */
export function normalizePhMobile(n?: string | null): string | null {
  const v = (n ?? "").replace(/[^0-9]/g, "");
  if (v === "") return null;
  if (v.length === 11 && v.startsWith("09")) return `63${v.slice(1)}`;
  if (v.length === 12 && v.startsWith("63")) return v;
  if (v.length === 10 && v.startsWith("9")) return `63${v}`;
  if (v.length === 13 && v.startsWith("639")) return v.slice(1);
  return v;
}

export function samePhMobile(a?: string | null, b?: string | null): boolean {
  const x = normalizePhMobile(a);
  const y = normalizePhMobile(b);
  return x !== null && y !== null && x === y;
}

/** The corroborating GCash notification seen by a paired listener phone. */
export interface MatchableListenerEvent {
  /** Number the money was sent FROM, as GCash reported it. */
  sender_number?: string | null;
  amount_php: number;
  outcome?: string;
  /** The paired phone is active and has checked in recently. */
  device_online?: boolean;
}

export interface MatchableRequest {
  amount_php: number;
  payer_reference?: string | null;
  /** The GCash number the member paid FROM. */
  sender_number?: string | null;
  /** Legacy alias kept for older rows: same meaning as sender_number. */
  payer_number?: string | null;
  proof_path?: string | null;
  status?: string;
  /** True when this reference was already used by an earlier request. */
  duplicate_reference?: boolean;
  /** Result of reading the reference off the uploaded receipt. */
  receipt_check?: string | null;
  /** Linked notification, in either order: pay-then-submit or submit-then-pay. */
  listener_event?: MatchableListenerEvent | null;
}

export type MatchOutcome =
  | "matched"
  | "disabled"
  | "not_pending"
  | "no_reference"
  | "duplicate_reference"
  | "no_proof"
  | "above_auto_limit"
  | "amount_mismatch"
  | "no_receiving_number"
  | "no_sender_number"
  | "awaiting_listener"
  | "listener_offline"
  | "number_mismatch"
  | "awaiting_receipt_check"
  | "receipt_reference_mismatch"
  | "receipt_unreadable";

/** Human wording for a matching result, used in the UI and the audit trail. */
export const MATCH_REASON: Record<MatchOutcome, string> = {
  matched: "A real GCash notification matches this request — approved automatically.",
  disabled: "Automatic approval is switched off for this shop.",
  not_pending: "This request was already decided.",
  no_reference: "No GCash payment reference number was submitted, so it cannot be matched.",
  duplicate_reference:
    "That payment reference was already used by another cash in — held for manual investigation.",
  no_proof: "No payment screenshot was attached.",
  above_auto_limit: "Above the automatic approval limit — left for manual review.",
  amount_mismatch: "The amount does not match the payment that was received.",
  no_receiving_number: "No receiving GCash number is configured for this shop yet.",
  no_sender_number: "No sending GCash number was submitted, so the payment cannot be traced.",
  awaiting_listener: "No matching GCash payment has been seen yet — waiting for the notification.",
  listener_offline: "The paired listener phone is offline, so the payment cannot be confirmed.",
  number_mismatch: "The GCash number that sent the money does not match this request.",
  awaiting_receipt_check: "The uploaded receipt has not been read yet.",
  receipt_reference_mismatch: "Reference does not match receipt — held for manual review.",
  receipt_unreadable: "The reference could not be read from the receipt, so nothing is assumed.",
};

/**
 * Would this request be approved automatically? Mirrors the database.
 *
 * The sending GCash number and the exact amount are the primary criteria and
 * must match a real listener notification; the reference is a secondary
 * uniqueness guard; the screenshot is supporting evidence only. The payment may
 * arrive before or after the request, as long as both fall inside the paired
 * device's matching window (checked in the database, not here).
 */
export function evaluateMatch(
  request: MatchableRequest,
  rule: AutoApprovalRule,
  receivingNumber: string | null,
): MatchOutcome {
  if (request.status && request.status !== "pending") return "not_pending";
  if (!rule.enabled) return "disabled";
  if (request.duplicate_reference) return "duplicate_reference";
  if (!normalizePaymentReference(request.payer_reference)) return "no_reference";
  if (!request.proof_path) return "no_proof";
  if (rule.max_auto_amount_php != null && Number(request.amount_php) > Number(rule.max_auto_amount_php)) {
    return "above_auto_limit";
  }
  const tolerance = Number(rule.amount_tolerance_php || 0);
  if (
    rule.expected_amount_php != null &&
    Math.abs(Number(request.amount_php) - Number(rule.expected_amount_php)) > tolerance
  ) {
    return "amount_mismatch";
  }
  if (!normalizePhMobile(receivingNumber)) return "no_receiving_number";
  const sender = normalizePhMobile(request.sender_number ?? request.payer_number);
  if (!sender) return "no_sender_number";

  const event = request.listener_event;
  if (!event || (event.outcome && event.outcome !== "accepted")) return "awaiting_listener";
  if (normalizePhMobile(event.sender_number) !== sender) return "number_mismatch";
  if (Math.abs(Number(event.amount_php) - Number(request.amount_php)) > tolerance) {
    return "amount_mismatch";
  }
  if (event.device_online === false) return "listener_offline";

  // Secondary verification: the reference read off the receipt is authoritative
  // and must agree with what the member typed.
  const receipt = request.receipt_check ?? "pending";
  if (receipt === "mismatch") return "receipt_reference_mismatch";
  if (receipt === "unreadable" || receipt === "error") return "receipt_unreadable";
  if (receipt !== "matched") return "awaiting_receipt_check";
  return "matched";
}


/** Wording for the banner on the settings screen. */
export function matchingStatusLabel(status: CashInAutoStatus | null): {
  tone: "success" | "warning";
  title: string;
  detail: string;
} {
  if (status?.platform_rule?.enabled) {
    return {
      tone: "success",
      title: "Automatic matching is on",
      detail:
        "A cash in is approved automatically only when a real GCash notification from the paired phone on the shop's receiving account matches the sending number and the exact amount, and the payment reference has never been used. The customer may pay before or after submitting. GCash itself is never contacted.",
    };
  }
  return {
    tone: "warning",
    title: "Automatic matching is off",
    detail:
      "Every cash in waits in the manual queue. Screenshots are supporting evidence only — they are never treated as proof of payment.",
  };
}

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

export async function fetchCashInAutoStatus(): Promise<CashInAutoStatus> {
  const { data, error } = await supabase.rpc("cash_in_auto_status");
  if (error) throw new Error(error.message);
  return data as unknown as CashInAutoStatus;
}

export async function setCashInAutoApproval(input: {
  ecosystemId: string | null;
  enabled: boolean;
  tolerance?: number;
  maxAmount?: number | null;
  expectedAmount?: number | null;
  requireListener?: boolean;
}): Promise<void> {
  // The RPC treats a null shop as "platform default"; a null max/expected
  // amount means "no ceiling" / "any amount".
  const args = {
    _ecosystem: input.ecosystemId,
    _enabled: input.enabled,
    _tolerance: input.tolerance ?? 0,
    _max_amount: input.maxAmount ?? null,
    _expected_amount: input.expectedAmount ?? null,
    _require_listener: input.requireListener ?? false,
  } as unknown as Parameters<typeof supabase.rpc<"set_cash_in_auto_approval">>[1];
  const { error } = await supabase.rpc("set_cash_in_auto_approval", args);

  if (error) throw new Error(error.message);
}

/** The receiving GCash number configured for a shop (admins / platform owner). */
export async function fetchShopCashInNumber(ecosystemId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("ecosystems")
    .select("cash_in_gcash_number")
    .eq("id", ecosystemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { cash_in_gcash_number?: string | null } | null)?.cash_in_gcash_number ?? null;
}

export async function setShopCashInNumber(ecosystemId: string, number: string | null): Promise<void> {
  const { error } = await supabase.rpc("set_ecosystem_cash_in_number", {
    _ecosystem: ecosystemId,
    _number: number,
  } as never);
  if (error) throw new Error(error.message);
}
