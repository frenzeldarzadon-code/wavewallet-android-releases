/**
 * SUBSCRIPTION TRANSACTION HISTORY — one timeline, read by both audiences.
 *
 * Nothing is duplicated into a new store: `shop_subscription_history` reads
 * the records that already exist — `subscription_events` (activation, renewal,
 * extension, plan change, payment), `subscription_adjustments` (platform owner
 * manual extension/shortening) and `platform_credit_issuances` scoped to the
 * shop (platform owner manual Coins). The shop admin and the platform owner
 * call the same function, so both review identical rows.
 */
import { supabase } from "@/integrations/supabase/client";

export type SubscriptionHistorySource = "subscription" | "adjustment" | "platform_credit";

export interface SubscriptionHistoryRow {
  id: string;
  occurred_at: string;
  source: SubscriptionHistorySource | string;
  event_type: string;
  previous_plan_name: string | null;
  new_plan_name: string | null;
  amount_php: number | string | null;
  coins: number | string | null;
  period_start: string | null;
  period_end: string | null;
  reference: string | null;
  actor_name: string | null;
  detail: string | null;
}

export async function fetchSubscriptionHistory(
  ecosystemId: string,
): Promise<SubscriptionHistoryRow[]> {
  const { data, error } = await supabase.rpc("shop_subscription_history", {
    _ecosystem_id: ecosystemId,
  } as never);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SubscriptionHistoryRow[];
}

/** Operator-facing wording for each existing event type. */
export function historyTitle(r: Pick<SubscriptionHistoryRow, "event_type" | "previous_plan_name" | "new_plan_name">): string {
  switch (r.event_type) {
    case "activation":
      return `Subscription activated${r.new_plan_name ? ` — ${r.new_plan_name}` : ""}`;
    case "renewal":
      return `Renewal / extension${r.new_plan_name ? ` — ${r.new_plan_name}` : ""}`;
    case "upgrade":
      return r.previous_plan_name && r.new_plan_name
        ? `Plan changed — ${r.previous_plan_name} → ${r.new_plan_name}`
        : "Plan changed";
    case "review_created":
      return "Demo (review) shop created";
    case "super_admin_extension":
      return "Extended by WaveWallet";
    case "super_admin_shortening":
      return "Expiry moved earlier by WaveWallet";
    case "super_admin_adjustment":
      return "Expiry adjusted by WaveWallet";
    case "super_admin_credit":
      return "Coins issued by WaveWallet";
    default:
      return r.event_type.replace(/_/g, " ");
  }
}

/** Where the entry came from, in words the operator understands. */
export function historySource(r: Pick<SubscriptionHistoryRow, "source" | "amount_php">): string {
  if (r.source === "adjustment") return "WaveWallet manual extension";
  if (r.source === "platform_credit") return "WaveWallet manual credit";
  const amount = Number(r.amount_php ?? 0);
  return amount > 0 ? "Payment" : "No payment required";
}

export function historyTone(
  r: Pick<SubscriptionHistoryRow, "source" | "event_type">,
): "success" | "warning" | "brand" | "muted" {
  if (r.event_type === "super_admin_shortening") return "warning";
  if (r.source === "platform_credit") return "brand";
  if (r.source === "adjustment") return "brand";
  if (r.event_type === "review_created") return "muted";
  return "success";
}

/** Never surface platform-owner-only bookkeeping wording to the operator. */
const INTERNAL_MARKERS = [/^SUBSCRIPTION_PAYMENT/i];

export function historyDetail(
  r: Pick<SubscriptionHistoryRow, "detail">,
  audience: "operator" | "owner" = "operator",
): string | null {
  const text = r.detail?.trim();
  if (!text) return null;
  if (audience === "owner") return text;
  return INTERNAL_MARKERS.some((re) => re.test(text)) ? null : text;
}
