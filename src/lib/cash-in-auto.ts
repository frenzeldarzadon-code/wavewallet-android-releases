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

export type VerificationMode = "staged" | "active";

export interface AutoApprovalRule {
  enabled: boolean;
  amount_tolerance_php: number;
  max_auto_amount_php: number | null;
  /** Optional exact amount every automatic cash in must match. */
  expected_amount_php: number | null;
  /** First layer: require a paired listener phone to have seen the payment. */
  require_listener_match?: boolean;
  /** Second layer: require the reference read off the receipt to match. */
  require_receipt_match?: boolean;
  /** Staged evaluates every rule but never settles a request. */
  verification_mode?: VerificationMode;
  /* -------- Configurable authentication fields -------- */
  /** Always true: the received amount is never optional. */
  layer1_require_amount?: boolean;
  /** First layer: the notification must report the sending GCash number. */
  layer1_require_sender_number?: boolean;
  /** First layer: only pair a notification inside the device match window. */
  layer1_require_time_window?: boolean;
  /** Second layer: submitted amount must equal the confirmed amount. */
  layer2_require_amount_match?: boolean;
  /** Second layer: submitted sender number must equal the confirmed sender. */
  layer2_require_sender_match?: boolean;
  /** Second layer: the notification itself must carry the same reference. */
  layer2_require_listener_reference?: boolean;
}

export interface ShopAutoRule extends AutoApprovalRule {
  ecosystem_id: string;
  ecosystem_name: string | null;
}

/** A paired phone whose receiving number matches no shop's configured number. */
export interface MismatchedDevice {
  device_id: string;
  label: string;
  device_number: string | null;
  shop_id: string;
  shop_name: string | null;
  shop_number: string | null;
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
  /** Paired phones with no receiving GCash account set — they can never match. */
  listener_devices_unscoped?: number;
  listener_matches_30d?: number;
  listener_last_event_at?: string | null;
  /** Receiving numbers shared by more than one shop. */
  shared_numbers?: { number: string; shops: number }[];
  /** Requests that would have been approved while staged. */
  staged_30d?: number;
  /** Shops whose receiving number no active phone is listening on. */
  mismatched_devices?: MismatchedDevice[];
}

