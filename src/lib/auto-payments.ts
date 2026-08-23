/**
 * Super Admin review of payments the listener approved on its own.
 *
 * The automatic matcher can activate a shop without a human, so every
 * automatic approval opens an explicit review record. Until the platform owner
 * presses Verified the payment stays "Pending Super Admin Review"; marking it
 * Invalid puts the shop's paid entitlements on hold (nothing is deleted).
 * None of this changes the matching rules themselves.
 */
import { supabase } from "@/integrations/supabase/client";
import { requireOnline } from "@/lib/offline-guard";

export type AutoReviewState = "pending" | "verified" | "invalid";

export type AutoApprovedPayment = {
  id: string;
  ecosystem_id: string;
  shop_name: string | null;
  operator_name: string | null;
  plan_name: string | null;
  monthly_rate: number | null;
  months_purchased: number | null;
  amount_due: number | null;
  amount_paid: number | null;
  payment_reference: string | null;
  payer_number: string | null;
  payment_method_name: string | null;
  purpose: string | null;
  submitted_at: string | null;
  auto_approved_at: string | null;
  auto_reason: string | null;
  review_state: AutoReviewState;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  entitlement_hold: boolean;
  operations_frozen: boolean;
  frozen_reason: string | null;
  listener_provider: string | null;
  listener_sender: string | null;
  listener_reference: string | null;
  listener_amount: number | null;
  listener_posted_at: string | null;
};

export const REVIEW_LABEL: Record<AutoReviewState, string> = {
  pending: "Pending Super Admin Review",
  verified: "Verified",
  invalid: "Invalid",
};

export const reviewTone = (s: AutoReviewState): "warning" | "success" | "danger" =>
  s === "verified" ? "success" : s === "invalid" ? "danger" : "warning";

/** The plan actually purchased — never a ₱0 fallback when a plan was chosen. */
export function planTotal(p: Pick<AutoApprovedPayment, "monthly_rate" | "months_purchased" | "amount_paid" | "amount_due">): number {
  const rate = Number(p.monthly_rate ?? 0);
  const months = Number(p.months_purchased ?? 1) || 1;
  const computed = rate * months;
  if (computed > 0) return computed;
  return Number(p.amount_paid ?? p.amount_due ?? 0);
}

export function planSummary(p: AutoApprovedPayment): string {
  const name = p.plan_name?.trim() || "Selected plan";
  const rate = Number(p.monthly_rate ?? 0);
  const months = Number(p.months_purchased ?? 1) || 1;
  const rateText = rate > 0 ? `₱${rate.toLocaleString("en-PH")}/month` : "rate not recorded";
  return `${name} · ${rateText} × ${months} ${months === 1 ? "month" : "months"}`;
}

/** Which independent details the automatic matcher had to work with. */
export function matchSignals(p: AutoApprovedPayment): string[] {
  const out: string[] = [];
  if (p.listener_reference && p.payment_reference) out.push("Reference");
  if (p.listener_sender) out.push("Sending account");
  if (p.listener_amount != null) out.push("Amount");
  if (p.payment_method_name) out.push("Receiving account");
  return out;
}

export function matchesSearch(p: AutoApprovedPayment, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [
    p.shop_name,
    p.operator_name,
    p.plan_name,
    p.payment_reference,
    p.payer_number,
    p.payment_method_name,
    p.listener_sender,
  ]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle));
}

export async function fetchAutoApprovedPayments(
  state?: AutoReviewState | "all",
): Promise<AutoApprovedPayment[]> {
  const { data, error } = await supabase.rpc("auto_approved_payments", {
    ...(state && state !== "all" ? { _state: state } : {}),
  } as never);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AutoApprovedPayment[];
}

export async function reviewAutoApprovedPayment(input: {
  requestId: string;
  decision: "verified" | "invalid";
  reason?: string;
}) {
  requireOnline();
  if (input.decision === "invalid" && !input.reason?.trim())
    throw new Error("A reason is required when marking a payment invalid.");
  const { data, error } = await supabase.rpc("review_auto_approved_payment", {
    _request_id: input.requestId,
    _decision: input.decision,
    ...(input.reason?.trim() ? { _reason: input.reason.trim() } : {}),
  } as never);
  if (error) throw new Error(error.message);
  return data as unknown as string;
}
