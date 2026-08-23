/**
 * New Generation Shop — Go Live payments.
 *
 * A New Generation Shop is created free as a Demo shop. Going live means
 * paying for one of the existing subscription plans through the platform
 * GCash number, using exactly the same identification the Cash In listener
 * already requires: the GCash number the payment is sent FROM, plus the
 * GCash reference number. Nothing here touches the listener itself — the
 * backend simply associates an already-recognised platform payment with the
 * pending subscription request.
 */
import { requireOnline } from "@/lib/offline-guard";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type SubscriptionRequest = Database["public"]["Tables"]["subscription_requests"]["Row"];
export type Ecosystem = Database["public"]["Tables"]["ecosystems"]["Row"];

export const isNewGenerationShop = (shop: Pick<Ecosystem, "shop_kind"> | null | undefined) =>
  shop?.shop_kind === "subscription";

export const isLegacyShop = (shop: Pick<Ecosystem, "shop_kind"> | null | undefined) =>
  Boolean(shop) && shop?.shop_kind !== "subscription";

/** Where a Go Live payment must be sent — the platform owner's GCash. */
export async function fetchPlatformGcash() {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("gcash_number, gcash_account_name, payment_instructions, currency")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Normalised to 639XXXXXXXXX exactly like the Cash In flow. */
export function normalizePhMobile(input: string): string | null {
  const digits = (input || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return digits;
  if (/^9\d{9}$/.test(digits)) return `63${digits}`;
  return null;
}

export function validateGoLive(input: {
  payerNumber: string;
  reference: string;
  proofPath?: string | null;
}): string | null {
  if (!normalizePhMobile(input.payerNumber))
    return "Enter the GCash number you paid from (09XXXXXXXXX).";
  const ref = (input.reference || "").replace(/\s/g, "");
  if (ref.length < 6) return "Enter the GCash reference number from your receipt.";
  if (input.proofPath !== undefined && !input.proofPath?.trim())
    return "Upload the GCash payment screenshot for this payment.";
  return null;
}

export async function fetchGoLiveRequest(ecosystemId: string): Promise<SubscriptionRequest | null> {
  const { data, error } = await supabase
    .from("subscription_requests")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function submitGoLivePayment(input: {
  ecosystemId: string;
  planId: string;
  payerNumber: string;
  reference: string;
  months?: number;
  amountPaid?: number | null;
  /** Required: object path in the shared private cash-in-proofs bucket. */
  proofPath: string;
  /** Which published WaveWallet receiving account the applicant paid into. */
  paymentMethodId?: string | null;
}): Promise<SubscriptionRequest> {
  requireOnline();
  const problem = validateGoLive({ ...input, proofPath: input.proofPath });
  if (problem) throw new Error(problem);
  const { data, error } = await supabase.rpc("submit_go_live_payment", {
    _ecosystem_id: input.ecosystemId,
    _plan_id: input.planId,
    _payer_number: input.payerNumber.trim(),
    _reference: input.reference.trim(),
    _months: input.months ?? 1,
    ...(input.amountPaid != null ? { _amount_paid: input.amountPaid } : {}),
    ...(input.proofPath ? { _proof_path: input.proofPath } : {}),
    ...(input.paymentMethodId ? { _payment_method_id: input.paymentMethodId } : {}),
  } as never);
  if (error) throw new Error(error.message);
  return data as unknown as SubscriptionRequest;
}


/** Platform owner override: any plan, any discount, or free (100% off). */
export async function superadminSetShopPlan(input: {
  ecosystemId: string;
  planId: string;
  months: number;
  discountPercent: number;
  reason?: string | null;
}) {
  requireOnline();
  const { error } = await supabase.rpc("superadmin_set_shop_plan", {
    _ecosystem_id: input.ecosystemId,
    _plan_id: input.planId,
    _months: input.months,
    _discount_percent: input.discountPercent,
    ...(input.reason?.trim() ? { _reason: input.reason.trim() } : {}),
  });
  if (error) throw new Error(error.message);
}

export async function reconcileGoLivePayments(days = 30) {
  requireOnline();
  const { data, error } = await supabase.rpc("reconcile_go_live_payments", { _days: days });
  if (error) throw new Error(error.message);
  return (data ?? {}) as { checked?: number; activated?: number };
}

/**
 * `isLive` is the shop's own persisted state (ecosystems.is_review === false).
 * A verified payment is only reported as "live" when the shop record agrees —
 * otherwise we state the real, still-pending situation.
 */
export function goLiveStatusLine(r: SubscriptionRequest | null, isLive?: boolean): string {
  if (!r) return "No payment submitted yet.";
  if (r.status === "approved")
    return isLive === false
      ? "Payment verified — finishing activation. Refresh in a moment; if this stays, the platform owner needs to complete the activation."
      : "Payment verified — your shop is live.";
  if (r.status === "rejected") return r.decision_reason || "That payment was rejected.";
  const auto = (r as { auto_reason?: string | null }).auto_reason;
  return auto || "Waiting for the GCash payment to be recognised.";
}