export const DEFAULT_AUTO_RULE: AutoApprovalRule = {
  enabled: false,
  amount_tolerance_php: 0,
  max_auto_amount_php: null,
  expected_amount_php: null,
  require_listener_match: true,
  require_receipt_match: true,
  verification_mode: "active",
  layer1_require_amount: true,
  layer1_require_sender_number: true,
  layer1_require_time_window: false,
  layer2_require_amount_match: true,
  layer2_require_sender_match: true,
  layer2_require_listener_reference: false,
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
  /**
   * The phone that saw this notification is allowed to serve this shop: it is
   * either a platform phone or a phone bound to this very shop. This is the
   * ONE authoritative routing rule.
   */
  serves_shop?: boolean;
  /**
   * Informational only. GCash masks or reformats the receiving number, so a
   * difference here is recorded for audit and never blocks approval.
   */
  receiving_number_matches?: boolean;
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
  | "staged"
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
  | "wrong_shop"
  | "number_mismatch"
  | "awaiting_receipt_check"
  | "receipt_reference_mismatch"
  | "receipt_unreadable";

/** Human wording for a matching result, used in the UI and the audit trail. */
export const MATCH_REASON: Record<MatchOutcome, string> = {
  matched: "A real GCash notification matches this request — approved automatically.",
  staged:
    "Every check passed, but verification is staged: nothing was settled and a person still decides.",
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
  wrong_shop:
    "That notification came from a phone paired to a different shop, so it cannot settle this request.",
  number_mismatch: "The GCash number that sent the money does not match this request.",
  awaiting_receipt_check: "The uploaded receipt has not been read yet.",
  receipt_reference_mismatch: "Reference does not match receipt — held for manual review.",
  receipt_unreadable: "The reference could not be read from the receipt, so nothing is assumed.",
};

/**
 * Would this request be approved automatically? Mirrors the database.
 *
 * The sending GCash number and the exact amount are the primary criteria and
 * must match a real listener notification seen on the very receiving account
 * this request pays into; the reference is a secondary uniqueness guard; the
 * screenshot is supporting evidence only. The payment may arrive before or
 * after the request, as long as both fall inside the paired device's matching
 * window (checked in the database, not here).
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
  if ((rule.layer2_require_sender_match ?? true) && !sender) return "no_sender_number";

  // First layer — configurable, on by default.
  const requireListener = rule.require_listener_match ?? true;
  const event = request.listener_event;
  if (!event || (event.outcome && event.outcome !== "accepted")) {
    if (requireListener) return "awaiting_listener";
  } else {
    if ((rule.layer2_require_sender_match ?? true) && normalizePhMobile(event.sender_number) !== sender) {
      return "number_mismatch";
    }
    if (
      (rule.layer2_require_amount_match ?? true) &&
      Math.abs(Number(event.amount_php) - Number(request.amount_php)) > tolerance
    ) {
      return "amount_mismatch";
    }
    // Shop isolation is the only routing rule. A differing / masked receiving
    // number is informational and must never block a valid approval.
    if (event.serves_shop === false) return "wrong_shop";
    if (event.device_online === false) return "listener_offline";
  }


  // Second layer: the reference read off the receipt. A mismatch always blocks;
  // whether an unreadable receipt blocks is configurable.
  const receipt = request.receipt_check ?? "pending";
  if (receipt === "mismatch") return "receipt_reference_mismatch";
  if (rule.require_receipt_match ?? true) {
    if (receipt === "unreadable" || receipt === "error") return "receipt_unreadable";
    if (receipt !== "matched") return "awaiting_receipt_check";
  }

  if ((rule.verification_mode ?? "active") === "staged") return "staged";
  return "matched";
}



/** Wording for the banner on the settings screen. */
export function matchingStatusLabel(status: CashInAutoStatus | null): {
  tone: "success" | "warning";
  title: string;
  detail: string;
} {
  const rule = status?.platform_rule;
  if (rule?.enabled && (rule.verification_mode ?? "active") === "staged") {
    return {
      tone: "warning",
      title: "Automatic matching is staged",
      detail:
        "Every verification layer runs and the result is recorded, but nothing is settled automatically. Use this to prove the rules on live payments before switching to active.",
    };
  }
  if (rule?.enabled) {
    return {
      tone: "success",
      title: "Automatic matching is on",
      detail:
        "A cash in is approved automatically only when a real GCash notification from a paired phone monitoring that shop's own receiving account matches the sending number and the exact amount, and the payment reference has never been used. The customer may pay before or after submitting. GCash itself is never contacted.",
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
  requireReceipt?: boolean;
  verificationMode?: VerificationMode;
}): Promise<void> {
  // The RPC treats a null shop as "platform default"; a null max/expected
  // amount means "no ceiling" / "any amount".
  const args = {
    _ecosystem: input.ecosystemId,
    _enabled: input.enabled,
    _tolerance: input.tolerance ?? 0,
    _max_amount: input.maxAmount ?? null,
    _expected_amount: input.expectedAmount ?? null,
    _require_listener: input.requireListener ?? true,
    _require_receipt: input.requireReceipt ?? true,
    _verification_mode: input.verificationMode ?? "active",
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

/**
 * Platform-owner only: choose which fields each authentication layer requires.
 * Duplicate-reference protection is never configurable and stays on.
 */
export async function setCashInAuthFields(input: {
  ecosystemId: string | null;
  layer1SenderNumber?: boolean;
  layer1TimeWindow?: boolean;
  layer2AmountMatch?: boolean;
  layer2SenderMatch?: boolean;
  layer2ListenerReference?: boolean;
  requireReceipt?: boolean;
}): Promise<void> {
  const args = {
    _ecosystem: input.ecosystemId,
    _layer1_sender: input.layer1SenderNumber ?? null,
    _layer1_time: input.layer1TimeWindow ?? null,
    _layer2_amount: input.layer2AmountMatch ?? null,
    _layer2_sender: input.layer2SenderMatch ?? null,
    _layer2_listener_reference: input.layer2ListenerReference ?? null,
    _require_receipt: input.requireReceipt ?? null,
  } as never;
  const { error } = await supabase.rpc("set_cash_in_auth_fields" as never, args);
  if (error) throw new Error(error.message);
}

export interface RecheckResult {
  events_checked: number;
  linked: number;
  approved: number;
}

/** Re-runs matching over recent pending payments under the current rules. */
export async function recheckPendingCashIns(): Promise<RecheckResult> {
  const { data, error } = await supabase.rpc("recheck_pending_cash_ins" as never);
  if (error) throw new Error(error.message);
  const v = (data ?? {}) as Partial<RecheckResult>;
  return { events_checked: v.events_checked ?? 0, linked: v.linked ?? 0, approved: v.approved ?? 0 };
}
