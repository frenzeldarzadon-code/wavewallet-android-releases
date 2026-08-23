/**
 * Platform-owner override for shops whose payment approval cannot complete.
 *
 * Some payments can never be verified automatically — a bank transfer that
 * never produced a notification, a receipt the listener cannot read, a
 * final-test shop. Rather than hardcoding exceptions, the platform owner may
 * override the payment requirement for any shop with a payment awaiting
 * verification. The override activates the exact plan that was requested and
 * is recorded on the request itself plus the audit trail.
 */
import { supabase } from "@/integrations/supabase/client";

export interface PendingPaymentShop {
  request_id: string;
  ecosystem_id: string;
  plan_name: string | null;
  payment_reference: string | null;
  created_at: string;
  status: string;
  payment_override: boolean;
  payment_override_reason: string | null;
  payment_override_at: string | null;
}

/** Latest request per shop, so the listing can show one clear note per shop. */
export function latestPerShop(rows: PendingPaymentShop[]): Record<string, PendingPaymentShop> {
  const out: Record<string, PendingPaymentShop> = {};
  for (const r of rows) {
    const seen = out[r.ecosystem_id];
    if (!seen || new Date(r.created_at) > new Date(seen.created_at)) out[r.ecosystem_id] = r;
  }
  return out;
}

export function paymentNote(r: PendingPaymentShop | undefined | null): string | null {
  if (!r) return null;
  if (r.payment_override)
    return `Payment requirement overridden${r.payment_override_reason ? ` — ${r.payment_override_reason}` : ""}`;
  if (r.status === "pending")
    return "Payment awaiting verification — override available if it cannot be verified";
  return null;
}

export async function fetchPaymentRequests(): Promise<PendingPaymentShop[]> {
  const { data, error } = await supabase
    .from("subscription_requests")
    .select(
      "id, ecosystem_id, plan_name, payment_reference, created_at, status, payment_override, payment_override_reason, payment_override_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    request_id: r.id as string,
    ecosystem_id: r.ecosystem_id as string,
    plan_name: (r.plan_name as string | null) ?? null,
    payment_reference: (r.payment_reference as string | null) ?? null,
    created_at: r.created_at as string,
    status: r.status as string,
    payment_override: Boolean((r as { payment_override?: boolean }).payment_override),
    payment_override_reason:
      ((r as { payment_override_reason?: string | null }).payment_override_reason) ?? null,
    payment_override_at:
      ((r as { payment_override_at?: string | null }).payment_override_at) ?? null,
  }));
}

export async function overrideSubscriptionPayment(ecosystemId: string, reason: string) {
  const { data, error } = await supabase.rpc("override_subscription_payment", {
    _ecosystem_id: ecosystemId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { plan: string | null; overridden_by: string };
}
