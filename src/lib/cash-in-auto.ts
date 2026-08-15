/**
 * Automatic Cash In approval — client helpers.
 *
 * Ground rule, enforced in the database and mirrored here: a screenshot is
 * NEVER evidence of payment. A cash in can only be approved automatically when
 * an authorised payment feed has delivered a *verified* transaction (a row in
 * `verified_payments`, written only by the signed webhook running server-side)
 * that matches the request. When nothing matches, the request stays pending for
 * the manual queue.
 *
 * The matching predicate below is a faithful copy of `try_auto_approve_cash_in`
 * so the settings screen can explain — and the tests can pin — exactly what the
 * database will and will not accept. It is never the authority.
 */
import { supabase } from "@/integrations/supabase/client";

export interface AutoApprovalRule {
  enabled: boolean;
  require_reference_match: boolean;
  amount_tolerance_php: number;
  max_auto_amount_php: number | null;
}

export interface ShopAutoRule extends AutoApprovalRule {
  ecosystem_id: string;
  ecosystem_name: string | null;
}

export interface PaymentFeedSource {
  provider: string;
  label: string;
  status: "not_connected" | "connected" | "error";
  secret_name: string | null;
  last_event_at: string | null;
  last_error: string | null;
}

export interface CashInAutoStatus {
  sources: PaymentFeedSource[];
  connected: boolean;
  platform_rule: (AutoApprovalRule & { ecosystem_id: string | null }) | null;
  shop_rules: ShopAutoRule[];
  unmatched_payments: number;
  auto_approved_30d: number;
}

export const DEFAULT_AUTO_RULE: AutoApprovalRule = {
  enabled: false,
  require_reference_match: true,
  amount_tolerance_php: 0,
  max_auto_amount_php: null,
};

/** Same normalisation as `public.normalize_payment_reference`. */
export function normalizePaymentReference(ref?: string | null): string | null {
  const key = (ref ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return key === "" ? null : key;
}

export interface MatchableRequest {
  amount_php: number;
  payer_reference?: string | null;
  method_id?: string | null;
}

export interface MatchablePayment {
  amount_php: number;
  payer_reference?: string | null;
  payment_method_id?: string | null;
  status?: string;
  consumed_cash_in_id?: string | null;
}

export type MatchOutcome =
  | "matched"
  | "disabled"
  | "no_feed"
  | "above_auto_limit"
  | "no_reference"
  | "already_consumed"
  | "amount_mismatch"
  | "reference_mismatch"
  | "method_mismatch";

/** Human wording for a matching result, used in the UI and the audit trail. */
export const MATCH_REASON: Record<MatchOutcome, string> = {
  matched: "Verified payment matched — approved automatically.",
  disabled: "Automatic approval is switched off for this shop.",
  no_feed: "No authorised payment feed is connected, so nothing can be verified.",
  above_auto_limit: "Above the automatic approval limit — left for manual review.",
  no_reference: "No payment reference was submitted, so it cannot be matched.",
  already_consumed: "That payment was already used to approve another cash in.",
  amount_mismatch: "The received amount does not match the requested amount.",
  reference_mismatch: "The payment reference does not match the received payment.",
  method_mismatch: "The payment arrived on a different payment account.",
};

/**
 * Would this verified payment settle this request? Mirrors the database.
 * A screenshot plays no part: only a verified payment reaches this function.
 */
export function evaluateMatch(
  request: MatchableRequest,
  payment: MatchablePayment | null,
  rule: AutoApprovalRule,
  feedConnected: boolean,
): MatchOutcome {
  if (!rule.enabled) return "disabled";
  if (!feedConnected) return "no_feed";
  if (rule.max_auto_amount_php != null && Number(request.amount_php) > Number(rule.max_auto_amount_php)) {
    return "above_auto_limit";
  }
  const key = normalizePaymentReference(request.payer_reference);
  if (rule.require_reference_match && !key) return "no_reference";
  if (!payment) return "amount_mismatch";
  if (payment.status === "consumed" || payment.consumed_cash_in_id) return "already_consumed";
  if (Math.abs(Number(payment.amount_php) - Number(request.amount_php)) > Number(rule.amount_tolerance_php || 0)) {
    return "amount_mismatch";
  }
  if (rule.require_reference_match && normalizePaymentReference(payment.payer_reference) !== key) {
    return "reference_mismatch";
  }
  if (payment.payment_method_id && request.method_id && payment.payment_method_id !== request.method_id) {
    return "method_mismatch";
  }
  return "matched";
}

/** Wording for the connection banner on the settings screen. */
export function feedStatusLabel(status: CashInAutoStatus | null): {
  tone: "success" | "warning";
  title: string;
  detail: string;
} {
  if (status?.connected) {
    return {
      tone: "success",
      title: "Payment feed connected",
      detail: "Verified incoming payments are being received and can settle matching cash in requests.",
    };
  }
  return {
    tone: "warning",
    title: "No payment feed connected",
    detail:
      "Automatic approval needs an authorised GCash/payment provider webhook. Until one is connected, every cash in stays pending for manual review — screenshots are never used as proof.",
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
  requireReference?: boolean;
  tolerance?: number;
  maxAmount?: number | null;
}): Promise<void> {
  // The RPC treats a null shop as "platform default"; a null max amount means
  // "no ceiling". The generated arg types cannot express either nullable.
  const args = {
    _ecosystem: input.ecosystemId,
    _enabled: input.enabled,
    _require_reference: input.requireReference ?? true,
    _tolerance: input.tolerance ?? 0,
    _max_amount: input.maxAmount ?? null,
  } as unknown as Parameters<typeof supabase.rpc<"set_cash_in_auto_approval">>[1];
  const { error } = await supabase.rpc("set_cash_in_auto_approval", args);

  if (error) throw new Error(error.message);
}
